// HACK: Fix for AWS SDK 'uv_os_homedir returned ENOENT' on Homey
if (!process.env.HOME) {
  process.env.HOME = '/tmp';
}

'use strict';

const mqtt = require('mqtt');
const crypto = require('crypto');
const DataSanitizer = require('./DataSanitizer');
const fetch = require('node-fetch');
const AwsSigner = require('./AwsSigner');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { CognitoIdentityProviderClient, InitiateAuthCommand, RespondToAuthChallengeCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { createSrpSession, wrapInitiateAuth, signSrpSession, wrapAuthChallenge, createSecretHash } = require('cognito-srp-helper');


// Polyfill for fetch in Node.js
global.fetch = fetch;

/**
 * XSense API Client with AWS Cognito Authentication
 * Based on python-xsense library: https://github.com/theosnel/python-xsense
 */
class XSenseAPI {
  constructor(email, password) {
    this.email = email;
    this.password = password;
    this.baseUrl = 'https://api.x-sense-iot.com';

    // Cognito configuration (will be fetched dynamically)
    this.userPoolId = null;
    this.clientId = null;
    this.clientSecret = null;
    this.region = null;
    this.userPool = null;

    // Authentication tokens
    this.accessToken = null;
    this.idToken = null;
    this.refreshToken = null;

    // App info
    this.appVersion = 'v1.22.0_20240914.1';
    this.appCode = '1220';
    this.clientType = '1';

    // Data storage
    this.houses = new Map();
    this.stations = new Map();
    this.devices = new Map();
    this.mqttClients = new Map();
    this.updateCallbacks = [];
    this.devicesBySn = new Map();
    this.stationsBySn = new Map();
    this.shadowFailureCount = new Map();
    this.legacyAccessToken = null;
    this.legacyRefreshToken = null;
    this.legacyUserId = null;
    this.legacyLoginAttempted = false;
    this._signerDebugLogged = false;
    this._signerDebugConfig = undefined;
  }

  /**
   * Initialize API - Get Cognito credentials and authenticate
   */
  async init() {
    console.log('[XSenseAPI] Initializing...');

    // Step 1: Get Cognito client info
    await this.getClientInfo();

    // Step 2: Authenticate with Cognito
    await this.login();

    // Step 3: Get AWS IoT credentials for Thing Shadow API
    await this.getAWSTokens();

    // Step 4: Fetch initial device data
    await this.getAllDevices();

    console.log('[XSenseAPI] Initialization complete');
  }

  _getSignerDebugConfig() {
    if (this._signerDebugConfig !== undefined) {
      return this._signerDebugConfig;
    }

    const filePath = path.join(__dirname, '..', 'signer-debug.json');
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      this._signerDebugConfig = JSON.parse(raw);
    } catch (error) {
      this._signerDebugConfig = null;
    }
    return this._signerDebugConfig;
  }

  /**
   * Get Cognito client configuration from XSense API
   */
  async getClientInfo() {
    console.log('[XSenseAPI] Fetching Cognito client info...');

    const response = await this._apiCall('101001', {}, true);

    // XSense API returns data in 'reData' field
    const data = response?.reData || response?.data;

    if (data) {
      this.clientId = data.clientId;
      this.clientSecret = this._decodeSecret(data.clientSecret);
      this.region = data.cgtRegion;
      this.userPoolId = data.userPoolId;

      console.log(`[XSenseAPI] Cognito configured: Region=${this.region}, Pool=${this.userPoolId}`);
    } else {
      throw new Error('Failed to get client info');
    }
  }

  async _legacyRequest(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.legacyAccessToken) {
      headers['Authorization'] = `Bearer ${this.legacyAccessToken}`;
    }

    const options = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (response.status === 401 && this.legacyRefreshToken) {
      await this._legacyRefreshAccessToken();
      return this._legacyRequest(method, path, body);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Legacy API ${response.status}: ${text}`);
    }

    return response.json();
  }

  async _legacyLogin() {
    if (this.legacyAccessToken || this.legacyLoginAttempted) {
      return !!this.legacyAccessToken;
    }

    this.legacyLoginAttempted = true;
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password })
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 403) {
          // Common for newer accounts that only support SRP
          // console.warn(`[XSenseAPI] Legacy login failed: 403 ${text}`);
          return null; // Fallback will handle this
        }
        console.warn(`[XSenseAPI] Legacy login failed: ${response.status} ${text}`);
        return false;
      }

      const data = await response.json();
      if (data && data.data) {
        this.legacyAccessToken = data.data.access_token || null;
        this.legacyRefreshToken = data.data.refresh_token || null;
        this.legacyUserId = data.data.user_id || null;
        console.log('[XSenseAPI] Legacy login successful');
        return true;
      }
    } catch (error) {
      console.warn('[XSenseAPI] Legacy login error:', error.message);
    }

    return false;
  }

  async _legacyRefreshAccessToken() {
    if (!this.legacyRefreshToken) {
      throw new Error('Legacy refresh token missing');
    }

    const response = await fetch(`${this.baseUrl}/api/v1/user/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.legacyRefreshToken })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Legacy refresh failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    if (data && data.data && data.data.access_token) {
      this.legacyAccessToken = data.data.access_token;
      console.log('[XSenseAPI] Legacy access token refreshed');
      return true;
    }

    throw new Error('Legacy refresh returned no access token');
  }

  async getLegacyMqttConfig(stationId) {
    if (!stationId) {
      return null;
    }

    const loggedIn = await this._legacyLogin();
    if (!loggedIn) {
      return null;
    }

    try {
      const response = await this._legacyRequest('GET', `/api/v1/stations/${stationId}/mqtt`);
      return response?.data || response || null;
    } catch (error) {
      console.warn(`[XSenseAPI] Legacy MQTT config failed for ${stationId}:`, error.message);
      return null;
    }
  }

  /**
   * Decode client secret (base64 + slice)
   * Based on python-xsense: base64decode, then remove first 4 bytes and last 1 byte
   */
  _decodeSecret(encodedSecret) {
    const decoded = Buffer.from(encodedSecret, 'base64');
    // Remove first 4 bytes and last 1 byte (Python: value[4:-1])
    const secretBuffer = decoded.slice(4, -1);
    const secret = secretBuffer.toString('utf-8');
    console.log(`[XSenseAPI] Decoded secret length: ${secret.length}`);

    // Store both string and buffer versions
    this.clientSecretBuffer = secretBuffer;
    return secret;
  }

  /**
   * Calculate MAC for API requests
   * Based on python-xsense: concatenate all param values + clientsecret, then MD5 hash
   */
  _calculateMac(params) {
    const values = [];

    if (params) {
      for (const key in params) {
        const value = params[key];
        if (Array.isArray(value)) {
          if (value.length > 0 && typeof value[0] === 'string') {
            values.push(...value);
          } else {
            values.push(JSON.stringify(value));
          }
        } else if (typeof value === 'object' && value !== null) {
          values.push(JSON.stringify(value));
        } else {
          values.push(String(value));
        }
      }
    }

    // Concatenate all values
    const concatenated = values.join('');

    // Append client secret as bytes and calculate MD5
    const macData = Buffer.concat([
      Buffer.from(concatenated, 'utf-8'),
      this.clientSecretBuffer
    ]);

    const mac = crypto.createHash('md5').update(macData).digest('hex');
    console.log(`[XSenseAPI] Calculated MAC for params:`, params, `=> ${mac}`);
    return mac;
  }

  /**
   * Calculate SECRET_HASH for Cognito (using cognito-srp-helper)
   */
  _calculateSecretHash(username) {
    console.log(`[XSenseAPI] Calculating SECRET_HASH for: ${username}`);
    const hash = createSecretHash(username, this.clientId, this.clientSecret);
    console.log(`[XSenseAPI] SECRET_HASH: ${hash}`);
    return hash;
  }

  /**
   * Authenticate with AWS Cognito using SRP
   */
  async login() {
    console.log(`[XSenseAPI] Authenticating user: ${this.email} with SRP...`);

    try {
      // Pass dummy credentials to prevent AWS SDK from trying to read ~/.aws/credentials
      // (which causes 'uv_os_homedir returned ENOENT' on Homey)
      const client = new CognitoIdentityProviderClient({
        region: this.region,
        credentials: {
          accessKeyId: 'dummy',
          secretAccessKey: 'dummy'
        }
      });
      const secretHash = this._calculateSecretHash(this.email);

      // Step 1: Create SRP session
      const srpSession = createSrpSession(this.email, this.password, this.userPoolId, false);
      console.log('[XSenseAPI] SRP session created');

      // Step 2: Initiate Auth with SRP_A
      const initiateAuthCommand = new InitiateAuthCommand(
        wrapInitiateAuth(srpSession, {
          ClientId: this.clientId,
          AuthFlow: 'USER_SRP_AUTH',
          AuthParameters: {
            SECRET_HASH: secretHash,
            USERNAME: this.email
          }
        })
      );

      console.log('[XSenseAPI] Sending InitiateAuth command...');
      const initiateAuthResponse = await client.send(initiateAuthCommand);

      if (!initiateAuthResponse.ChallengeName || initiateAuthResponse.ChallengeName !== 'PASSWORD_VERIFIER') {
        throw new Error(`Unexpected challenge: ${initiateAuthResponse.ChallengeName}`);
      }

      console.log('[XSenseAPI] PASSWORD_VERIFIER challenge received, signing session...');

      // Step 3: Sign the SRP session with the challenge response
      const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);

      // Step 4: Respond to Challenge
      const respondToChallengeCommand = new RespondToAuthChallengeCommand(
        wrapAuthChallenge(signedSrpSession, {
          ClientId: this.clientId,
          ChallengeName: 'PASSWORD_VERIFIER',
          ChallengeResponses: {
            SECRET_HASH: secretHash,
            USERNAME: this.email
          }
        })
      );

      console.log('[XSenseAPI] Sending RespondToAuthChallenge command...');
      const respondToChallengeResponse = await client.send(respondToChallengeCommand);

      if (respondToChallengeResponse.AuthenticationResult) {
        this.accessToken = respondToChallengeResponse.AuthenticationResult.AccessToken;
        this.idToken = respondToChallengeResponse.AuthenticationResult.IdToken;
        this.refreshToken = respondToChallengeResponse.AuthenticationResult.RefreshToken;

        console.log('[XSenseAPI] SRP Authentication successful');
        return true;
      } else {
        throw new Error('No authentication result received');
      }
    } catch (error) {
      console.error(`[XSenseAPI] SRP Authentication failed for ${this.email}:`, error.message);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Get AWS IoT credentials for Thing Shadow API
   */
  async getAWSTokens() {
    console.log('[XSenseAPI] Getting AWS IoT credentials...');

    const response = await this._apiCall('101003', { userName: this.email });
    const data = response?.reData;

    if (data) {
      this.awsAccessKeyId = data.accessKeyId;
      this.awsSecretAccessKey = data.secretAccessKey;
      this.awsSessionToken = data.sessionToken;
      if (this.awsSigner) {
        this.awsSigner.updateCredentials(this.awsAccessKeyId, this.awsSecretAccessKey, this.awsSessionToken);
      } else {
        this.awsSigner = new AwsSigner(
          this.awsAccessKeyId,
          this.awsSecretAccessKey,
          this.awsSessionToken
        );
      }

      console.log('[XSenseAPI] AWS IoT credentials obtained');
      // Set expiration to 50 minutes (3,000,000 ms) to be safe (tokens last 60 mins)
      this.awsTokenExpiration = Date.now() + 3000000;
    } else {
      console.warn('[XSenseAPI] No AWS credentials in response, Thing Shadow API may not work');
    }
  }

  /**
   * Ensure AWS Tokens are valid, refreshing if necessary
   */
  async _ensureAWSTokens() {
    if (!this.awsTokenExpiration || Date.now() > this.awsTokenExpiration) {
      console.log('[XSenseAPI] AWS tokens expired or missing, refreshing...');
      await this.getAWSTokens();
    }
  }

  /**
   * Make API call to XSense backend
   */
  async _apiCall(bizCode, params = {}, unauth = false) {
    const url = `${this.baseUrl}/app`;

    // Calculate MAC from params only (not the full body)
    const mac = unauth ? 'abcdefg' : this._calculateMac(params);

    // Build request body - params are spread at root level, not inside 'data'
    const body = {
      ...params,  // Spread params first (e.g., utctimestamp, houseId, etc.)
      bizCode: bizCode,
      appCode: this.appCode,
      clientType: this.clientType,
      version: this.appVersion,
      mac: mac
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    if (!unauth && this.accessToken) {
      headers['Authorization'] = this.accessToken;
    }

    try {
      console.log(`[XSenseAPI] Calling bizCode ${bizCode} with params:`, JSON.stringify(params));

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });

      console.log(`[XSenseAPI] Response status: ${response.status}`);

      // Handle 401 Unauthorized - Retry once
      if (response.status === 401 && !params._isRetry) {
        console.warn('[XSenseAPI] Received 401 Unauthorized, attempting re-login and retry...');
        try {
          // Force re-login
          await this.login();

          // Retry the call with _isRetry flag to prevent infinite loops
          const retryParams = { ...params, _isRetry: true };
          return await this._apiCall(bizCode, retryParams, unauth);
        } catch (retryError) {
          console.error('[XSenseAPI] Re-login/retry failed:', retryError);
          // Emit critical error for App to handle (Timeline notification)
          this._emitUpdate('error', {
            type: 'AUTH_FAILED',
            message: 'Session expired and re-login failed. Please check your credentials in settings.'
          });

          // If retry fails, throw the original error (or new one)
          throw new Error('Session expired and re-login failed');
        }
      }

      if (!response.ok) {
        const text = await response.text();
        console.error(`[XSenseAPI] Error response:`, text);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[XSenseAPI] Response data:`, JSON.stringify(data).substring(0, 500));

      // Check if response has error code (XSense uses reCode)
      // Check if response has error code (XSense uses reCode)
      const errorCode = data.reCode || data.code;
      if (errorCode !== undefined && errorCode !== 200 && errorCode !== 0) {
        const errorMsg = data.reMsg || data.msg || data.message || 'Unknown error';

        // Handle session expiration or "another device logged in"
        // 10000008/10000020 are known Session Expired codes
        if (['10000008', '10000020', '10000004'].includes(String(errorCode)) || errorMsg.includes('another device is logged in') || errorMsg.includes('Authorization cannot be empty')) {
          console.warn(`[XSenseAPI] Session invalid (Code: ${errorCode}, Msg: ${errorMsg}). Invalidating session.`);
          this.accessToken = null; // Force re-login flag for next call
          this.idToken = null;

          // If this was NOT a retry, we could throw a specific error to catch in the caller, 
          // OR we can rely on the upstream generic catch. 
          // Throwing 'Session expired' allows immediate retry if implemented in caller.
          throw new Error(`SessionExpired: ${errorMsg}`);
        }

        throw new Error(`API Error ${errorCode}: ${errorMsg}`);
      }

      return data;
    } catch (error) {
      console.error(`[XSenseAPI] API call failed (${bizCode}):`, error.message);

      // If we caught our own SessionExpired error, re-throw it so caller handles it (or just let it bubble)
      throw error;
    }
  }

  /**
   * Get all houses
   */
  async getHouses() {
    const response = await this._apiCall('102007', { utctimestamp: '0' });
    // XSense API returns house list in reData (not data.houseInfoList)
    return response?.reData || [];
  }

  /**
   * Get stations for a house
   */
  async getStations(houseId) {
    const response = await this._apiCall('103007', {
      houseId: houseId,
      utctimestamp: '0'
    });
    // XSense API returns station list in reData.stations
    const stations = response?.reData?.stations || [];
    console.log('[XSenseAPI] Stations data:', JSON.stringify(stations, null, 2));
    return stations;
  }

  /**
   * Get Thing Shadow (device/station data)
   */
  async getThingShadow(thingName, shadowName = 'baseInfo', mqttRegion = null) {
    // Ensure tokens are valid before request
    await this._ensureAWSTokens();

    // Use the MQTT region from house if provided, otherwise fall back to Cognito region
    const region = mqttRegion || this.region;

    let url = `https://${region}.x-sense-iot.com/things/${thingName}/shadow`;
    if (shadowName) {
      url += `?name=${shadowName}`;
    }

    const failureCount = this.shadowFailureCount.get(`${thingName}:${shadowName || 'default'}`) || 0;
    if (failureCount > 5) {
      return {};
    }

    if (!this.awsAccessKeyId || !this.awsSecretAccessKey || !this.awsSessionToken) {
      console.error('[XSenseAPI] Missing AWS credentials, cannot fetch Thing Shadow');
      return {};
    }

    const headers = this._signAWSRequest({
      method: 'GET',
      url,
      region,
      service: 'iotdata',
      payload: ''
    });
    headers['Content-Type'] = 'application/x-amz-json-1.0';

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: headers
      });

      if (!response.ok) {
        const text = await response.text();
        // Log the detailed error from AWS to help debug (e.g. ResourceNotFoundException)
        // console.warn(`[XSenseAPI] Failed to get shadow for ${thingName} (shadow=${shadowName || 'default'}): HTTP ${response.status} ${text}`);

        const key = `${thingName}:${shadowName || 'default'}`;
        this.shadowFailureCount.set(key, failureCount + 1);
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.shadowFailureCount.delete(`${thingName}:${shadowName || 'default'}`);

      // Support FLATTENED shadows (direct JSON) as well as standard AWS IoT shadows
      if (data.state && data.state.reported) {
        return data.state.reported;
      }
      // If it has 'state' but no 'reported', maybe it's desired? or just 'state'?
      // If it's just a flat object (like 2nd_systime seems to be), return it directly.
      return data;
    } catch (error) {
      // already logged specific error above for HTTP errors
      if (!error.message.startsWith('HTTP')) {
        console.error(`[XSenseAPI] Failed to get shadow for ${thingName}:`, error.message);
      }
      return {};
    }
  }

  /**
   * Get all devices from all houses and stations
   */
  async getAllDevices() {
    console.log('[XSenseAPI] Fetching all devices (Optimized - Fix 1.0.7 Applied)...');

    const houses = await this.getHouses();

    // Clear maps but keep existing references if needed? 
    // Actually, safer to rebuild to avoid stale devices.
    this.devices.clear();
    this.devicesBySn.clear();
    this.stations.clear();
    this.stationsBySn.clear();
    this.houses.clear();

    const allDevices = [];
    const allStations = [];

    // Phase 1: Populate core structure from API (Houses -> Stations -> Devices)
    // We need to do this FIRST so that we have the devices in the map when we parse shadows.
    for (const house of houses) {
      this.houses.set(house.houseId, house);
      const stations = await this.getStations(house.houseId);

      for (const station of stations) {
        // Enhance station data
        station.houseId = house.houseId;
        station.houseName = house.houseName;
        station.mqttRegion = house.mqttRegion;
        station.stationType = station.stationType || station.category;
        station.sn = station.sn || station.stationSn;
        station.stationSn = station.stationSn || station.sn;

        // Use userId from station to update house (if missing)
        // Use userId from station to update house (CRITICAL for Shared Accounts)
        // If the station has a userId (Owner ID), it overrides the House's userId (Viewer ID)
        // This ensures MQTT subscribes to the OWNER'S shadow, not the VIEWER'S shadow.
        if (station.userId) {
          if (house.userId !== station.userId) {
            console.log(`[XSenseAPI] Updating House ${house.houseId} owner: ${house.userId} -> ${station.userId} (from station ${station.stationName})`);
          }
          house.userId = station.userId;
          this.houses.set(house.houseId, house);
        }

        this.stations.set(station.stationId, station);
        if (station.stationSn) {
          this.stationsBySn.set(station.stationSn, station);
        }
        allStations.push(station);
        console.log(`[XSenseAPI] DEBUG: Station Object for ${station.stationName}:`, JSON.stringify(station, null, 2));

        // Process Devices immediately
        const devices = station.devices || [];

        // SPECIAL HANDLING: SC07-WX (WiFi Smoke Detector)
        // These appear as STATIONS with no child devices. We must treat the station itself as a device.
        if (station.category === 'SC07-WX' || station.category === 'XC01-WX' || station.category === 'XH02-WX') {
          console.log(`[XSenseAPI] Found WiFi Device (as Station): ${station.category} - ${station.stationName}`);

          // Fetch Dedicated WiFi Shadow
          try {
            // We MUST wait for this here to ensure listing has correct initial data
            const wifiShadow = await this.getWiFiDeviceShadow(station);
            if (wifiShadow) {
              console.log(`[XSenseAPI] Enriched ${station.stationSn} with WiFi Shadow data (Keys: ${Object.keys(wifiShadow).length})`);
              Object.assign(station, wifiShadow);
            }
          } catch (err) {
            console.error(`[XSenseAPI] Failed to enrich WiFi device ${station.stationSn}:`, err);
          }

          const wifiDevice = {
            id: station.stationId, // Use stationId as deviceId
            stationId: station.stationId,
            houseId: house.houseId,
            houseName: house.houseName,
            stationName: station.stationName,
            mqttRegion: house.mqttRegion,
            devUserId: station.userId,
            deviceName: station.stationName,
            deviceType: station.category, // Explicitly set type
            deviceSn: station.stationSn,

            // Map Mapped fields from Shadow
            onLine: station.onLine,
            wifiRssi: station.wifiRSSI || station.wifiRssi,
            alarmStatus: station.alarmStatus,
            muteStatus: station.muteStatus,
            coPpm: station.coPpm,
            coLevel: station.coLevel,
            batInfo: station.batInfo,
            temperature: station.temperature,
            humidity: station.humidity,

            ...station
          };

          this.devices.set(wifiDevice.id, wifiDevice);
          if (wifiDevice.deviceSn) {
            this.devicesBySn.set(wifiDevice.deviceSn, wifiDevice.id);
          }
          allDevices.push(wifiDevice);
        }

        for (const device of devices) {
          // SPECIAL HANDLING: Check for generic names or missing names (seen in STH51 logs)
          let finalName = device.deviceName;
          if (!finalName || finalName.startsWith('Station de base') || finalName === 'Sensore') {
            // If we have a generic name from the API, try to construct a better one
            // Format: "Type SN_Suffix" e.g. "STH51 3456"
            const suffix = (device.deviceSn || device.deviceSN || '').slice(-4);
            // Use type from device, fallback to 'Device'
            finalName = `${device.deviceType || 'Device'} ${suffix}`;
          }

          const deviceData = {
            ...device,
            id: device.deviceId || device.deviceSn,
            stationId: station.stationId,
            houseId: house.houseId,
            houseName: house.houseName,
            stationName: station.stationName,
            mqttRegion: house.mqttRegion,
            devUserId: station.userId,
            deviceSn: device.deviceSn || device.deviceSN || device.sn,
            name: finalName, // Use our improved name
            deviceName: finalName
          };

          this.devices.set(deviceData.id, deviceData);
          if (deviceData.deviceSn) {
            this.devicesBySn.set(deviceData.deviceSn, deviceData.id);
          }
          allDevices.push(deviceData);
        }
      }
    }

    // Phase 2: Fetch and Process Shadows (Enrichment)
    // Now that all devices are in the maps, we can safely parse the shadows.
    // We process stations in parallel for performance.
    const stationPromises = allStations.map(async (station) => {
      try {
        // VITAL: Fetch station shadow to get status (2nd_systime / 2nd_device_info / 2nd_mainpage)
        const stationShadow = await this._getStationShadowData(station);
        if (stationShadow) {
          // Merge shadow data into the station object
          Object.assign(station, stationShadow);

          // Also update the "Device" representation of the station if it's an SC07-WX
          if (station.category === 'SC07-WX') {
            const deviceId = this.devicesBySn.get(station.stationSn);
            if (deviceId) {
              const device = this.devices.get(deviceId);
              Object.assign(device, stationShadow);
            }
          }
        }
      } catch (err) {
        console.error(`[XSenseAPI] Failed to fetch shadow for station ${station.stationId}:`, err);
      }
    });

    // Also fetch House shadow if needed (optional, effectively handled inside getStationShadowData often)
    // but we might want to do it explicitly if needed.

    await Promise.all(stationPromises);

    console.log(`[XSenseAPI] Found ${allDevices.length} devices in ${allStations.length} stations`);

    return {
      devices: allDevices,
      stations: allStations,
      houses: Array.from(this.houses.values())
    };
  }

  /**
   * Force sync a specific device/station status from Cloud
   * (Blocking call for onInit)
   */
  async syncDevice(deviceId) {
    if (!deviceId) return;
    const device = this.devices.get(deviceId);

    // If we don't know the device yet (fresh start of app and no getAllDevices run yet),
    // we might need to run full discovery. 
    if (!device) {
      console.log('[XSenseAPI] Device not in cache, forcing full discovery...');
      await this.getAllDevices();
      return this.devices.get(deviceId);
    }

    // If we know the station, just refresh that station's shadows
    if (device.stationId) {
      const station = this.stations.get(device.stationId);
      if (station) {
        console.log(`[XSenseAPI] Force syncing station ${station.stationSn} for device ${device.deviceSn}`);

        // 1. Fetch Shadows
        const shadows = await this._getStationShadowData(station);

        // 2. Process Shadows (Update Map)
        if (shadows) {
          // Merge station global data
          Object.assign(station, shadows);

          // If there are device details in shadow (e.g. 2nd_mainpage devs map)
          if (shadows.devs) {
            for (const [key, val] of Object.entries(shadows.devs)) {
              // Find device by SN (key is SN)
              const targetId = this.devicesBySn.get(key);
              if (targetId) {
                const existing = this.devices.get(targetId);
                const merged = { ...existing, ...val };

                // Sanitize critical fields
                merged.alarmStatus = DataSanitizer.toInt(merged.alarmStatus);
                merged.coPpm = DataSanitizer.toInt(merged.coPpm);

                this.devices.set(targetId, merged);
              }
            }
          }
        }
        return this.devices.get(deviceId);
      }
    }
    return device;
  }

  /**
   * Get devices for a specific station
   */
  async getDevices(stationId) {
    const station = this.stations.get(stationId);
    if (!station) {
      console.warn(`[XSenseAPI] Station ${stationId} not found`);
      return [];
    }

    const stationType = station.stationType || station.category || '';
    const serial = station.sn || station.stationSn || '';

    if (!stationType || !serial) {
      console.warn(`[XSenseAPI] Missing station identifiers for ${stationId}`);
      return [];
    }

    // Fetch shadow data to update cache
    try {
      await this._getStationShadowData(station);
    } catch (err) {
      console.warn(`[XSenseAPI] Failed to update shadow for station ${stationId}:`, err);
    }

    // Return devices from our cache (which is updated by _getStationShadowData via getAllDevices or periodic updates)
    const devices = [];
    for (const device of this.devices.values()) {
      if (device.stationId === stationId) {
        devices.push(device);
      }
    }
    return devices;
  }

  /**
   * Get station state
   */
  async getStationState(stationId) {
    const station = this.stations.get(stationId);
    if (!station) {
      return {};
    }

    const stationType = station.stationType || station.category || '';
    const serial = station.sn || station.stationSn || '';
    if (!stationType || !serial) {
      console.warn(`[XSenseAPI] Missing station identifiers for ${stationId}`);
      return {};
    }

    return await this._getStationShadowData(station);
  }

  /**
   * Try multiple possible thing names for a house shadow
   */
  async _getHouseShadowData(house) {
    const defaultCandidates = this._getHouseThingNames(house);

    // Attempt 1: Regular candidates with baseInfo/default shadow
    let shadow = await this._getThingShadowFromCandidates(defaultCandidates, ['baseInfo', null], house.mqttRegion);
    if (Object.keys(shadow).length > 0) return shadow;

    // Attempt 2: userId as Thing Name, houseId as Shadow Name
    // We need to find a userId. Houses don't have it directly, but stations do.
    // Try to find ANY station in this house to get the userId
    const stations = await this.getStations(house.houseId);
    const userId = stations[0]?.userId;

    if (userId) {
      console.log(`[XSenseAPI] Trying userId ${userId} as ThingName for House ${house.houseId}`);
      // Try houseId as shadow name on the User Thing
      const userThingCandidates = [userId];
      const shadowNames = [house.houseId, `house_${house.houseId}`, null]; // Try Default Shadow too

      shadow = await this._getThingShadowFromCandidates(userThingCandidates, shadowNames, house.mqttRegion);
      if (Object.keys(shadow).length > 0) return shadow;
    }

    return {};
  }

  /**
   * Try multiple possible thing names for a station shadow
   */
  async _getStationShadowData(station) {
    // SPECIAL HANDLING for SC07-WX: Fetch and merge multiple specific shadows
    // These devices split data across '2nd_systime' (connectivity) and '2nd_info_SN' (battery/status)
    if (station.category === 'SC07-WX') {
      // console.log(`[XSenseAPI] Fetching merged shadows for SC07-WX ${station.stationName}`);
      let mergedShadow = {};

      // 1. Fetch 2nd_systime (Status, RSSI)
      const shadow1 = await this._getThingShadowFromCandidates(
        this._getStationThingNames(station),
        ['2nd_systime'],
        station.mqttRegion
      );
      Object.assign(mergedShadow, shadow1);

      // 2. Fetch 2nd_info (Battery, advanced info)
      const shadow2 = await this._getThingShadowFromCandidates(
        this._getStationThingNames(station),
        [`2nd_info_${station.stationSn || station.sn}`],
        station.mqttRegion
      );
      Object.assign(mergedShadow, shadow2);

      // 3. Fetch Status / Alarm status (Added for CO fix)
      // Must match list in getWiFiDeviceShadow
      const sn = station.stationSn || station.sn;
      const statusShadowCandidates = [
        `2nd_status_${sn}`,
        `status_${sn}`,
        '2nd_status',
        'status',
        '2nd_alarm_status',
        'alarm_status',
        // Also try mainpage/pwordup if they are awake?
        '2nd_mainpage',
        'mainpage'
      ];

      const shadow3 = await this._getThingShadowFromCandidates(
        this._getStationThingNames(station),
        statusShadowCandidates,
        station.mqttRegion
      );
      Object.assign(mergedShadow, shadow3);

      if (Object.keys(mergedShadow).length > 0) {
        console.log(`[XSenseAPI] Merged SC07-WX Shadow for ${station.stationSn}: Keys=${Object.keys(mergedShadow).join(',')}`);
        // console.log(`[XSenseAPI] Merged Content:`, JSON.stringify(mergedShadow));
        return mergedShadow;
      }
    }

    const defaultCandidates = this._getStationThingNames(station);

    // Attempt 1: Prioritize discovered named shadows.
    // Ensure we don't waste time on 'baseInfo' or 'null' if we are looking for specific XSense shadows
    let shadow = await this._getThingShadowFromCandidates(defaultCandidates, [
      '2nd_mainpage',    // FOUND IN HA SCRIPTS: main aggregator for devices
      'mainpage',        // Fallback found in HA scripts
      '2nd_systime',     // Station status (contains RSSI)
      `2nd_info_${station.stationSn || station.sn}`, // FOUND IN PYTHON CODE for SC07-WX
      `info_${station.stationSn || station.sn}`,     // Fallback
      '2nd_device_info', // Worth retrying for SC07-WX
      'device_info',     // Common variation
      '2nd_status',      // Common variation
      '2nd_status',      // Common variation
      'status',          // Common variation
      // SC07-WX specific guesses based on mapping keys
      `2nd_status_${station.stationSn || station.sn}`,
      `status_${station.stationSn || station.sn}`,
      `2nd_alarm_status_${station.stationSn || station.sn}`,
      `alarm_status_${station.stationSn || station.sn}`,
      'alarm_status',    // Specific to alarms?
      '2nd_alarm_status', // Variation

      // CRITICAL: Documentation suggests 'baseInfo' or default (null) shadow might contain the data if 2nd_systime doesn't
      'baseInfo',
      null               // The "Classic" Unnamed Shadow
    ], station.mqttRegion);

    if (Object.keys(shadow).length > 0) {
      // Parse 'devs' map if present (2nd_mainpage standard)
      if (shadow.devs) {
        console.log(`[XSenseAPI] Found 'devs' map in shadow! Parsing ${Object.keys(shadow.devs).length} devices.`);
        for (const [sn, data] of Object.entries(shadow.devs)) {
          // Find device by SN using cache - Case Insensitive Logic
          let deviceId = this.devicesBySn.get(sn) || this.devicesBySn.get(sn.toUpperCase());
          let device = deviceId ? this.devices.get(deviceId) : null;

          // Fallback linear search if strictly necessary, but cache should be good
          if (!device) {
            // Find ignoring case
            device = Array.from(this.devices.values()).find(d =>
              (d.deviceSn && d.deviceSn.toUpperCase()) === sn.toUpperCase()
            );
          }

          if (device) {
            Object.assign(device, data);
            // Map status properties if present
            if (data.status) {
              device.status = data.status; // Keep raw status

              // Standard Mappings
              if (data.status.alarmStatus) device.alarmStatus = data.status.alarmStatus;

              // X-Sense Minified Keys Mapping (Found in logs for STH51/SBS50 FW 1.6.9)
              // "a": "0" (Alarm?), "b": "21.0" (Temp), "c": "29.6" (Hum), "d": "1"
              if (data.status.b !== undefined) {
                device.temperature = parseFloat(data.status.b);
                // Ensure we set 'measure_temperature' capability-like property if needed by driver directly, 
                // though driver usually looks for .temperature or .temp
                console.log(`[XSenseAPI] Found minified Temp (b): ${device.temperature} for ${sn}`);
              }
              if (data.status.c !== undefined) {
                device.humidity = parseFloat(data.status.c);
                console.log(`[XSenseAPI] Found minified Hum (c): ${device.humidity} for ${sn}`);
              }
              if (data.status.a !== undefined) device.alarmStatus = data.status.a;
            }  // Map alarmStatus if present
            if (data.alarmStatus) device.alarmStatus = data.alarmStatus;
            // console.log(`[XSenseAPI] Updated device ${sn} from shadow data`);
          } else {
            console.warn(`[XSenseAPI] Shadow data found for unknown device SN: ${sn}`);
          }
        }
      }

      // Debug: Log the ENTIRE shadow object to see structure
      console.log(`[XSenseAPI] DEBUG: FULL SHADOW CONTENT for station ${station.stationId}:`, JSON.stringify(shadow, null, 2));
      return shadow;
    }

    // Fallback: Only check legacy/default shadows if the above failed
    shadow = await this._getThingShadowFromCandidates(defaultCandidates, ['baseInfo', null], station.mqttRegion);
    if (Object.keys(shadow).length > 0) return shadow;

    // Attempt 2: userId as Thing Name, stationId/stationSn as Shadow Name
    if (station.userId) {
      console.log(`[XSenseAPI] Trying userId ${station.userId} as ThingName for Station ${station.stationId}`);
      const userThingCandidates = [station.userId];
      const shadowNames = [
        station.stationId,
        station.stationSn,
        `station_${station.stationId}`,
        `station_${station.stationSn}`,
        '2nd_systime', // Discovered via Spy Mode
        '2nd_device_info', // Potential other shadow
        null
      ];

      shadow = await this._getThingShadowFromCandidates(userThingCandidates, shadowNames, station.mqttRegion);
      if (Object.keys(shadow).length > 0) return shadow;
    }

    return {};
  }

  /**
   * Get WiFi device shadow (SC07-WX, XC01-WX, etc.)
   * WiFi devices use different shadow names than RF devices
   */
  async getWiFiDeviceShadow(station) {
    const thingName = this._buildStationShadowName(station);
    const region = station.mqttRegion || this.region;

    console.log(`[XSenseAPI] Fetching WiFi device shadow: ${thingName}`);

    // Try primary shadows in order of importance
    // SC07-WX might use '2nd_mainpage' or 'status' for sensor data
    // CRITICAL: SC07-WX often appends the SN to the shadow name (e.g. 2nd_info_SN, 2nd_status_SN)
    const sn = station.stationSn || station.sn;
    // Optimized list: Only fetch what we know works or is essential
    let shadowNames = [
      '2nd_systime',        // Metadata (IP, RSSI, FW) - WORKS
      `2nd_info_${sn}`,     // Static info (MAC, etc) - WORKS

      // Potential sensor data shadows - Keep the most likely ones
      `2nd_status_${sn}`,
      '2nd_status',

      // These usually 404 on sleeping devices but are the source of truth for sensors.
      // We keep them in case the device IS awake, but we expect them to fail often.
      'mainpage',
      'pwordup'
    ];

    // Also try without prefix if needed
    const altThingName = station.stationSn;

    // EXTENDED GUESSING LIST REMOVED - Caused too many 404s

    let aggregatedData = {};

    for (const shadowName of shadowNames) {
      try {
        let shadow = await this.getThingShadow(thingName, shadowName, region);

        // DEBUG: Explicitly log result for mainpage/pwordup/status to see WHY they fail
        // if (['mainpage', 'pwordup'].includes(shadowName)) {
        //      const keyCount = shadow ? Object.keys(shadow).length : 0;
        //      console.log(`[XSenseAPI] DEBUG: Fetch ${shadowName} for ${thingName} result: Keys=${keyCount}`, shadow ? JSON.stringify(shadow) : 'NULL');
        // }

        // Fallback: Try alternative Thing Name (SN only) if primary failed
        if (!shadow || Object.keys(shadow).length === 0) {
          try {
            const altShadow = await this.getThingShadow(altThingName, shadowName, region);
            if (altShadow && Object.keys(altShadow).length > 0) {
              // console.log(`[XSenseAPI] Found data in ${shadowName} using Alt-ThingName ${altThingName}`);
              shadow = altShadow;
            }
          } catch (ignore) { }
        }


        if (shadow && Object.keys(shadow).length > 0) {
          console.log(`[XSenseAPI] Found '${shadowName}' shadow for ${thingName} (${Object.keys(shadow).length} keys)`);

          // DEBUG: Log content of interesting shadows (Reduced verbosity)
          /*
          if (shadowName.includes('2nd_info') || shadowName.includes('systime') || shadowName.includes('native')) {
            console.log(`[XSenseAPI] CONTENT ${shadowName}:`, JSON.stringify(shadow));
          }
          */

          Object.assign(aggregatedData, shadow);


          // SC07-WX Special: Status might be nested in "status" property or just flat
          // If we found a status shadow, ensuring we map the internal status if needed
          if (shadow.status) {
            console.log(`[XSenseAPI] Found 'status' object in ${shadowName}`);
            Object.assign(aggregatedData, shadow.status);
          }
        } else {
          // console.log(`[XSenseAPI] Shadow ${shadowName} is empty for ${thingName}`);
        }
      } catch (error) {
        console.warn(`[XSenseAPI] Failed to get ${shadowName} shadow for ${thingName}:`, error.message);
      }
    }

    return aggregatedData;
  }

  /**
   * Helper to list named shadows using REST API (standard AWS IoT endpoint /api/things/...)
   */
  async _listNamedShadowsForThing(thingName, mqttRegion = null) {
    const region = mqttRegion || this.region;
    // Per AWS IoT docs: GET /api/things/{thingName}/shadow
    const url = `https://${region}.x-sense-iot.com/api/things/${thingName}/shadow`;

    const idx = `${thingName}:list_shadows`;
    const failureCount = this.shadowFailureCount?.get(idx) || 0;
    if (failureCount > 3) return null;

    if (!this.awsAccessKeyId || !this.awsSecretAccessKey || !this.awsSessionToken) {
      return null;
    }

    const headers = this._signAWSRequest({
      method: 'GET',
      url,
      region,
      service: 'iotdata',
      payload: ''
    });
    // headers['Content-Type'] = 'application/json'; // Not strictly needed for GET but safe?

    try {
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        console.warn(`[XSenseAPI] List shadows failed: ${response.status} ${response.statusText} for ${url}`);
        // this.shadowFailureCount?.set(idx, failureCount + 1); // Don't block retries during debug
        return null;
      }
      const data = await response.json();
      // timestamp, results, nextToken
      return data;
    } catch (err) {
      console.warn(`[XSenseAPI] List shadows error:`, err);
      return null;
    }
  }

  /**
   * Request temperature/humidity data sync for STH51 devices
   * Sends a shadow update to trigger server-side data push
   */
  async requestTempDataSync(stationId, deviceIds) {
    // console.log(`[XSenseAPI] Requesting temp data sync for station ${stationId}, devices:`, deviceIds);

    // Ensure tokens are valid
    await this._ensureAWSTokens();

    const station = this.stations.get(stationId);
    if (!station) {
      console.warn(`[XSenseAPI] Station ${stationId} not found`);
      return;
    }

    const thingName = this._buildStationShadowName(station);
    const shadowName = '2nd_apptempdata';

    // Build SyncTempDataBean payload
    const payload = {
      state: {
        desired: {
          shadow: "appTempData",
          stationSN: station.stationSn,
          deviceSN: deviceIds,           // Array of device SNs
          source: "1",                   // App source
          report: "1",                   // Enable reporting
          reportDst: "",                 // Empty or specific destination
          timeoutM: "5"                  // 5 minute timeout
        }
      }
    };

    // Use Thing Shadow API to update
    const region = station.mqttRegion || this.region;
    const url = `https://${region}.x-sense-iot.com/things/${thingName}/shadow?name=${shadowName}`;

    const headers = this._signAWSRequest({
      method: 'POST',
      url,
      region,
      service: 'iotdata',
      payload: JSON.stringify(payload)
    });
    headers['Content-Type'] = 'application/json';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        // const text = await response.text();
        // console.error(`[XSenseAPI] Shadow update failed: ${response.status} ${text}`);
        return false;
      }

      console.log(`[XSenseAPI] Temp data sync requested successfully for ${station.stationName}`);
      return true;
    } catch (error) {
      console.error(`[XSenseAPI] Failed to request temp data sync:`, error.message);
      return false;
    }
  }

  _buildStationShadowName(station) {
    let type = station.stationType || station.category || '';

    // SC07-WX uses "-" as separator (e.g. SC07-WX-12345678)
    if (type === 'SC07-WX' || type === 'XC01-WX' || type === 'XH02-WX' || type === 'XS01-WX') {
      const serial = station.stationSn || station.sn || '';
      return `${type}-${serial}`;
    }

    // SBS10 has no Type-Prefix? (Legacy logic, keeping safe)
    if (type === 'SBS10') {
      type = '';
    }

    const serial = station.stationSn || station.sn || '';
    return `${type}${serial}`;
  }

  _getStationThingNames(station) {
    const names = [];

    // Primary Candidate: The correctly built Thing Name
    const builtName = this._buildStationShadowName(station);
    if (builtName) names.push(builtName);

    // Fallbacks
    const add = (value) => {
      if (value) {
        const trimmed = value.trim();
        if (trimmed && !names.includes(trimmed)) {
          names.push(trimmed);
        }
      }
    };

    const addVariants = (value) => {
      if (!value) return;
      add(value);
      add(value.toLowerCase());
      add(value.toUpperCase());
    };

    const stationType = station.stationType || station.category || '';
    const stationTypeLower = stationType.toLowerCase();
    const serial = station.sn || station.stationSn || '';
    const stationSn = station.stationSn || '';
    const stationId = station.stationId || station.id || '';
    const houseId = station.houseId || station.house_id || '';

    const typeVariants = [stationType, stationTypeLower];
    const serialVariants = [serial, stationSn];

    for (const type of typeVariants) {
      for (const ser of serialVariants) {
        if (!type || !ser) continue;
        addVariants(`${type}${ser}`);
        addVariants(`${type}_${ser}`);
        addVariants(`${type}-${ser}`);
        addVariants(`${type}SN${ser}`);
        addVariants(`${type}_SN${ser}`);
        addVariants(`${type}-SN-${ser}`);
      }
    }

    addVariants(serial);
    addVariants(stationSn);
    addVariants(stationId);

    if (stationId) {
      addVariants(`station_${stationId}`);
      addVariants(`station-${stationId}`);
      addVariants(`station${stationId}`);
    }

    if (serial) {
      addVariants(`station_${serial}`);
      addVariants(`station-${serial}`);
      addVariants(`station${serial}`);
    }

    if (houseId && stationId) {
      addVariants(`${houseId}_${stationId}`);
      addVariants(`${houseId}-${stationId}`);
      addVariants(`${houseId}${stationId}`);
    }

    if (houseId && serial) {
      addVariants(`${houseId}_${serial}`);
      addVariants(`${houseId}-${serial}`);
      addVariants(`${houseId}${serial}`);
    }

    return names;
  }

  _getHouseThingNames(house) {
    const names = [];
    const add = (value) => {
      if (value) {
        const trimmed = value.trim();
        if (trimmed && !names.includes(trimmed)) {
          names.push(trimmed);
        }
      }
    };

    const addVariants = (value) => {
      if (!value) return;
      add(value);
      add(value.toLowerCase());
      add(value.toUpperCase());
    };

    const houseId = house.houseId || house.id || '';
    const houseName = (house.houseName || '').replace(/\s+/g, '_');

    addVariants(`house_${houseId}`);
    addVariants(`house-${houseId}`);
    addVariants(`house${houseId}`);
    addVariants(houseId);
    addVariants(houseName ? `house_${houseName}` : '');
    addVariants(houseName);

    return names;
  }

  async _getThingShadowFromCandidates(thingCandidates, shadowCandidates = ['baseInfo', null], region) {
    const fetchRegion = region || this.region;

    // Normalize shadow candidates (convert null to null, strings to string)
    const normalizedShadows = shadowCandidates.map(s => s === 'null' ? null : s);

    let aggregatedShadow = {};
    let foundAny = false;

    for (const thingName of thingCandidates) {
      if (!thingName) continue;

      let foundForThisThing = false;

      for (const shadowName of normalizedShadows) {
        // Skip if we've failed this specific combination too many times
        const shadowKey = `${thingName}:${shadowName || 'default'}`;
        if ((this.shadowFailureCount.get(shadowKey) || 0) > 5) {
          continue;
        }

        const shadow = await this.getThingShadow(
          thingName,
          shadowName,
          fetchRegion
        );

        if (shadow && Object.keys(shadow).length > 0) {
          console.log(`[XSenseAPI] SUCCESS: Found shadow! Thing=${thingName}, Shadow=${shadowName || 'default'}`);

          Object.assign(aggregatedShadow, shadow);
          if (shadow.state && shadow.state.reported) {
            if (!aggregatedShadow.state) aggregatedShadow.state = { reported: {} };
            if (!aggregatedShadow.state.reported) aggregatedShadow.state.reported = {};
            Object.assign(aggregatedShadow.state.reported, shadow.state.reported);
          }

          foundAny = true;
          foundForThisThing = true;
        }
      }

      if (foundForThisThing) {
        return aggregatedShadow;
      }
    }

    return {};
  }

  /**
   * Sign AWS Thing Shadow requests using SigV4
   */
  _signAWSRequest({ method, url, region, service, payload = '' }) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.substring(0, 8);

    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const canonicalUri = parsedUrl.pathname || '/';

    const queryEntries = Array.from(parsedUrl.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    const canonicalQuerystring = queryEntries.join('&');

    const canonicalHeadersList = [
      ['host', host],
      ['x-amz-date', amzDate]
    ];

    if (this.awsSessionToken) {
      canonicalHeadersList.push(['x-amz-security-token', this.awsSessionToken]);
    }

    canonicalHeadersList.sort(([a], [b]) => a.localeCompare(b));

    const canonicalHeaders = canonicalHeadersList
      .map(([key, value]) => `${key}:${value}`)
      .join('\n') + '\n';

    const signedHeaders = canonicalHeadersList
      .map(([key]) => key)
      .join(';');

    const payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    const signingKey = this._getSignatureKey(this.awsSecretAccessKey, dateStamp, region, service);
    const signature = crypto.createHmac('sha256', signingKey)
      .update(stringToSign, 'utf8')
      .digest('hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${this.awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const signedHeadersObject = {
      Host: host,
      'X-Amz-Date': amzDate,
      Authorization: authorizationHeader
    };

    if (this.awsSessionToken) {
      signedHeadersObject['X-Amz-Security-Token'] = this.awsSessionToken;
    }

    return signedHeadersObject;
  }

  _getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    return kSigning;
  }

  /**
   * Test device alarm
   */
  async testAlarm(deviceId) {
    // This would need the proper API bizCode - to be determined
    console.log(`[XSenseAPI] Test alarm for device ${deviceId}`);
    // Implementation pending - need to find correct bizCode
    return true;
  }

  /**
   * Mute device alarm
   */
  /**
   * Mute device alarm
   * Uses MQTT Shadow update to silence the alarm
   */
  async muteAlarm(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('Device not found');

    const stationSn = device.stationSn || device.deviceSn;
    const type = device.deviceType || device.type;

    console.log(`[XSenseAPI] Muting alarm for ${type} (${device.deviceSn}) on Station ${stationSn}`);

    // Construct Payload
    // Based on docs: 2nd_muteup or mutekey
    let topic, payload;

    if (type === 'SC07-WX' || type === 'XC01-WX') {
      // WiFi Devices: try 'mutekey' shadow
      // Topic: $aws/things/SC07-WX-{sn}/shadow/name/mutekey/update
      const thingName = `SC07-WX-${stationSn}`;
      topic = `$aws/things/${device.userId}/shadow/name/mutekey/update`; // Using UserID path structure is safer often
      // Alternatively: $aws/things/${thingName}/shadow/name/mutekey/update

      // Actually, let's use the station-based construction if possible or user-based
      // Let's rely on setStationConfig logic style but for specific shadow

      // We will try sending to the userId based topic first as it's generic
      topic = `$aws/things/${device.userId}/shadow/name/mutekey/update`;
      payload = { state: { desired: { mute: "1" } } };
    } else {
      // RF Devices (connected to SBS50)
      // Topic: $aws/things/{stationSn}/shadow/name/2nd_muteup/update
      // Need to check if userId path works here too.
      topic = `$aws/things/${device.userId}/shadow/name/2nd_muteup/update`;
      payload = {
        state: {
          desired: {
            muteStatus: "1",
            deviceSN: device.deviceSn
          }
        }
      };
    }

    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        return reject(new Error('MQTT Client not connected'));
      }

      console.log(`[XSenseAPI] Publishing Mute to ${topic}`);
      this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  /**
   * Connect to MQTT for real-time updates
   */
  async connectMQTT(houseId, stationId) {
    await this._ensureAWSTokens();

    const legacyConfig = await this.getLegacyMqttConfig(stationId);
    if (legacyConfig) {
      const broker = legacyConfig.broker || legacyConfig.url || legacyConfig.host;
      const username = legacyConfig.username || legacyConfig.user;
      const password = legacyConfig.password || legacyConfig.pass;
      const clientId = legacyConfig.clientId || `homey_${stationId}_${Date.now()}`;

      if (broker && username && password) {
        const mqttKey = `legacy:${stationId}`;
        if (this.mqttClients.has(mqttKey)) {
          return this.mqttClients.get(mqttKey).client;
        }

        console.log(`[XSenseAPI] Using legacy MQTT config for station ${stationId}`);
        const client = mqtt.connect(broker, {
          clientId,
          username,
          password,
          clean: true,
          reconnectPeriod: 5000,
          rejectUnauthorized: false
        });

        const info = {
          client,
          house: { houseId },
          subscriptions: new Set(),
          wsPath: null
        };

        this.mqttClients.set(mqttKey, info);
        client.on('connect', () => {
          console.log(`[XSenseAPI] Legacy MQTT connected for station ${stationId}`);
          this._subscribeLegacyTopics(info, houseId, stationId);
        });

        client.on('message', (topic, payload) => {
          this._handleMQTTMessage(topic, payload);
        });

        client.on('error', (error) => {
          console.error('[XSenseAPI] Legacy MQTT error:', error && error.message ? error.message : error);
        });

        return client;
      }
    }

    const house = this._resolveHouse(houseId, stationId);
    if (!house) {
      console.warn('[XSenseAPI] Cannot resolve house for MQTT connection');
      return null;
    }

    const mqttKey = house.houseId;
    if (this.mqttClients.has(mqttKey)) {
      const info = this.mqttClients.get(mqttKey);
      this._subscribeStationTopics(info, stationId);
      return info.client;
    }

    if (!this.awsSigner) {
      this.awsSigner = new AwsSigner(
        this.awsAccessKeyId,
        this.awsSecretAccessKey,
        this.awsSessionToken
      );
    }

    const baseUrl = `wss://${house.mqttServer}`;
    const presignBaseUrl = `wss://${house.mqttServer}/mqtt`;

    const debugConfig = this._getSignerDebugConfig();
    const signerDebugEnabled = process.env.XSENSE_SIGNER_DEBUG === '1' || (debugConfig && debugConfig.enabled);
    const signerDebugFixedDate = process.env.XSENSE_SIGNER_DEBUG_TIME || (debugConfig && debugConfig.fixedDate) || null;

    if (signerDebugEnabled && this.awsSigner && this.awsSigner.useAws4) {
      console.log('[XSenseAPI] SIGNER DEBUG forcing custom signer (useAws4=false)');
      this.awsSigner.useAws4 = false;
    }

    const logSignerDebug = (debug) => {
      if (this._signerDebugLogged) {
        return;
      }
      this._signerDebugLogged = true;
      console.log('[XSenseAPI] SIGNER DEBUG BEGIN');
      const lines = [
        `amzDate=${debug.amzDate || ''}`,
        `dateStamp=${debug.dateStamp || ''}`,
        `credentialScope=${debug.credentialScope || ''}`,
        `credential=${debug.credential || ''}`,
        `canonicalQuerystring=${debug.canonicalQuerystring || ''}`,
        `canonicalHeaders=${JSON.stringify(debug.canonicalHeaders || '')}`,
        `payloadHash=${debug.payloadHash || ''}`,
        `canonicalRequest=${JSON.stringify(debug.canonicalRequest || '')}`,
        `stringToSign=${JSON.stringify(debug.stringToSign || '')}`,
        `signature=${debug.signature || ''}`,
        `requestQuery=${debug.requestQuery || ''}`,
        `host=${debug.host || ''}`,
        `path=${debug.path || ''}`,
        `fixedDate=${debug.fixedDate || ''}`
      ];
      for (const line of lines) {
        console.log(`[XSenseAPI] SIGNER DEBUG ${line}`);
      }
      console.log('[XSenseAPI] SIGNER DEBUG END');
    };

    const presignPath = (reason) => {
      let signedUrl;
      if (signerDebugEnabled) {
        const result = this.awsSigner.presignWebsocketUrlWithDebug(
          presignBaseUrl,
          house.mqttRegion,
          signerDebugFixedDate ? { fixedDate: signerDebugFixedDate } : {}
        );
        signedUrl = result.url;
        if (result.debug) {
          logSignerDebug(result.debug);
        }
      } else {
        signedUrl = this.awsSigner.presignWebsocketUrl(presignBaseUrl, house.mqttRegion);
      }
      let rawPath = '/mqtt';
      const schemeIndex = signedUrl.indexOf('://');
      if (schemeIndex !== -1) {
        const pathIndex = signedUrl.indexOf('/', schemeIndex + 3);
        if (pathIndex !== -1) {
          rawPath = signedUrl.substring(pathIndex);
        }
      }
      try {
        const parsed = new URL(signedUrl);
        const queryPreview = parsed.search ? parsed.search.substring(0, 80) : '';
        if (this.awsSigner.lastAmzDate) {
          console.log(`[XSenseAPI] MQTT presign time local=${this.awsSigner.lastLocalIso} amz=${this.awsSigner.lastAmzDate}`);
        }
        console.log(`[XSenseAPI] MQTT presign (${reason || 'initial'}) host=${parsed.host} path=${parsed.pathname} query=${queryPreview}...`);
        return rawPath;
      } catch (error) {
        console.error('[XSenseAPI] Failed to inspect presigned MQTT URL:', error.message);
        return rawPath;
      }
    };

    let currentPath = presignPath('connect');

    const origin = `https://${house.mqttServer}`;
    const client = mqtt.connect(baseUrl, {
      protocolVersion: 4,
      clean: true,
      reconnectPeriod: 30000,
      username: '?SDK=iOS&Version=2.26.5',
      password: '',
      rejectUnauthorized: false,
      clientId: `homey_${house.houseId}_${Date.now()}`,
      path: currentPath,
      transformWsUrl: (url) => {
        console.log(`[XSenseAPI] MQTT ws url: ${url}`);
        return url;
      },
      wsOptions: {
        headers: {
          Host: house.mqttServer,
          Origin: origin
        },
        perMessageDeflate: false,
        servername: house.mqttServer
      }
    });

    const info = {
      client,
      house,
      subscriptions: new Set(),
      wsPath: currentPath
    };

    this.mqttClients.set(mqttKey, info);

    const logWsHeaders = (reason) => {
      const ws = client.stream && client.stream.ws ? client.stream.ws : null;
      const req = ws && ws._req ? ws._req : null;
      if (!req) {
        return;
      }
      const headerLines = [];
      if (typeof req.getHeader === 'function') {
        const keys = ['host', 'origin', 'sec-websocket-protocol', 'sec-websocket-extensions', 'user-agent', 'connection', 'upgrade'];
        for (const key of keys) {
          const value = req.getHeader(key);
          if (value !== undefined) {
            headerLines.push(`${key}: ${value}`);
          }
        }
      }
      if (req._header) {
        headerLines.push('raw: ' + req._header.replace(/\r?\n/g, ' | '));
      }
      if (headerLines.length) {
        console.log(`[XSenseAPI] MQTT ws request headers (${reason}): ${headerLines.join(' ; ')}`);
      }

      if (ws && typeof ws.on === 'function' && !ws.__xsenseUnexpectedHandler) {
        ws.__xsenseUnexpectedHandler = true;
        ws.on('unexpected-response', (request, response) => {
          const status = response && response.statusCode ? response.statusCode : 'unknown';
          const statusMessage = response && response.statusMessage ? response.statusMessage : '';
          console.error(`[XSenseAPI] MQTT unexpected response: ${status} ${statusMessage}`);
          if (response && response.headers) {
            console.error(`[XSenseAPI] MQTT unexpected headers: ${JSON.stringify(response.headers)}`);
          }
          let body = '';
          if (response) {
            response.on('data', (chunk) => {
              body += chunk.toString();
            });
            response.on('end', () => {
              if (body) {
                console.error(`[XSenseAPI] MQTT unexpected body: ${body}`);
              }
            });
          }
        });
      }
    };

    setTimeout(() => logWsHeaders('initial'), 0);

    const refreshPath = (reason) => {
      const newPath = presignPath(reason);
      if (newPath && newPath !== info.wsPath) {
        client.options.path = newPath;
        info.wsPath = newPath;
      }
    };

    client.on('connect', () => {
      logWsHeaders('connect');
      refreshPath('on-connect');
      console.log(`[XSenseAPI] MQTT connected for house ${house.houseId}`);
      this._subscribeHouseTopics(info);
      for (const station of this._getStationsByHouse(house.houseId)) {
        this._subscribeStationTopics(info, station.stationId);
      }
      if (stationId) {
        this._subscribeStationTopics(info, stationId);
      }
    });

    client.on('reconnect', () => {
      refreshPath('reconnect');
    });

    client.on('message', (topic, payload) => {
      this._handleMQTTMessage(topic, payload);
    });

    client.on('error', (error) => {
      const wsUrl = client.stream && client.stream.url ? client.stream.url : 'unknown';
      console.error('[XSenseAPI] MQTT error:', error && error.message ? error.message : error);
      console.error(`[XSenseAPI] MQTT ws url (error): ${wsUrl}`);
    });

    client.stream.on('close', (code, reason) => {
      const wsUrl = client.stream && client.stream.url ? client.stream.url : 'unknown';
      console.warn(`[XSenseAPI] MQTT stream closed: code=${code}, reason=${reason}`);
      console.warn(`[XSenseAPI] MQTT ws url (close): ${wsUrl}`);
    });

    client.stream.on('error', (error) => {
      const wsUrl = client.stream && client.stream.url ? client.stream.url : 'unknown';
      console.error('[XSenseAPI] MQTT stream error:', error && error.message ? error.message : error);
      console.error(`[XSenseAPI] MQTT ws url (stream error): ${wsUrl}`);
    });

    return client;
  }

  _subscribeLegacyTopics(info, houseId, stationId) {
    const topics = [
      `house/${houseId}/event`,
      `house/${houseId}/shadow/+/update`,
      `house/${houseId}/presence/station/${stationId}`
    ];

    topics.forEach((topic) => {
      if (info.subscriptions.has(topic)) {
        return;
      }
      info.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`[XSenseAPI] Failed to subscribe to ${topic}:`, err.message || err);
        } else {
          info.subscriptions.add(topic);
        }
      });
    });
  }

  _subscribeHouseTopics(info) {
    const topics = [
      `@xsense/events/+/${info.house.houseId}`,
      `$aws/things/${info.house.houseId}/shadow/name/+/update`
    ];

    // Add subscription for userId-based shadow updates if userId is known for this house
    if (info.house.userId) {
      // Try both house ID and 'house_ID' as shadow names
      topics.push(`$aws/things/${info.house.userId}/shadow/name/${info.house.houseId}/update`);
      topics.push(`$aws/things/${info.house.userId}/shadow/name/house_${info.house.houseId}/update`);
      // Wildcard for named shadows (DISCOVERY)
      topics.push(`$aws/things/${info.house.userId}/shadow/name/+/update`);
      // Classic Shadow (Default)
      topics.push(`$aws/things/${info.house.userId}/shadow/update`);
    }

    // SPY MODE: Try to catch anything (Unconditional)
    console.log('[XSenseAPI] Enabling Spy Mode for House', info.house.houseId);
    topics.push('xsense/#');
    topics.push('events/#');
    topics.push('device/#');
    topics.push('station/#');
    topics.push('+');
    topics.push('+/+');
    topics.push('+/+/+');

    topics.forEach(topic => this._subscribeTopic(info, topic));
  }

  _subscribeStationTopics(info, stationId) {
    if (!stationId) {
      return;
    }
    const station = this.stations.get(stationId);
    if (!station) {
      return;
    }

    // Determine if this is a WiFi-Direct Device
    const isWiFiDevice = ['SC07-WX', 'XC01-WX', 'XH02-WX', 'XS01-WX'].includes(station.category);
    const typeSnThing = this._buildStationShadowName(station);

    if (isWiFiDevice && typeSnThing) {
      console.log(`[XSenseAPI] Subscribing to WiFi Device topics for ${station.stationName} (${typeSnThing})`);

      const topics = [
        // Primary Status Shadow
        `$aws/things/${typeSnThing}/shadow/name/mainpage/update`,
        `$aws/things/${typeSnThing}/shadow/name/mainpage/update/accepted`,
        `$aws/things/${typeSnThing}/shadow/name/mainpage/update/delta`,

        // Power Up & Config Shadow
        `$aws/things/${typeSnThing}/shadow/name/pwordup/update`,

        // Mute Status Shadow
        `$aws/things/${typeSnThing}/shadow/name/muteup/update`,

        // System Time/Status Shadow
        `$aws/things/${typeSnThing}/shadow/name/2nd_systime/update`,

        // Default Shadow (Fallback)
        `$aws/things/${typeSnThing}/shadow/update`,

        // Discovery Wildcard
        `$aws/things/${typeSnThing}/shadow/name/+/update`
      ];

      // WiFi Devices (SC07-WX, etc)
      if (['SC07-WX', 'XC01-WX', 'XH02-WX'].includes(station.category) || station.category.endsWith('-WX')) {
        const thingName = this._buildStationShadowName(station);
        console.log(`[XSenseAPI] Subscribing to WiFi Device topics for ${station.stationName} (${thingName})`);

        // CORRECTION: use $aws/things/... format (standard AWS IoT), NOT sns/iot/...
        const wifiTopics = [
          `$aws/things/${thingName}/shadow/name/mainpage/update`,
          `$aws/things/${thingName}/shadow/name/mainpage/update/accepted`,
          `$aws/things/${thingName}/shadow/name/mainpage/update/delta`,

          `$aws/things/${thingName}/shadow/name/pwordup/update`,
          `$aws/things/${thingName}/shadow/name/pwordup/update/accepted`,

          `$aws/things/${thingName}/shadow/name/muteup/update`,
          `$aws/things/${thingName}/shadow/name/muteup/update/accepted`,

          `$aws/things/${thingName}/shadow/name/2nd_systime/update`,

          // Fallback / Discovery
          `$aws/things/${thingName}/shadow/update`,
          `$aws/things/${thingName}/shadow/name/+/update`
        ];

        wifiTopics.forEach(topic => this._subscribeTopic(info, topic));
      }

      topics.forEach(topic => this._subscribeTopic(info, topic));
      return; // WiFi devices have different topology, don't subscribe to station topics below
    }

    // --- Standard RF Station Logic (SBS50 etc) ---

    // Original shadowName logic (might be wrong, but keep it)
    if (station.shadowName) {
      const topics = [
        `$aws/things/${station.shadowName}/shadow/name/+/update`,
        `$aws/events/presence/+/${station.shadowName}`
      ];
      topics.forEach(topic => this._subscribeTopic(info, topic));
    }

    // New userId-based logic (likely correct)
    if (station.userId) {
      const topics = [
        `$aws/things/${station.userId}/shadow/name/${station.stationId}/update`,
        `$aws/things/${station.userId}/shadow/name/${station.stationSn}/update`,
      ];
      // SPY result: Thing Name is Type+SN (e.g. SBS5014998680)
      if (typeSnThing) {
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_systime/update`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_systime/update/accepted`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_systime/update/delta`);

        // Low Power / RF Station topics
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_mainpage/update`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_mainpage/update/accepted`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_mainpage/update/delta`);

        // STH51 Specific Topics (from refresh.md)
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_tempdatalog/update`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_extendmuteup/update`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_extendalarm/update`);

        // Try 2nd_device_info as well (likely contains device list)
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_device_info/update`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_device_info/update/accepted`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_device_info/update/delta`);

        topics.push(`$aws/things/${typeSnThing}/shadow/name/+/update`); // Discovery for other shadows
      }
      // Also try 'station_' prefixed versions just in case
      topics.push(`$aws/things/${station.userId}/shadow/name/station_${station.stationId}/update`);
      // Wildcard for named shadows (DISCOVERY)
      topics.push(`$aws/things/${station.userId}/shadow/name/+/update`);
      // Classic Shadow (Default)
      topics.push(`$aws/things/${station.userId}/shadow/update`);

      // *** EVENT TOPICS (Critical for Alarms) ***
      // Maximum Integration Strategy: Subscribe to everything known
      if (station.houseId) {
        const houseTopics = [
          `@xsense/events/house/${station.houseId}`,       // Alarme (Rauch, CO, Wasser)
          `@xsense/events/safealarm/${station.houseId}`,   // Security Alarme
          `@xsense/events/shareadd/${station.houseId}`,    // Sharing
          `@xsense/events/shareupt/${station.houseId}`,    // Sharing Update
          `@xsense/events/lampgroup/${station.houseId}`,   // Lichtgruppen
          `@xsense/events/lampsched/${station.houseId}`,   // Lichtpläne
          `@xsense/events/securityplan/${station.houseId}` // Security Pläne
        ];
        houseTopics.forEach(t => {
          topics.push(t);
        });
      }

      // Station/Device based events
      if (typeSnThing) {
        // Extrahiere SN aus TypeName (z.B. SC07-WX-1234 -> 1234) oder nutze stationSN
        const sn = station.stationSn || station.deviceSn;
        if (sn) {
          const deviceTopics = [
            `@xsense/events/tempcleanlog/${sn}`, // Log Clear
            `@xsense/events/master/${sn}`,       // Master Register
            `@claybox/events/sospush/${sn}`,     // SOS Button (!)
            `@claybox/events/keyboard/${sn}`     // Keypad Events
          ];
          deviceTopics.forEach(t => {
            topics.push(t);
          });
        }
      }

      topics.forEach(topic => this._subscribeTopic(info, topic));
    }
  }

  _subscribeTopic(info, topic) {
    if (!topic || info.subscriptions.has(topic)) {
      return;
    }
    info.subscriptions.add(topic);
    info.client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) {
        console.error('[XSenseAPI] MQTT subscribe error:', err.message);
      }
    });
  }

  _handleMQTTMessage(topic, payload) {
    const msgString = payload.toString('utf8');
    // FORCE LOG: Log absolutely everything to find where the data is hidden
    console.log(`[XSenseAPI] SPY: Message on ${topic}: ${msgString}`);

    let data;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch (error) {
      console.error('[XSenseAPI] Failed to parse MQTT payload:', error.message);
      return;
    }

    // *** NEW: WiFi-Device Shadow Handler ***
    // Topics: $aws/things/SC07-WX-SN/shadow/name/mainpage/update...
    if (topic.includes('/shadow/name/mainpage') ||
      topic.includes('/shadow/name/pwordup') ||
      topic.includes('/shadow/name/2nd_systime')) {
      this._handleWiFiDeviceShadow(topic, data);
      return;
    }

    // Mute status
    if (topic.includes('/shadow/name/muteup')) {
      console.log('[XSenseAPI] WiFi device mute status update:', JSON.stringify(data));
      this._handleWiFiDeviceShadow(topic, data); // Reuse handler for mute too
      return;
    }

    // ** EVENT TOPICS HANDLER **
    if (topic.startsWith('@xsense/events/') || topic.startsWith('@claybox/events/')) {
      this._handleEventMessage(topic, data);
      return;
    }

    const reported = data?.state?.reported;
    if (!reported) {
      return;
    }

    const stationSn = reported.stationSN || reported.stationSn;
    const station = stationSn ? this.stationsBySn.get(stationSn) : null;

    if (reported.devs && station) {
      for (const [deviceSn, devData] of Object.entries(reported.devs)) {
        const deviceId = this.devicesBySn.get(deviceSn);
        if (!deviceId) {
          continue;
        }
        const normalizedData = this._normalizeDeviceData(devData);
        const existing = this.devices.get(deviceId) || { id: deviceId };
        const merged = {
          ...existing,
          ...normalizedData,
          id: deviceId,
          stationId: station.stationId,
          stationSn: station.stationSn,
          houseId: station.houseId
        };
        this.devices.set(deviceId, merged);
        this._emitUpdate('device', merged);
      }
    }
  }

  _normalizeDeviceData(data) {
    if (!data || typeof data !== 'object') {
      return {};
    }
    const normalized = { ...data };
    if (normalized.status && typeof normalized.status === 'object') {
      Object.assign(normalized, normalized.status);
      delete normalized.status;
    }
    return normalized;
  }



  /**
   * Handle WiFi device shadow updates (mainpage, pwordup)
   */
  _handleWiFiDeviceShadow(topic, data) {
    const reported = data?.state?.reported;
    if (!reported) return;

    // WiFi devices often put SN in stationSN or deviceSN
    const stationSn = reported.stationSN || reported.stationSn;
    const deviceSn = reported.deviceSN || stationSn;

    // console.log(`[XSenseAPI] WiFi device shadow update for ${deviceSn}:`, JSON.stringify(reported).substring(0, 100));

    // Find device by SN (SC07-WX uses stationSn as deviceSn)
    const deviceId = this.devicesBySn.get(deviceSn);
    if (!deviceId) {
      // console.warn(`[XSenseAPI] WiFi device ${deviceSn} not found in cache during update`);
      return;
    }

    const existing = this.devices.get(deviceId) || { id: deviceId };

    // Merge shadow data with existing device
    const merged = {
      ...existing,
      ...reported,
      id: deviceId,
      deviceSn: deviceSn,

      // Map common fields - PRIORITIZE Reported values
      temperature: reported.temperature !== undefined ? reported.temperature : existing.temperature,
      humidity: reported.humidity !== undefined ? reported.humidity : existing.humidity,
      wifiRssi: reported.wifiRSSI || reported.wifiRssi || existing.wifiRssi,
      onLine: reported.onLine !== undefined ? reported.onLine : existing.onLine,
      alarmStatus: reported.alarmStatus !== undefined ? reported.alarmStatus : existing.alarmStatus,
      coPpm: reported.coPpm !== undefined ? reported.coPpm : existing.coPpm,
      batInfo: reported.batInfo !== undefined ? reported.batInfo : existing.batInfo
    };

    this.devices.set(deviceId, merged);
    this._emitUpdate('device', merged);

    console.log(`[XSenseAPI] Updated WiFi device ${deviceSn} via properties`);
  }

  /**
   * Handle @xsense/events/ messages (Real-time Alarms)
   */
  _handleEventMessage(topic, data) {
    // Payload: AlarmTopicResult
    // { "type": "SC07-WX", "deviceSN": "...", "alarmStatus": 1, "coPpm": 0, "temperature": 22.5, "event": "alarm_triggered" ... }

    // Sometimes payload is directly the object, sometimes it might be wrapped. Docs say it's AlarmTopicResult directly.
    if (!data || !data.deviceSN) return;

    const deviceSn = data.deviceSN;
    const deviceId = this.devicesBySn.get(deviceSn);

    if (!deviceId) {
      // console.log(`[XSenseAPI] Received event for unknown device ${deviceSn}:`, JSON.stringify(data));
      return;
    }

    console.log(`[XSenseAPI] 🚨 EVENT RECEIVED for ${deviceSn}: ${data.event || 'update'} (Alarm: ${data.alarmStatus})`);

    const existing = this.devices.get(deviceId) || { id: deviceId };

    // Merge event data - these are high priority updates
    const merged = {
      ...existing,
      ...data, // Merge everything (flat structure from event)
      id: deviceId,

      // Explicit mappings to ensure our standard properties are updated
      // Use DataSanitizer to prevent crashes from bad API types
      alarmStatus: data.alarmStatus !== undefined ? DataSanitizer.toInt(data.alarmStatus) : existing.alarmStatus,
      coPpm: data.coPpm !== undefined ? DataSanitizer.toInt(data.coPpm) : existing.coPpm,
      temperature: data.temperature !== undefined ? DataSanitizer.toFloat(data.temperature) : existing.temperature,
      humidity: data.humidity !== undefined ? DataSanitizer.toFloat(data.humidity) : existing.humidity,

      // Ensure we don't lose battery from shadow if it's missing here
      batInfo: data.batInfo !== undefined ? DataSanitizer.toInt(data.batInfo) : existing.batInfo,

      // Preserve original event triggers if needed
      event: data.event,
      type: data.type
    };

    this.devices.set(deviceId, merged);
    this._emitUpdate('device', merged);
  }

  /**
   * Handle 2nd_tempdatalog MQTT messages
   * This is a NOTIFICATION that new temp/hum data is available
   */
  async _handleTempDataLog(data) {
    const reported = data?.state?.reported;
    if (!reported) return;

    const stationSn = reported.stationSN || reported.stationSn;
    const deviceSnList = reported.deviceSnList || [];

    // console.log(`[XSenseAPI] Temp data log notification for station ${stationSn}, devices:`, deviceSnList);

    // Find station
    const station = stationSn ? this.stationsBySn.get(stationSn) : null;
    if (!station) {
      return;
    }

    // Debounce: Only refresh if last update was > 180 seconds ago
    const now = Date.now();
    const lastUpdate = this._lastTempDataUpdate || 0;
    const debounceMs = 180000; // 3 minutes

    if (now - lastUpdate < debounceMs) {
      // console.log(`[XSenseAPI] Debouncing temp data refresh`);
      return;
    }

    this._lastTempDataUpdate = now;

    // Trigger shadow refresh to get actual temperature/humidity values
    try {
      console.log(`[XSenseAPI] Refreshing station shadow for new temp/hum data...`);
      const shadowData = await this._getStationShadowData(station);

      if (shadowData && shadowData.devs) {
        // Process updated device data
        for (const [deviceSn, devData] of Object.entries(shadowData.devs)) {
          if (deviceSnList.includes(deviceSn)) {
            const deviceId = this.devicesBySn.get(deviceSn);
            if (!deviceId) continue;

            const existing = this.devices.get(deviceId) || { id: deviceId };
            const merged = {
              ...existing,
              ...devData,
              id: deviceId,
              stationId: station.stationId,
              stationSn: station.stationSn,
              houseId: station.houseId
            };

            this.devices.set(deviceId, merged);
            this._emitUpdate('device', merged);
            console.log(`[XSenseAPI] Updated device ${deviceSn} temp/hum via 2nd_tempdatalog`);
          }
        }
      }
    } catch (error) {
      console.error('[XSenseAPI] Failed to refresh shadow after temp data log:', error.message);
    }
  }

  _emitUpdate(type, data) {
    for (const callback of this.updateCallbacks) {
      try {
        callback(type, data);
      } catch (error) {
        console.error('[XSenseAPI] Update callback error:', error.message);
      }
    }
  }

  _resolveHouse(houseId, stationId) {
    if (houseId && this.houses.has(houseId)) {
      return this.houses.get(houseId);
    }
    if (stationId && this.stations.has(stationId)) {
      const station = this.stations.get(stationId);
      if (station && station.houseId) {
        return this.houses.get(station.houseId);
      }
    }
    return null;
  }

  _getStationsByHouse(houseId) {
    const stations = [];
    for (const station of this.stations.values()) {
      if (station.houseId === houseId) {
        stations.push(station);
      }
    }
    return stations;
  }

  _buildStationShadowName(station) {
    let type = station.stationType || station.category || '';
    if (type === 'SBS10') {
      type = '';
    }
    if (type === 'XC04-WX' || type === 'SC07-WX') {
      type = `${type}-`;
    }
    const serial = station.stationSn || station.sn || '';
    return `${type}${serial}`;
  }

  /**
   * Register callback for device updates
   */
  onUpdate(callback) {
    this.updateCallbacks.push(callback);
  }

  /**
   * Disconnect all MQTT clients
   */
  disconnectMQTT() {
    console.log('[XSenseAPI] Disconnecting all MQTT clients...');
    this.mqttClients.forEach(client => {
      if (client && client.end) {
        client.end();
      }
    });
    this.mqttClients.clear();
  }

  /**
   * Cleanup resources
   */
  destroy() {
    console.log('[XSenseAPI] Destroying API client...');
    this.disconnectMQTT();
    this.houses.clear();
    this.stations.clear();
    this.devices.clear();
    this.updateCallbacks = [];
  }
  /**
   * Set configuration for a station (or SC07-WX device) via Shadow
   * @param {string} stationId - The station ID (or device ID for SC07-WX)
   * @param {object} config - Key-value pairs of settings to update
   */
  async setStationConfig(stationId, config) {
    // Find station/device info
    // Note: For SC07-WX, stationId IS the deviceId in our map
    let station = this.stations.get(stationId);

    // If not found in stations, check if it's a device that acts as a station (SC07-WX)
    if (!station) {
      // Try to find device
      const devices = Array.from(this.devices.values());
      const device = devices.find(d => d.id === stationId);
      if (device && (device.deviceType === 'SC07-WX' || device.category === 'SC07-WX')) {
        // Construct a minimal station object for it
        station = {
          userId: device.userId,
          stationSn: device.stationSn || device.deviceSn,
          mqttRegion: device.mqttRegion || this.region // Fallback
        };
      }
    }

    if (!station) {
      throw new Error(`Station not found for ID ${stationId}`);
    }

    const userId = station.userId || this.userId; // Fallback
    const thingName = `SC07-WX-${station.stationSn}`; // Default to SC07 style for now, or need logic
    // Ideally we should store the correctly formatted ThingName in the device/station object
    // But let's try constructing it.
    // SBS50: SBS50{sn}
    // SC07: SC07-WX-{sn}

    let realThingName = thingName;
    if (station.category === 'SBS50' || station.stationType === 'SBS50') {
      realThingName = `SBS50${station.stationSn}`;
    } else if (station.category === 'SC07-WX' || station.deviceType === 'SC07-WX') {
      realThingName = `SC07-WX-${station.stationSn}`;
    }

    // We update the '2nd_info_{sn}' shadow usually for settings? Or '2nd_systime'?
    // Logs showed '2nd_info_{sn}' having 11 keys (probably settings).
    // Let's try updating '2nd_info_{sn}' first.
    const shadowName = `2nd_info_${station.stationSn}`;
    const topic = `$aws/things/${userId}/shadow/name/${shadowName}/update`;

    const payload = {
      state: {
        desired: config
      }
    };

    console.log(`[XSenseAPI] Updating config for ${realThingName} on topic ${topic}:`, JSON.stringify(payload));

    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        return reject(new Error('MQTT Client not connected'));
      }

      this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

module.exports = XSenseAPI;
