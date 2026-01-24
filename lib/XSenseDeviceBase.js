'use strict';

const Homey = require('homey');

/**
 * Base class for all X-Sense devices with common functionality
 * - Device initialization
 * - API client setup
 * - Callback management (memory leak prevention)
 * - Debouncing for capability updates
 * - Common device update logic
 */
class XSenseDeviceBase extends Homey.Device {

  async onInit() {
    await super.onInit();

    // Debounce timers for capability updates
    this.updateDebounceTimers = new Map();
    this.pendingUpdates = new Map();
    this.updateCallback = null; // Callback reference for cleanup

    // Default debounce delays (ms)
    this.debounceDelays = {
      'measure_temperature': 1000,    // 1 second for temperature
      'measure_humidity': 1000,       // 1 second for humidity
      'measure_battery': 2000,        // 2 seconds for battery
      'measure_rssi': 2000,           // 2 seconds for WiFi signal
      'measure_last_seen': 500,       // 0.5 seconds for last seen
      'default': 500                  // 0.5 seconds for everything else
    };

    // Initialize common device properties
    this._initializeCommon();
  }

  /**
   * Initialize common device properties
   */
  _initializeCommon() {
    // Get device data
    this.deviceData = this.getData();
    this.settings = this.getSettings();

    // Get credentials from store (async for encryption support)
    const store = this.getStore();
    this.email = store.email;
    this.password = store.password;

    // Older paired devices had station/house IDs only in store, so copy them over
    if (!this.deviceData.stationId && store.stationId) {
      this.deviceData.stationId = store.stationId;
    }
    if (!this.deviceData.houseId && store.houseId) {
      this.deviceData.houseId = store.houseId;
    }
  }

  /**
   * Setup API client
   */
  async _setupAPIClient() {
    try {
      this.api = await this.homey.app.getAPIClient(this.email, this.password);
    } catch (error) {
      this.error('Error setting up API client:', error);
      throw error;
    }
  }

  /**
   * Register update callback (FIXED: Prevents memory leaks)
   */
  _registerUpdateCallback() {
    if (!this.api) {
      this.error('API client not initialized');
      return;
    }

    this.updateCallback = (type, data) => {
      if (type === 'device' && data.id === this.deviceData.id) {
        this._handleDeviceUpdate(data);
      }
    };

    this.api.onUpdate(this.updateCallback);
  }

  /**
   * Update device from API (common implementation)
   */
  async updateDevice() {
    if (!this.api) {
      this.error('API client not initialized');
      return;
    }

    try {
      const devices = await this.api.getDevices(this.deviceData.stationId);

      // Match by ID preferred, fallback to SN
      const deviceData = devices.find(d =>
        d.id === this.deviceData.id ||
        d.deviceSn === this.deviceData.deviceSn
      );

      if (deviceData) {
        await this._handleDeviceUpdate(deviceData);
        // Only set available if we successfully updated
        if (!this.getAvailable()) {
          this.setAvailable();
        }
      } else {
        // Don't mark unavailable immediately to avoid flickering on partial API returns
        this.log('Device not found in API update, skipping update');
      }
    } catch (error) {
      this.error('Error updating device:', error);
      // this.setUnavailable(this.homey.__('error.update_failed')); // Optional: keep available but log error
    }
  }

  /**
   * Debounce capability updates to prevent UI flickering
   * @param {string} capabilityId - Capability to update
   * @param {*} value - New value
   * @param {number} delay - Optional delay override (ms)
   */
  _debounceCapabilityUpdate(capabilityId, value, delay = null) {
    // Get debounce delay
    const debounceDelay = delay || this.debounceDelays[capabilityId] || this.debounceDelays.default;

    // Store pending value
    this.pendingUpdates.set(capabilityId, value);

    // Clear existing timer
    if (this.updateDebounceTimers.has(capabilityId)) {
      clearTimeout(this.updateDebounceTimers.get(capabilityId));
    }

    // Set new timer
    const timer = setTimeout(async () => {
      const pendingValue = this.pendingUpdates.get(capabilityId);

      try {
        // Only update if value actually changed
        const currentValue = this.getCapabilityValue(capabilityId);
        if (currentValue !== pendingValue) {
          await this.setCapabilityValue(capabilityId, pendingValue);
          this.log(`[Debounced] Updated ${capabilityId} to ${pendingValue}`);
        }
      } catch (error) {
        this.error(`Failed to update ${capabilityId}:`, error);
      }

      // Cleanup
      this.updateDebounceTimers.delete(capabilityId);
      this.pendingUpdates.delete(capabilityId);
    }, debounceDelay);

    this.updateDebounceTimers.set(capabilityId, timer);
  }

