'use strict';

const Homey = require('homey');

class DoorSensorDevice extends Homey.Device {
  async onInit() {
    this.log('DoorSensorDevice has been initialized');

    // Get device data
    this.deviceData = this.getData();
    this.settings = this.getSettings();

    // Get credentials from store
    const store = this.getStore();
    this.email = store.email;
    this.password = store.password;

    // Older paired devices had station/house IDs only in the store
    if (!this.deviceData.stationId && store.stationId) {
      this.deviceData.stationId = store.stationId;
    }
    if (!this.deviceData.houseId && store.houseId) {
      this.deviceData.houseId = store.houseId;
    }

    // Get API client
    try {
      this.api = await this.homey.app.getAPIClient(this.email, this.password);

      // Register for updates
      this.api.onUpdate((type, data) => {
        if (type === 'device' && data.id === this.deviceData.id) {
          this._handleDeviceUpdate(data);
        }
      });

      // Connect MQTT for real-time updates
      await this.api.connectMQTT(this.deviceData.houseId, this.deviceData.stationId);

      // Startup synchronization
      this.log('Performing startup synchronization...');
      try {
        const syncedData = await this.api.syncDevice(this.deviceData.id);
        if (syncedData) {
          await this._handleDeviceUpdate(syncedData);
        } else {
          await this.updateDevice();
        }
      } catch (e) {
        this.error('Sync failed, falling back to updateDevice', e);
        await this.updateDevice();
      }

      // Setup polling
      this.pollInterval = setInterval(() => {
        this.updateDevice();
      }, 60000);

    } catch (error) {
      this.error('Error initializing device:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed'));
    }

    // Initialize capabilities
    if (this.hasCapability('alarm_contact') && this.getCapabilityValue('alarm_contact') === null) {
      this.setCapabilityValue('alarm_contact', false).catch(this.error);
    }
  }

  async updateDevice() {
    try {
      const devices = await this.api.getDevices(this.deviceData.stationId);

      const deviceData = devices.find(d =>
        d.id === this.deviceData.id ||
        d.deviceSn === this.deviceData.deviceSn
      );

      if (deviceData) {
        await this._handleDeviceUpdate(deviceData);
        if (!this.getAvailable()) {
          this.setAvailable();
        }
      }
    } catch (error) {
      this.error('Error updating device:', error);
    }
  }

  async _handleDeviceUpdate(deviceData) {
    this.log(`_handleDeviceUpdate: ${JSON.stringify(deviceData)}`);
    try {
      // Update contact alarm (door/window open/closed)
      if (this.hasCapability('alarm_contact')) {
        // SDS0A uses 'isOpen' in status, SES01 uses 'isOpen' directly
        const isOpen = deviceData.isOpen || 
                       (deviceData.status && deviceData.status.isOpen);
        const contactOpen = isOpen === true || isOpen === 1 || isOpen === '1' || isOpen === 'true';
        await this.setCapabilityValue('alarm_contact', contactOpen);
      }

      // Update battery level
      if (this.hasCapability('measure_battery') && deviceData.batInfo !== undefined) {
        let batteryLevel = 100;
        const bat = parseInt(deviceData.batInfo, 10);

        if (!isNaN(bat)) {
          batteryLevel = Math.round((bat / 3) * 100);
          if (batteryLevel > 100) batteryLevel = 100;
        }

        await this.setCapabilityValue('measure_battery', batteryLevel);

        if (this.hasCapability('alarm_battery')) {
          const lowBattery = batteryLevel < 20;
          await this.setCapabilityValue('alarm_battery', lowBattery);
        }
      }

      // Update signal strength
      if (this.hasCapability('measure_signal_strength')) {
        let signalVal = deviceData.signal || deviceData.rssi || deviceData.rfLevel || deviceData.signalLevel;

        if (signalVal !== undefined && signalVal !== null) {
          let signalStrengthDbm = -100;

          if (typeof signalVal === 'number' && signalVal < 0) {
            signalStrengthDbm = signalVal;
          } else {
            const s = parseInt(signalVal, 10);
            if (!isNaN(s)) {
              if (s >= 4) signalStrengthDbm = -55;
              else if (s === 3) signalStrengthDbm = -67;
              else if (s === 2) signalStrengthDbm = -79;
              else if (s === 1) signalStrengthDbm = -91;
              else if (s === 0) signalStrengthDbm = -100;
            }
          }
          await this.setCapabilityValue('measure_signal_strength', signalStrengthDbm).catch(e => { });
        }
      }

      await this.setAvailable();

    } catch (error) {
      this.error('Error handling device update:', error);
    }
  }

  async onAdded() {
    this.log('DoorSensorDevice has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('DoorSensorDevice settings were changed', changedKeys);
  }

  async onRenamed(name) {
    this.log('DoorSensorDevice was renamed');
  }

  async onDeleted() {
    this.log('DoorSensorDevice has been deleted');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}

module.exports = DoorSensorDevice;
