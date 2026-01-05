'use strict';

const Homey = require('homey');

class TemperatureSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('TemperatureSensorDriver has been initialized');
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

      // Filter for temperature/humidity sensors (STH51, STH0A, STH54)
      for (const device of data.devices) {
        const deviceType = (device.type || device.deviceType || '').toUpperCase();

        if (deviceType.includes('STH') || deviceType.includes('TEMP') || deviceType.includes('HYGROMETER')) {
          // FIXED: Naming convention [Station Name] [Device Name]
          let name = device.name || `XSense ${deviceType}`;
          if (device.stationName && !name.startsWith(device.stationName)) {
            name = `${device.stationName} ${name}`;
          }

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
              device_type: deviceType,
              wifi_ssid: device.wifiSsid || 'N/A'
            },
            icon: '/drivers/temperature-sensor/assets/images/small.png'
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

    session.setHandler('login', async (data) => {
      try {
        const { username, password } = data;
        const api = await this.homey.app.getAPIClient(username, password);
        session.credentials = { username, password };
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

module.exports = TemperatureSensorDriver;
