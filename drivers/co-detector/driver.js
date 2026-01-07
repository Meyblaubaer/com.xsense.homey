'use strict';

const Homey = require('homey');

class CoDetectorDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('CoDetectorDriver has been initialized');
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
        // Only add CO detectors
        const deviceType = (device.deviceType || device.type || '').toUpperCase();
        this.log(`Processing device: ${device.deviceName}, type: ${deviceType}, id: ${device.id}`);

        // FILTER: Only include CO Detectors (XC)
        if (!deviceType.includes('XC') && !deviceType.includes('CO')) {
          // Ensure we don't pick up others accidentally
          if (!deviceType.startsWith('XC')) {
            this.log(`Skipping device ${device.deviceName} (Type: ${deviceType}) - Not a dedicated CO detector`);
            continue;
          }
        }

        // FIXED: Naming convention [Station Name] [Device Name]
        let name = device.deviceName || device.name || `XSense ${deviceType}`;
        // Note: Station prefix logic removed as per user preference in other drivers

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
    const capabilities = ['alarm_co'];

    // Battery capabilities
    if (device.batInfo !== undefined || device.batteryLevel !== undefined) {
      capabilities.push('measure_battery');

      // Add battery alarm if battery percentage can be determined
      if (device.batInfo !== undefined) {
        capabilities.push('alarm_battery');
      }
    }

    // Measure CO
    capabilities.push('measure_co');

    return capabilities;
  }

  /**
   * Handle pairing - with login_credentials template
   */
  async onPair(session) {
    this.log('Pairing session started');

    // Store credentials in session object
    let credentials = null;

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

        // Process devices
        for (const device of data.devices) {
          const deviceType = (device.deviceType || device.type || '').toUpperCase();

          // FILTER: Only include CO Detectors (XC)
          if (!deviceType.includes('XC') && !deviceType.includes('CO')) {
            if (!deviceType.startsWith('XC')) {
              this.log(`Skipping device ${device.deviceName} (Type: ${deviceType}) - Not a dedicated CO detector`);
              continue;
            }
          }

          // FIXED: Naming convention
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

module.exports = CoDetectorDriver;
