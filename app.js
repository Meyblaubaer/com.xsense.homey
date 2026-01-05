'use strict';

const Homey = require('homey');
const XSenseAPI = require('./lib/XSenseAPI');

class XSenseApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('XSense App has been initialized');

    // Initialize API client storage
    this.apiClients = new Map();

    // Register flow card actions
    this._registerFlowCards();

    // Start polling for updates every 30 seconds
    this.pollInterval = setInterval(() => {
      this._pollDeviceUpdates();
    }, 30000);
  }

  /**
   * Register flow cards
   */
  _registerFlowCards() {
    // Triggers
    this.homey.flow.getDeviceTriggerCard('co_detected');
    this.homey.flow.getDeviceTriggerCard('device_muted');

    // Conditions
    // Custom flow condition removed


    // Actions
    const testAlarmCard = this.homey.flow.getActionCard('test_alarm');
    testAlarmCard.registerRunListener(async (args, state) => {
      return await args.device.testAlarm();
    });
  }

  /**
   * Get or create API client for credentials
   */
  async getAPIClient(email, password) {
    const key = `${email}:${password}`;
    const existing = this.apiClients.get(key);

    if (existing) {
      if (existing instanceof XSenseAPI) {
        return existing;
      }
      return await existing;
    }

    const client = new XSenseAPI(email, password);
    const initPromise = (async () => {
      try {
        await client.init();
        this.apiClients.set(key, client);
        return client;
      } catch (error) {
        this.apiClients.delete(key);
        throw error;
      }
    })();

    this.apiClients.set(key, initPromise);
    return await initPromise;
  }

  /**
   * Poll all devices for updates
   */
  async _pollDeviceUpdates() {
    for (const [key, client] of this.apiClients) {
      try {
        await client.getAllDevices();
      } catch (error) {
        this.error('Error polling device updates:', error);
      }
    }
  }

  /**
   * onUninit is called when the app is destroyed.
   */
  async onUninit() {
    this.log('XSense App is being destroyed');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Cleanup all API clients
    for (const [key, client] of this.apiClients) {
      client.destroy();
    }
    this.apiClients.clear();
  }
}

module.exports = XSenseApp;
