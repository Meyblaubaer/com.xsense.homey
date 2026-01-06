'use strict';

const Homey = require('homey');

class TemperatureSensorDevice extends Homey.Device {
  async onInit() {
    this.log('TemperatureSensorDevice has been initialized');

    this.deviceData = this.getData();
    this.settings = this.getSettings();

    const store = this.getStore();
    this.email = store.email;
    this.password = store.password;

    // Previous values for change detection
    this.previousTemp = null;
    this.previousHumidity = null;

    try {
      this.api = await this.homey.app.getAPIClient(this.email, this.password);

      // Register for updates
      this.api.onUpdate((type, data) => {
        if (type === 'device' && data.id === this.deviceData.id) {
          this._handleDeviceUpdate(data);
        }
      });

      // Connect MQTT for real-time updates (important for STH51/STH0A)
      await this.api.connectMQTT(this.deviceData.houseId, this.deviceData.stationId);

      // Initial data fetch
      await this.updateDevice();

      // Poll every 60 seconds (MQTT provides real-time updates too)
      this.pollInterval = setInterval(() => {
        this.updateDevice();
      }, 60000);

    } catch (error) {
      this.error('Error initializing device:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed'));
    }
  }

  async updateDevice() {
    try {
      const devices = await this.api.getDevices(this.deviceData.stationId);
      const deviceData = devices.find(d => d.id === this.deviceData.id);

      if (deviceData) {
        await this._handleDeviceUpdate(deviceData);
        this.setAvailable();
      } else {
        this.setUnavailable(this.homey.__('error.device_not_found'));
      }
    } catch (error) {
      this.error('Error updating device:', error);
      this.setUnavailable(this.homey.__('error.update_failed'));
    }
  }

  async _handleDeviceUpdate(deviceData) {
    this.log(`_handleDeviceUpdate: ${JSON.stringify(deviceData)}`);
    try {
      // Update temperature
      if (this.hasCapability('measure_temperature')) {
        const temp = deviceData.temperature || deviceData.temp;
        if (temp !== undefined && temp !== null) {
          await this.setCapabilityValue('measure_temperature', temp);


        }
      }

      // Update humidity
      if (this.hasCapability('measure_humidity')) {
        const humidity = deviceData.humidity || deviceData.humi;
        if (humidity !== undefined && humidity !== null) {
          await this.setCapabilityValue('measure_humidity', humidity);

          // Trigger flow if humidity changed significantly (more than 5%)
          // Custom flow card removed as it duplicates standard capability behavior
          /*
          if (this.previousHumidity !== null && Math.abs(humidity - this.previousHumidity) > 5) {
             // Logic removed
          }
          */
          this.previousHumidity = humidity;
        }
      }

      // Update battery level
      if (this.hasCapability('measure_battery') && deviceData.batInfo !== undefined) {
        const batteryLevel = Math.round((deviceData.batInfo * 100) / 3);
        await this.setCapabilityValue('measure_battery', batteryLevel);

        // Update battery alarm
        if (this.hasCapability('alarm_battery')) {
          const lowBattery = batteryLevel < 20;
          const prevBattery = this.getCapabilityValue('alarm_battery');
          await this.setCapabilityValue('alarm_battery', lowBattery);

          if (lowBattery && !prevBattery) {
            // Custom flow card removed
          }
        }
      }

      // Update WiFi SSID if changed
      if (deviceData.wifiSsid && deviceData.wifiSsid !== this.settings.wifi_ssid) {
        await this.setSettings({
          wifi_ssid: deviceData.wifiSsid
        });
      }

      await this.setAvailable();

    } catch (error) {
      this.error('Error handling device update:', error);
    }
  }

  async onAdded() {
    this.log('TemperatureSensorDevice has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('TemperatureSensorDevice settings were changed');
  }

  async onRenamed(name) {
    this.log('TemperatureSensorDevice was renamed');
  }

  async onDeleted() {
    this.log('TemperatureSensorDevice has been deleted');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}

module.exports = TemperatureSensorDevice;