  /**
   * Handle device data update (base implementation)
   * Override in subclasses for device-specific logic
   * @param {Object} deviceData - Device data from API
   */
  async _handleDeviceUpdate(deviceData) {
    if (!deviceData) {
      this.log('No device data provided for update');
      return;
    }

    try {
      // Update common capabilities

      // Battery level (batInfo is 0-3 scale)
      if (this.hasCapability('measure_battery') && deviceData.batInfo !== undefined) {
        const batteryLevel = Math.round((parseInt(deviceData.batInfo, 10) * 100) / 3);
        await this.setCapabilityValue('measure_battery', Math.min(100, Math.max(0, batteryLevel))).catch(e => this.error('Battery update failed:', e));
      }

      // Battery alarm
      if (this.hasCapability('alarm_battery') && deviceData.batInfo !== undefined) {
        const batteryLevel = Math.round((parseInt(deviceData.batInfo, 10) * 100) / 3);
        const lowBattery = batteryLevel < 20;
        await this.setCapabilityValue('alarm_battery', lowBattery).catch(e => this.error('Battery alarm update failed:', e));
      }

      // Signal strength (rfLevel is 0-4 scale or direct dBm)
      if (this.hasCapability('measure_signal_strength')) {
        let signalVal = deviceData.signal || deviceData.rssi || deviceData.rfLevel || deviceData.signalLevel;

        if (signalVal !== undefined && signalVal !== null) {
          let signalStrengthDbm = -100;

          if (typeof signalVal === 'number' && signalVal < 0) {
            // Already in dBm
            signalStrengthDbm = signalVal;
          } else {
            // Convert 0-4 scale to dBm
            const s = parseInt(signalVal, 10);
            if (!isNaN(s)) {
              if (s >= 4) signalStrengthDbm = -55;
              else if (s === 3) signalStrengthDbm = -67;
              else if (s === 2) signalStrengthDbm = -79;
              else if (s === 1) signalStrengthDbm = -91;
              else if (s === 0) signalStrengthDbm = -100;
            }
          }

          await this.setCapabilityValue('measure_signal_strength', signalStrengthDbm).catch(e => this.error('Signal strength update failed:', e));
        }
      }

      // Online status
      if (deviceData.online !== undefined) {
        const isOnline = deviceData.online === '1' || deviceData.online === 1 || deviceData.online === true;
        if (!isOnline && this.getAvailable()) {
          this.log('Device reported offline');
        }
      }

      // Update last seen timestamp
      if (this.hasCapability('measure_last_seen')) {
        await this.setCapabilityValue('measure_last_seen', new Date().toISOString()).catch(e => {});
      }

      this.log('Base device update completed');
    } catch (error) {
      this.error('Error in base _handleDeviceUpdate:', error);
    }
  }

  /**
   * Wrapper for temp data sync request (used by TemperatureSensor)
   */
  async _requestTempDataSync() {
    if (!this.api) {
      this.error('API client not initialized');
      return;
    }

    try {
      // Station ID is needed, devices list is optional/all
      await this.api.requestTempDataSync(this.deviceData.stationId, [this.deviceData.deviceSn]);
    } catch (err) {
      this.error('Failed to request temp data sync:', err);
    }
  }

  /**
   * Update capability immediately (bypass debouncing)
   * Use for critical updates like alarms
   */
  async _immediateCapabilityUpdate(capabilityId, value) {
    // Cancel pending debounced update
    if (this.updateDebounceTimers.has(capabilityId)) {
      clearTimeout(this.updateDebounceTimers.get(capabilityId));
      this.updateDebounceTimers.delete(capabilityId);
      this.pendingUpdates.delete(capabilityId);
    }

    // Update immediately
    try {
      const currentValue = this.getCapabilityValue(capabilityId);
      if (currentValue !== value) {
        await this.setCapabilityValue(capabilityId, value);
        this.log(`[Immediate] Updated ${capabilityId} to ${value}`);
      }
    } catch (error) {
      this.error(`Failed to update ${capabilityId}:`, error);
    }
  }

  /**
   * Cleanup debounce timers and callbacks on device deletion
   */
  async onDeleted() {
    this.log('Device is being deleted, cleaning up...');

    // Clear all pending timers
    for (const timer of this.updateDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.updateDebounceTimers.clear();
    this.pendingUpdates.clear();

    // FIX: Remove callback from API to prevent memory leak
    if (this.updateCallback && this.api) {
      this.api.removeUpdateCallback(this.updateCallback);
      this.updateCallback = null;
    }

    // Clear polling interval
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.log('Device cleanup completed');
  }

  /**
   * onUninit is called when the device is uninitialized (e.g., app restart)
   */
  async onUninit() {
    // Reuse onDeleted cleanup logic
    await this.onDeleted();
  }
}

module.exports = XSenseDeviceBase;
