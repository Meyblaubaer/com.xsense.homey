'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class WaterSensorDevice extends XSenseDeviceBase {
  async onInit() {
    await super.onInit();

    this.log('WaterSensorDevice has been initialized');
  }

  /**
   * Handle device data update (Water-Sensor specific implementation)
   * Overrides base class method to add water leak detection specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    try {
      // Update water leak alarm
      if (this.hasCapability('alarm_water')) {
        let waterDetected = false;

        if (deviceData.isOpen === "1" || deviceData.isOpen === 1) {
          waterDetected = true;
        } else if (deviceData.waterDetected === true || deviceData.waterDetected === 1) {
          waterDetected = true;
        } else if (deviceData.alarmStatus === true || deviceData.alarmStatus === 1) {
          waterDetected = true;
        }

        await this.setCapabilityValue('alarm_water', waterDetected);
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
        }
      }
    } catch (error) {
      this.error('Error handling water-specific device update:', error);
    }
  }
}

module.exports = WaterSensorDevice;
