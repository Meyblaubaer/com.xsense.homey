'use strict';

const Homey = require('homey');

class SmokeDetectorDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('SmokeDetectorDevice has been initialized');

    // Get device data
    this.deviceData = this.getData();
    this.settings = this.getSettings();

    // Get credentials from store (also keep legacy device data in sync)
    const store = this.getStore();
    this.email = store.email;
    this.password = store.password;

    // Older paired devices had station/house IDs only in the store, so copy them over
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

      // Initial data fetch
      await this.updateDevice();

      // Setup polling
      this.pollInterval = setInterval(() => {
        this.updateDevice();
      }, 60000); // Poll every minute

    } catch (error) {
      this.error('Error initializing device:', error);
      this.setUnavailable(this.homey.__('error.initialization_failed'));
    }

    // Register capability listeners
    this._registerCapabilityListeners();

    // Initialize capabilities directly to ensure they appear in UI
    if (this.hasCapability('alarm_smoke') && this.getCapabilityValue('alarm_smoke') === null) {
      this.setCapabilityValue('alarm_smoke', false).catch(this.error);
    }
    if (this.hasCapability('alarm_co') && this.getCapabilityValue('alarm_co') === null) {
      this.setCapabilityValue('alarm_co', false).catch(this.error);
    }
    if (this.hasCapability('measure_smoke_status') && this.getCapabilityValue('measure_smoke_status') === null) {
      this.setCapabilityValue('measure_smoke_status', 'OK').catch(this.error);
    }

    // Register Mute Action
    this.homey.flow.getActionCard('mute_alarm')
      .registerRunListener(async (args, state) => {
        return args.device.muteAlarm();
      });
  }

  /**
   * Register capability listeners
   */
  _registerCapabilityListeners() {
    // Currently no controllable capabilities
    // Smoke detectors are mainly monitoring devices
  }

  /**
   * Update device data from API
   */
  async updateDevice() {
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
        // this.setUnavailable(this.homey.__('error.device_not_found')); 
      }
    } catch (error) {
      this.error('Error updating device:', error);
      // this.setUnavailable(this.homey.__('error.update_failed')); // Optional: keep available but log error
    }
  }

  /**
   * Handle device data update
   */
  async _handleDeviceUpdate(deviceData) {
    this.log(`_handleDeviceUpdate: ${JSON.stringify(deviceData)}`);
    try {
      // Store previous values for change detection
      const prevSmoke = this.getCapabilityValue('alarm_smoke');
      const prevBattery = this.getCapabilityValue('alarm_battery');

      // Update smoke alarm status
      if (this.hasCapability('alarm_smoke')) {
        const status = deviceData.alarmStatus;
        // Handle "1", "0", true, false, 1, 0
        const smokeDetected = status === true || status === 1 || status === '1' || status === 'true';
        await this.setCapabilityValue('alarm_smoke', smokeDetected);

        // Update custom status string for Dropdown visibility
        if (this.hasCapability('measure_smoke_status')) {
          const statusText = smokeDetected ? 'Alarm' : 'OK';
          await this.setCapabilityValue('measure_smoke_status', statusText);
        }
      }

      // Update battery level
      // batInfo: "3" (full) or "1" (low) usually for X-Sense. Scale 0-3?
      if (this.hasCapability('measure_battery') && deviceData.batInfo !== undefined) {
        let batteryLevel = 100;
        const bat = parseInt(deviceData.batInfo, 10);

        if (!isNaN(bat)) {
          // Assuming 3 is max based on logs ("batInfo": "3")
          batteryLevel = Math.round((bat / 3) * 100);
          if (batteryLevel > 100) batteryLevel = 100;
        }

        await this.setCapabilityValue('measure_battery', batteryLevel);

        // Update battery alarm
        if (this.hasCapability('alarm_battery')) {
          const lowBattery = batteryLevel < 20;
          await this.setCapabilityValue('alarm_battery', lowBattery);


        }
      }

      // Update temperature
      if (this.hasCapability('measure_temperature')) {
        const temp = deviceData.temperature || deviceData.temp;
        if (temp !== undefined) {
          await this.setCapabilityValue('measure_temperature', temp);
        }
      }

      // Update humidity
      if (this.hasCapability('measure_humidity')) {
        const humidity = deviceData.humidity || deviceData.humi;
        if (humidity !== undefined) {
          await this.setCapabilityValue('measure_humidity', humidity);
        }
      }

      // Update CO alarm
      if (this.hasCapability('alarm_co')) {
        const coVal = Number(deviceData.coPpm || deviceData.coLevel || deviceData.coValue || deviceData.co || 0);
        const coDetected = coVal > 0;
        const prevCO = this.getCapabilityValue('alarm_co');
        await this.setCapabilityValue('alarm_co', coDetected);

        // Trigger flow if CO was just detected
        if (coDetected && !prevCO) {
          await this.homey.flow.getDeviceTriggerCard('co_detected')
            .trigger(this, {
              device: this.getName(),
              co_level: coVal
            });
        }
      }

      // Update CO level (ppm)
      if (this.hasCapability('measure_co')) {
        const coLevel = Number(deviceData.coPpm || deviceData.coLevel || deviceData.coValue || deviceData.co || 0);
        await this.setCapabilityValue('measure_co', coLevel);
      }

      // Check mute status
      if (deviceData.muteStatus === true || deviceData.muteStatus === 1) {
        await this.homey.flow.getDeviceTriggerCard('device_muted')
          .trigger(this, {
            device: this.getName()
          });
      }

      // Check for SOS Event
      // Using generic 'event' field from _handleEventMessage or explicit 'sospush' if passed
      if (deviceData.event === 'sospush' || deviceData.type === 'sospush') {
        this.log('🚨 SOS Button Pressed!');
        await this.homey.flow.getDeviceTriggerCard('sos_pressed')
          .trigger(this, {
            device: this.getName()
          });
      }

      // Check for Keypad Event
      if (deviceData.event === 'keyboard' || (deviceData.type === 'keyboard' && deviceData.keyAction)) {
        this.log('⌨️ Keypad Event:', deviceData.keyAction);
        await this.homey.flow.getDeviceTriggerCard('keypad_event')
          .trigger(this, {
            device: this.getName(),
            event_type: deviceData.keyAction || 'unknown'
          });
      }

      // Update settings if changed
      if (deviceData.softwareVersion && deviceData.softwareVersion !== this.settings.software_version) {
        await this.setSettings({
          software_version: deviceData.softwareVersion
        });
      }

      await this.setAvailable();

    } catch (error) {
      this.error('Error handling device update:', error);
    }
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

  /**
   * Mute alarm
   */
  async muteAlarm() {
    try {
      this.log('Muting alarm...');
      await this.api.muteAlarm(this.deviceData.id);
      return true;
    } catch (error) {
      this.error('Error muting alarm:', error);
      throw new Error(this.homey.__('error.mute_failed'));
    }
  }

  /**
   * onAdded is called when the user adds the device.
   */
  async onAdded() {
    this.log('SmokeDetectorDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('SmokeDetectorDevice settings were changed', changedKeys);

    try {
      const configUpdates = {};

      if (changedKeys.includes('alarm_volume')) configUpdates.alarmVol = String(newSettings.alarm_volume);
      if (changedKeys.includes('voice_volume')) configUpdates.voiceVol = String(newSettings.voice_volume);
      if (changedKeys.includes('alarm_tone')) configUpdates.alarmTone = String(newSettings.alarm_tone);
      if (changedKeys.includes('led_brightness')) configUpdates.ledBrt = String(newSettings.led_brightness);
      if (changedKeys.includes('is_fire_drill')) configUpdates.isFireDrill = newSettings.is_fire_drill ? "1" : "0";

      if (Object.keys(configUpdates).length > 0) {
        // Need to identify if we are configuring the Station or the Device
        // SC07-WX IS the station, but settings might be in 2nd_info or 2nd_systime
        // Generally, we update the station shadow
        await this.api.setStationConfig(this.deviceData.stationId || this.deviceData.id, configUpdates);
        this.log('Settings updated successfully');
      }
    } catch (error) {
      this.error('Failed to update settings:', error);
      throw new Error(this.homey.__('error.settings_update_failed'));
    }
  }

  /**
   * onRenamed is called when the user updates the device's name.
   */
  async onRenamed(name) {
    this.log('SmokeDetectorDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('SmokeDetectorDevice has been deleted');

    // Clear polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}

module.exports = SmokeDetectorDevice;
