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

    // MQTT Health Tracking (NEW)
    this.mqttHealthy = new Map(); // houseId → boolean

    // Register flow card actions
    this._registerFlowCards();

    // Coordinated polling: Only when MQTT is unhealthy
    // Increased to 60s to reduce API load
    this.pollInterval = setInterval(() => {
      this._pollDeviceUpdatesIfNeeded();
    }, 60000); // Changed from 30000 to 60000
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

    // Global Fire Drill Action
    this.homey.flow.getActionCard('trigger_fire_drill')
      .registerRunListener(async (args, state) => {
        this.log('🚨 Starting Global Fire Drill! Triggering all smoke detectors...');
        const driver = this.homey.drivers.getDriver('smoke-detector');
        const devices = driver.getDevices();

        // Trigger test on all devices to verify system integrity
        // In real interconnect, one might suffice, but triggering all ensures coverage.
        const promises = devices.map(device => {
          return device.testAlarm()
            .then(() => this.log(`Fire drill triggered on ${device.getName()}`))
            .catch(err => this.error(`Failed to trigger fire drill on ${device.getName()}:`, err));
        });

        await Promise.all(promises);
        return true;
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

    const client = new XSenseAPI(email, password, this.homey);

    // Register global error handler for this client
    client.onUpdate((type, data) => {
      if (type === 'error' && data) {
        // Handle different error types with appropriate user notifications
        if (data.type === 'AUTH_FAILED' || data.type === 'SESSION_EXPIRED') {
          this.log('Received critical auth/session error, sending notification...');
          this.homey.notifications.createNotification({
            excerpt: `X-Sense: ${data.message}`
          }).catch(err => this.error('Failed to send notification:', err));
        } else if (data.type === 'SERVER_ERROR') {
          // Only notify on persistent server errors (already filtered in XSenseAPI)
          this.log(`X-Sense server error (${data.errorCode}), backoff: ${data.backoffMinutes}min`);
          this.homey.notifications.createNotification({
            excerpt: `X-Sense: ${data.message}`
          }).catch(err => this.error('Failed to send notification:', err));
        }
      }
    });

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
   * Poll device updates only if MQTT is unhealthy
   * Reduces API calls when real-time updates work
   */
  async _pollDeviceUpdatesIfNeeded() {
    for (const [key, clientOrPromise] of this.apiClients.entries()) {
      try {
        const client = await clientOrPromise;
        if (!client || typeof client.getAllDevices !== 'function') {
          continue;
        }

        // Check if MQTT is healthy for all houses of this client
        const houses = Array.from(client.houses.values());
        const needsPolling = houses.some(house => {
          const isHealthy = this.mqttHealthy.get(house.houseId);
          return isHealthy !== true; // Poll if unhealthy or unknown
        });

        if (needsPolling) {
          this.log(`Polling updates for client (MQTT unhealthy or unknown)`);
          await client.getAllDevices();
        } else {
          // Log less frequently (only every 10 minutes)
          if (!this._lastSkipLog || (Date.now() - this._lastSkipLog) > 600000) {
            this.log('Skipping poll - MQTT is healthy for all houses');
            this._lastSkipLog = Date.now();
          }
        }

      } catch (error) {
        this.error('Error polling device updates:', error);
      }
    }
  }

  /**
   * Set MQTT health status for a house
   * Called by XSenseAPI when MQTT connects/disconnects
   */
  setMQTTHealth(houseId, isHealthy) {
    this.mqttHealthy.set(houseId, isHealthy);
    this.log(`MQTT health for house ${houseId}: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
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
