'use strict';

const Homey = require('homey');

class WaterSensorDevice extends Homey.Device {
  async onInit() {
    this.log('WaterSensorDevice has been initialized');

    this.deviceData = this.getData();
    this.settings = this.getSettings();

    const store = this.getStore();
    this.email = store.email;
    this.password = store.password;

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

      // Initial data fetch
      await this.updateDevice();

      // Poll every 60 seconds
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
    try {
      const prevWater = this.getCapabilityValue('alarm_water');

      // Update water leak alarm
      // Water is detected if: isOpen == "1" or waterDetected == true or alarmStatus == true
      let waterDetected = false;

      if (deviceData.isOpen === "1" || deviceData.isOpen === 1) {
        waterDetected = true;
      } else if (deviceData.waterDetected === true || deviceData.waterDetected === 1) {
        waterDetected = true;
      } else if (deviceData.alarmStatus === true || deviceData.alarmStatus === 1) {
        waterDetected = true;
      }

      if (this.hasCapability('alarm_water')) {
        await this.setCapabilityValue('alarm_water', waterDetected);

        // Trigger flow if water was just detected
        // Custom flow card removed
        /*
        if (waterDetected && !prevWater) {
           // Logic removed
        }
        */
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

      await this.setAvailable();

    } catch (error) {
      this.error('Error handling device update:', error);
    }
  }

  async onAdded() {
    this.log('WaterSensorDevice has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('WaterSensorDevice settings were changed');
  }

  async onRenamed(name) {
    this.log('WaterSensorDevice was renamed');
  }

  async onDeleted() {
    this.log('WaterSensorDevice has been deleted');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}

module.exports = WaterSensorDevice;
