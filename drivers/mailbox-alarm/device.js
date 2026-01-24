'use strict';

const Homey = require('homey');
const XSenseDeviceBase = require('../../lib/XSenseDeviceBase');

class MailboxAlarmDevice extends XSenseDeviceBase {
  async onInit() {
    await super.onInit();

    this.log('MailboxAlarmDevice has been initialized');
  }

  /**
   * Handle device data update (Mailbox-Alarm specific implementation)
   * Overrides base class method to add mailbox alarm specific logic
   */
  async _handleDeviceUpdate(deviceData) {
    // Call base implementation first
    await super._handleDeviceUpdate(deviceData);

    // Mailbox alarm uses smoke detector capabilities (smoke_status, etc.)
    // No mailbox-specific overrides needed beyond base implementation
  }

  /**
   * Test alarm
   */
  async testAlarm() {
    try {
      await this.api.testAlarm(this.deviceData.id);
      return true;
    } catch (error) {
      this.error('Error testing alarm:', error);
      throw new Error(this.homey.__('error.test_alarm_failed'));
    }
  }
}

module.exports = MailboxAlarmDevice;
