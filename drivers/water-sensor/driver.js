'use strict';

const Homey = require('homey');

class WaterSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('WaterSensorDriver has been initialized');
  }

  async onPairListDevices(session) {
    const devices = [];

    try {
      if (!session) {
        session = this.homey.app.currentPairSession;
      }

      if (!session || !session.credentials) {
        throw new Error('No credentials provided');
      }

      const { username, password } = session.credentials;
      const api = await this.homey.app.getAPIClient(username, password);
      const data = await api.getAllDevices();

      // Filter for water leak sensors (SWS51, SWS0A)
      for (const device of data.devices) {
        const deviceType = (device.type || device.deviceType || '').toUpperCase();

        if (deviceType.includes('SWS') || deviceType.includes('WATER') || deviceType.includes('LEAK')) {
          // FIXED: Use the name from API directly (which includes our "Type SN" fix from XSenseAPI)
          let name = device.name || `XSense ${deviceType}`;

          devices.push({
            name: name,
            data: {
              id: device.id,
              stationId: device.stationId,
              houseId: device.houseId
            },
            store: {
              email: username,
              password: password
            },
            settings: {
              device_id: device.id,
              device_type: deviceType
            }
          });
        }
      }

      return devices;
    } catch (error) {
      this.error('Error listing devices:', error);
      throw new Error(this.homey.__('pair.error.list_failed'));
    }
  }

  async onPair(session) {
    this.log('Pairing session started');
    // Keep this as fallback for now, but rely on passed session
    this.homey.app.currentPairSession = session;

    // Check for stored credentials
    const stored = this.homey.app.getStoredCredentials();
    if (stored.email && stored.password) {
      this.log('Found stored credentials, attempting auto-login');
      try {
        await this.homey.app.getAPIClient(stored.email, stored.password);
        session.credentials = { username: stored.email, password: stored.password };
        await session.showView('list_devices');
      } catch (error) {
        this.log('Auto-login failed with stored credentials');
      }
    }

    session.setHandler('login', async (data) => {
      try {
        const { username, password } = data;
        const api = await this.homey.app.getAPIClient(username, password);
        session.credentials = { username, password };

        // Save for future
        this.homey.app.setStoredCredentials(username, password);

        return true;
      } catch (error) {
        this.error('Login failed:', error);
        throw new Error(this.homey.__('pair.error.login_failed'));
      }
    });

    session.setHandler('list_devices', async () => {
      return await this.onPairListDevices(session);
    });
  }
}

module.exports = WaterSensorDriver;
