'use strict';

const Homey = require('homey');

/**
 * Base class for all X-Sense devices with debouncing support
 */
class XSenseDeviceBase extends Homey.Device {
  
  async onInit() {
    // Debounce timers for capability updates
    this.updateDebounceTimers = new Map();
    this.pendingUpdates = new Map();
    
    // Default debounce delays (ms)
    this.debounceDelays = {
      'measure_temperature': 1000,    // 1 second for temperature
      'measure_humidity': 1000,       // 1 second for humidity
      'measure_battery': 2000,        // 2 seconds for battery
      'measure_rssi': 2000,           // 2 seconds for WiFi signal
      'measure_last_seen': 500,       // 0.5 seconds for last seen
      'default': 500                  // 0.5 seconds for everything else
    };
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
   * Cleanup debounce timers on device deletion
   */
  async onDeleted() {
    // Clear all pending timers
    for (const timer of this.updateDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.updateDebounceTimers.clear();
    this.pendingUpdates.clear();
  }
}

module.exports = XSenseDeviceBase;
