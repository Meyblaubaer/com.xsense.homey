// HACK: Fix for AWS SDK 'uv_os_homedir returned ENOENT' on Homey
if (!process.env.HOME) {
  process.env.HOME = '/tmp';
}

'use strict';

const mqtt = require('mqtt');
const crypto = require('crypto');
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
    } else {
      console.warn('[XSenseAPI] No AWS credentials in response, Thing Shadow API may not work');
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
      const errorCode = data.reCode || data.code;
      if (errorCode !== undefined && errorCode !== 200 && errorCode !== 0) {
        const errorMsg = data.reMsg || data.msg || data.message || 'Unknown error';
        throw new Error(`API Error ${errorCode}: ${errorMsg}`);
      }

      return data;
    } catch (error) {
      console.error(`[XSenseAPI] API call failed (${bizCode}):`, error.message);
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
    console.log('[XSenseAPI] Fetching all devices (Optimized)...');

    const houses = await this.getHouses();
    this.devicesBySn.clear();
    this.stationsBySn.clear();
    const allDevices = [];
    const allStations = [];

    for (const house of houses) {
      this.houses.set(house.houseId, house);

      // Get house shadow for additional info (using mqttRegion from house)
      const houseShadow = await this._getHouseShadowData(house);

      const stations = await this.getStations(house.houseId);

      // Process stations in parallel to speed up shadow fetching
      const stationPromises = stations.map(async (station) => {
        if (station.userId && !house.userId) {
          house.userId = station.userId;
          // Update the house in the map with the new userId (side effect, but acceptable here)
          this.houses.set(house.houseId, house);
        }

        station.mqttRegion = house.mqttRegion;
        try {
          // VITAL: Fetch station shadow to get status (2nd_systime / 2nd_device_info)
          const stationShadow = await this._getStationShadowData(station);
          if (stationShadow) {
            Object.assign(station, stationShadow);
          }
        } catch (err) {
          console.error(`[XSenseAPI] Failed to fetch shadow for station ${station.stationId}:`, err);
        }

        const stationData = {
          ...station,
          houseId: house.houseId,
          houseName: house.houseName,
          mqttRegion: house.mqttRegion,
          stationType: station.stationType || station.category,
          sn: station.sn || station.stationSn,
          stationSn: station.stationSn || station.sn,
          userId: station.userId,
          shadowName: this._buildStationShadowName(station)
        };

        return stationData;
      });

      const processedStations = await Promise.all(stationPromises);

      for (const stationData of processedStations) {
        this.stations.set(stationData.stationId, stationData);
        if (stationData.stationSn) {
          this.stationsBySn.set(stationData.stationSn, stationData);
        }
        allStations.push(stationData);

        // Devices are already included in the station data from the API
        const devices = stationData.devices || [];
        for (const device of devices) {
          const deviceData = {
            ...device,
            id: device.deviceId || device.deviceSn,
            stationId: stationData.stationId,
            houseId: house.houseId,
            houseName: house.houseName,
            stationName: stationData.stationName,
            mqttRegion: house.mqttRegion,
            devUserId: stationData.userId,
            deviceSn: device.deviceSn || device.deviceSN || device.sn
          };
          this.devices.set(deviceData.id, deviceData);
          if (deviceData.deviceSn) {
            this.devicesBySn.set(deviceData.deviceSn, deviceData.id);
          }
          allDevices.push(deviceData);
        }
      }
    }

    console.log(`[XSenseAPI] Found ${allDevices.length} devices in ${allStations.length} stations`);

    return {
      devices: allDevices,
      stations: allStations,
      houses: Array.from(this.houses.values())
    };
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
    const defaultCandidates = this._getStationThingNames(station);

    // Attempt 1: Prioritize discovered named shadows.
    // Ensure we don't waste time on 'baseInfo' or 'null' if we are looking for specific XSense shadows
    let shadow = await this._getThingShadowFromCandidates(defaultCandidates, [
      '2nd_mainpage',    // FOUND IN HA SCRIPTS: main aggregator for devices
      'mainpage',        // Fallback found in HA scripts
      '2nd_systime',     // Station status
      // '2nd_device_info', // Removed: confirmed 404
      // '2nd_dev_list'     // Removed: confirmed 404
    ], station.mqttRegion);

    if (Object.keys(shadow).length > 0) {
      // Parse 'devs' map if present (2nd_mainpage standard)
      if (shadow.devs) {
        console.log(`[XSenseAPI] Found 'devs' map in shadow! Parsing ${Object.keys(shadow.devs).length} devices.`);
        for (const [sn, data] of Object.entries(shadow.devs)) {
          // Find device by SN using cache
          let deviceId = this.devicesBySn.get(sn);
          let device = deviceId ? this.devices.get(deviceId) : null;

          // Fallback linear search if strictly necessary, but cache should be good
          if (!device) {
            device = Array.from(this.devices.values()).find(d => d.deviceSn === sn);
          }

          if (device) {
            Object.assign(device, data);
            // Ensure status is mapped if present
            if (data.status) device.deviceStatus = data.status;
            if (data.battStatus) device.batteryStatus = data.battStatus;
            // Map alarmStatus if present
            if (data.alarmStatus) device.alarmStatus = data.alarmStatus;
            // console.log(`[XSenseAPI] Updated device ${sn} from shadow data`);
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

  _getStationThingNames(station) {
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
  async muteAlarm(deviceId) {
    // This would need the proper API bizCode - to be determined
    console.log(`[XSenseAPI] Mute alarm for device ${deviceId}`);
    // Implementation pending - need to find correct bizCode
    return true;
  }

  /**
   * Connect to MQTT for real-time updates
   */
  async connectMQTT(houseId, stationId) {
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
      const typeSnThing = this._buildStationShadowName(station);
      if (typeSnThing) {
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_systime/update`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_systime/update/accepted`);
        topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_systime/update/delta`);

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
    // console.log(`[XSenseAPI] SPY: Message on ${topic}: ${msgString}`);

    let data;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch (error) {
      console.error('[XSenseAPI] Failed to parse MQTT payload:', error.message);
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
}

module.exports = XSenseAPI;
