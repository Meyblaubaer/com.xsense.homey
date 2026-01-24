'use strict';

const Homey = require('homey');

class HeatDetectorDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('HeatDetectorDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' template is used.
   */
  async onPairListDevices() {
    this.log('=== onPairListDevices called ===');
    const devices = [];

    try {
      // Get credentials from driver instance (set in onPair login handler)
      if (!this.pairingCredentials) {
        this.error('No pairing credentials available');
        throw new Error('No credentials provided');
      }

      const { username, password } = this.pairingCredentials;
      this.log(`Getting devices for user: ${username}`);

      // Get API client
      const api = await this.homey.app.getAPIClient(username, password);

      // Get all devices
      const data = await api.getAllDevices();
      this.log(`API returned data:`, JSON.stringify(data, null, 2));

      // Process devices
      for (const device of data.devices) {
        // Filter for Heat Detectors (XH02-M etc)
        const deviceType = (device.deviceType || device.type || '').toUpperCase();

        // Simple filter: include if type has "HEAT" or if it is a specific known model like XH02
        if (deviceType.includes('HEAT') || deviceType.includes('XH')) {

          this.log(`Processing device: ${device.deviceName}, type: ${deviceType}, id: ${device.id}`);

          // FIXED: Naming convention [Station Name] [Device Name]
          let name = device.deviceName || device.name || `XSense ${deviceType}`;
          if (device.stationName && !name.startsWith(device.stationName)) {
            name = `${device.stationName} ${name}`;
          }

          const deviceEntry = {
            name: name,
            data: {
              id: device.id,
              stationId: device.stationId,
              houseId: device.houseId
            },
            store: {
              email: username,
              password: password,
              stationId: device.stationId,
              houseId: device.houseId,
              deviceType: deviceType
            }
          };

          this.log(`Device entry created:`, JSON.stringify(deviceEntry, null, 2));
          devices.push(deviceEntry);
        }
      }

      this.log(`=== Returning ${devices.length} devices ===`);
      this.log('Devices array:', JSON.stringify(devices, null, 2));
      return devices;
    } catch (error) {
      this.error('Error listing devices:', error);
      this.error('Stack:', error.stack);
      throw error;
    }
  }

  /**
   * Determine device capabilities based on device type and available data
   */
  _getCapabilities(device) {
    const capabilities = ['alarm_heat'];

    // Battery capabilities
    if (device.batInfo !== undefined || device.batteryLevel !== undefined) {
      capabilities.push('measure_battery');

      // Add battery alarm if battery percentage can be determined
      if (device.batInfo !== undefined) {
        capabilities.push('alarm_battery');
      }
    }

    // Temperature
    if (device.temperature !== undefined || device.temp !== undefined) {
      capabilities.push('measure_temperature');
    }

    return capabilities;
  }

  /**
   * Handle pairing - with login_credentials template
   */
  async onPair(session) {
    this.log('Pairing session started');

    // Store credentials in session object
    let credentials = null;

    // Check for stored credentials (FIXED: Async for encryption)
    const stored = await this.homey.app.getStoredCredentials();
    if (stored.email && stored.password) {
      this.log('Found stored credentials, attempting auto-login');
      try {
        await this.homey.app.getAPIClient(stored.email, stored.password);
        credentials = {
          username: stored.email,
          password: stored.password
        };
        await session.showView('list_devices');
      } catch (error) {
        this.log('Auto-login failed with stored credentials');
      }
    }

    // For login_credentials template, we need to handle the 'login' event
    session.setHandler('login', async (data) => {
      try {
        const { username, password } = data;
        this.log(`Login attempt for user: ${username}`);

        // Try to authenticate
        const api = await this.homey.app.getAPIClient(username, password);

        // Store credentials in closure variable
        credentials = {
          username: username,
          password: password
        };

        // Save for future
        this.homey.app.setStoredCredentials(username, password);

        this.log('Login successful, credentials stored');
        return true;
      } catch (error) {
        this.error('Login failed:', error);
        // THROW RAW ERROR TO DEBUG "INSTALL" VS "RUN"
        throw new Error(`Login failed: ${error.message || error}`);
      }
    });

    // Manually handle list_devices since we're using login_credentials template
    session.setHandler('list_devices', async () => {
      this.log('list_devices handler called');

      if (!credentials) {
        this.error('No credentials available in list_devices handler');
        throw new Error('Please login first');
      }

      const devices = [];
      try {
        const { username, password } = credentials;
        this.log(`Getting devices for user: ${username}`);

        // Get API client
        const api = await this.homey.app.getAPIClient(username, password);

        // Get all devices
        const data = await api.getAllDevices();
        this.log(`API returned ${data.devices ? data.devices.length : 0} devices`);

        // Log all devices for debugging
        this.log('All devices from API:', data.devices.map(d => ({
          name: d.deviceName || d.name,
          type: d.type,
          deviceType: d.deviceType,
          id: d.id
        })));

        // Process devices
        for (const device of data.devices) {
          const deviceType = (device.deviceType || device.type || '').toUpperCase();

          // FILTER: Only include Heat Detectors (XH)
          // Supported types: XH02-M, XH02-WX, XH0A-MR, and any containing 'HEAT'
          if (!deviceType.includes('XH') && !deviceType.includes('HEAT')) {
            this.log(`Skipping device ${device.deviceName} (Type: ${deviceType}) - Not a heat detector`);
            continue;
          }

          // FIXED: Use the name from API directly (which includes our "Type SN" fix from XSenseAPI)
          let name = device.deviceName || device.name || `XSense ${deviceType}`;

          const deviceEntry = {
            name: name,
            data: {
              id: device.id,
              stationId: device.stationId,
              houseId: device.houseId
            },
            store: {
              email: username,
              password: password,
              stationId: device.stationId,
              houseId: device.houseId,
              deviceType: deviceType
            }
          };

          this.log(`Adding device: ${deviceEntry.name}`);
          devices.push(deviceEntry);
        }

        this.log(`Returning ${devices.length} devices`);
        return devices;
      } catch (error) {
        this.error('Error listing devices:', error);
        throw error;
      }
    });
  }
}

module.exports = HeatDetectorDriver;
