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
    return initPromise;
  }

  /**
   * Poll all devices for updates
   */
  async _pollDeviceUpdates() {
    // keys are "email:password"
    for (const key of this.apiClients.keys()) {
      try {
        // Splitting key is not safe if password contains colon, but we can reconstruct params or change storage.
        // Better: iterate keys and assume getAPIClient returns the ready instance/promise
        // Actually, let's just use the map values, but we need to await them.

        const clientOrPromise = this.apiClients.get(key);
        const client = await clientOrPromise;

        if (client && typeof client.getAllDevices === 'function') {
          await client.getAllDevices();
        }
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
  /**
   * Store credentials in settings
   */
  setStoredCredentials(email, password) {
    this.log(`Saving credentials for ${email}`);
    this.homey.settings.set('xsense_email', email);
    this.homey.settings.set('xsense_password', password);
  }

  /**
   * Get stored credentials
   */
  getStoredCredentials() {
    const email = this.homey.settings.get('xsense_email');
    const hasPassword = !!this.homey.settings.get('xsense_password');
    this.log(`Retrieving credentials: ${email}, hasPassword: ${hasPassword}`);
    return {
      email: email,
      password: this.homey.settings.get('xsense_password')
    };
  }
}

module.exports = XSenseApp;
