'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Enhanced Debug Logger for X-Sense Integration
 *
 * Features:
 * - MQTT traffic logging (all topics + payloads)
 * - SSL/TLS handshake logging
 * - Shadow data dumping to files
 * - Sensor-specific debugging
 * - Structured logging like Home Assistant
 *
 * Enable via: XSENSE_DEBUG=true or XSENSE_DEBUG=mqtt,shadows,sensors
 */
class DebugLogger {
  constructor(homey, context = 'XSense') {
    this.homey = homey;
    this.context = context;

    // Parse debug flags from environment or Homey settings
    this.debugEnabled = this._parseDebugFlags();

    // Create debug output directory
    this.debugDir = '/tmp/xsense-debug';
    if (this.debugEnabled.any) {
      try {
        if (!fs.existsSync(this.debugDir)) {
          fs.mkdirSync(this.debugDir, { recursive: true });
        }
      } catch (err) {
        this.error('[DebugLogger] Failed to create debug directory:', err);
      }
    }

    // MQTT message counter
    this.mqttMessageCount = 0;
    this.shadowDumpCount = 0;

    // Memory Management: Limit stored messages
    this.maxMessages = 1000; // Keep last 1000 messages
    this.messages = [];

    if (this.debugEnabled.any) {
      this.log('=== DEBUG MODE ENABLED ===');
      this.log(`Flags: ${JSON.stringify(this.debugEnabled)}`);
      this.log(`Debug directory: ${this.debugDir}`);
      this.log(`Message limit: ${this.maxMessages}`);
    }
  }

  /**
   * Parse debug flags from environment or default to all enabled
   */
  _parseDebugFlags() {
    const envDebug = process.env.XSENSE_DEBUG || '';

    if (!envDebug || envDebug === 'false' || envDebug === '0') {
      return { any: false };
    }

    if (envDebug === 'true' || envDebug === '1') {
      // Enable all debug modes
      return {
        any: true,
        mqtt: true,
        shadows: true,
        sensors: true,
        ssl: true,
        api: true,
        all: true
      };
    }

    // Parse specific flags: XSENSE_DEBUG=mqtt,shadows,sensors
    const flags = envDebug.toLowerCase().split(',').map(f => f.trim());
    return {
      any: flags.length > 0,
      mqtt: flags.includes('mqtt'),
      shadows: flags.includes('shadows'),
      sensors: flags.includes('sensors'),
      ssl: flags.includes('ssl'),
      api: flags.includes('api'),
      all: flags.includes('all')
    };
  }

  /**
   * Log with context - uses Homey logger if available
   */
  log(...args) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [${this.context}]`;

    if (this.homey && this.homey.app) {
      this.homey.app.log(message, ...args);
    } else if (this.homey && this.homey.log) {
      this.homey.log(message, ...args);
    } else {
      // Fallback for testing without Homey
      console.log(message, ...args);
    }
  }

  /**
   * Error logging with context
   */
  error(...args) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [${this.context}] ERROR:`;

    if (this.homey && this.homey.app) {
      this.homey.app.error(message, ...args);
    } else if (this.homey && this.homey.error) {
      this.homey.error(message, ...args);
    } else {
      // Fallback for testing without Homey
      console.error(message, ...args);
    }
  }

  /**
   * Add message to in-memory buffer with size limit
   */
  _addMessage(message) {
    this.messages.push(message);

    // Keep only last N messages to prevent memory leaks
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  /**
   * Log MQTT message
   */
  logMQTTMessage(direction, topic, payload, metadata = {}) {
    if (!this.debugEnabled.mqtt && !this.debugEnabled.all) return;

    this.mqttMessageCount++;
    const timestamp = new Date().toISOString();
    const messageId = this.mqttMessageCount;

    const logEntry = {
      timestamp,
      messageId,
      direction, // 'incoming' or 'outgoing'
      topic,
      payload: this._tryParseJSON(payload),
      metadata
    };

    // Store in memory with limit
    this._addMessage(logEntry);

    // Console log
    this.log(`MQTT ${direction.toUpperCase()} #${messageId}`);
    this.log(`  Topic: ${topic}`);
    if (typeof logEntry.payload === 'object') {
      this.log(`  Payload:`, JSON.stringify(logEntry.payload, null, 2));
    } else {
      this.log(`  Payload: ${payload}`);
    }
    if (Object.keys(metadata).length > 0) {
      this.log(`  Meta:`, metadata);
    }

    // File log
    this._writeToFile(`mqtt-traffic.jsonl`, JSON.stringify(logEntry) + '\n', true);

    // Also write to device-specific log if topic contains device info
    if (topic.includes('/')) {
      const topicParts = topic.split('/');
      if (topicParts.length >= 3) {
        const deviceIdentifier = topicParts[topicParts.length - 2];
        this._writeToFile(`mqtt-device-${deviceIdentifier}.jsonl`, JSON.stringify(logEntry) + '\n', true);
      }
    }
  }

  /**
   * Log MQTT subscription
   */
  logMQTTSubscription(topic, qos = 0) {
    if (!this.debugEnabled.mqtt && !this.debugEnabled.all) return;

    this.log(`MQTT SUBSCRIBE: ${topic} (QoS: ${qos})`);
    this._writeToFile('mqtt-subscriptions.log', `[${new Date().toISOString()}] ${topic} (QoS: ${qos})\n`, true);
  }

  /**
   * Log SSL/TLS handshake details
   */
  logSSLHandshake(details) {
    if (!this.debugEnabled.ssl && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      ...details
    };

    this.log('SSL/TLS HANDSHAKE');
    this.log(JSON.stringify(logEntry, null, 2));

    this._writeToFile('ssl-handshakes.jsonl', JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Dump shadow data to file
   */
  dumpShadow(thingName, shadowName, shadowData, metadata = {}) {
    if (!this.debugEnabled.shadows && !this.debugEnabled.all) return;

    this.shadowDumpCount++;
    const timestamp = new Date().toISOString();
    const dumpId = this.shadowDumpCount;

    const dumpEntry = {
      timestamp,
      dumpId,
      thingName,
      shadowName: shadowName || 'default',
      metadata,
      shadow: shadowData
    };

    this.log(`SHADOW DUMP #${dumpId}: ${thingName}/${shadowName || 'default'}`);
    this.log(`  Keys: ${shadowData ? Object.keys(shadowData).length : 0}`);
    if (metadata.deviceType) {
      this.log(`  DeviceType: ${metadata.deviceType}`);
    }

    // Write to main shadow log
    this._writeToFile('shadows.jsonl', JSON.stringify(dumpEntry) + '\n', true);

    // Write individual shadow file for easy inspection
    const safeName = `${thingName}-${shadowName || 'default'}`.replace(/[^a-zA-Z0-9-_]/g, '_');
    this._writeToFile(`shadow-${safeName}.json`, JSON.stringify(dumpEntry, null, 2));
  }

  /**
   * Log sensor-specific data (STH51, etc.)
   */
  logSensorData(deviceType, deviceId, sensorData, source = 'unknown') {
    if (!this.debugEnabled.sensors && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      deviceType,
      deviceId,
      source, // 'mqtt', 'shadow', 'api'
      data: sensorData
    };

    this.log(`SENSOR DATA [${deviceType}] ${deviceId} (${source})`);
    this.log(JSON.stringify(sensorData, null, 2));

    // Write to sensor-specific log
    this._writeToFile(`sensor-${deviceType}.jsonl`, JSON.stringify(logEntry) + '\n', true);

    // Write to device-specific log
    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9-_]/g, '_');
    this._writeToFile(`device-${safeDeviceId}.jsonl`, JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Log API call
   */
  logAPICall(method, url, bizCode, request, response, duration) {
    if (!this.debugEnabled.api && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      method,
      url,
      bizCode,
      duration,
      request: this._sanitizeRequest(request),
      response: response ? this._truncateResponse(response) : null
    };

    this.log(`API CALL: ${bizCode} (${duration}ms)`);
    this.log(`  URL: ${url}`);
    if (response && response.code !== undefined) {
      this.log(`  Response Code: ${response.code}`);
    }

    this._writeToFile('api-calls.jsonl', JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Log device update with before/after comparison
   */
  logDeviceUpdate(deviceId, deviceName, before, after, source = 'unknown') {
    if (!this.debugEnabled.sensors && !this.debugEnabled.all) return;

    const timestamp = new Date().toISOString();
    const changes = this._detectChanges(before, after);

    const logEntry = {
      timestamp,
      deviceId,
      deviceName,
      source,
      changesDetected: changes.length,
      changes,
      before,
      after
    };

    if (changes.length > 0) {
      this.log(`DEVICE UPDATE: ${deviceName} (${changes.length} changes from ${source})`);
      changes.forEach(change => {
        this.log(`  ${change.field}: ${change.before} → ${change.after}`);
      });
    }

    this._writeToFile('device-updates.jsonl', JSON.stringify(logEntry) + '\n', true);
  }

  /**
   * Create debug snapshot (all current state)
   */
  createSnapshot(label, data) {
    if (!this.debugEnabled.any) return;

    const timestamp = new Date().toISOString();
    const snapshot = {
      timestamp,
      label,
      data
    };

    const filename = `snapshot-${label}-${Date.now()}.json`;
    this._writeToFile(filename, JSON.stringify(snapshot, null, 2));
    this.log(`DEBUG SNAPSHOT created: ${filename}`);
  }

  /**
   * Helper: Try to parse JSON
   */
  _tryParseJSON(str) {
    if (typeof str !== 'string') return str;
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }

  /**
   * Helper: Write to file
   */
  _writeToFile(filename, content, append = false) {
    if (!this.debugEnabled.any) return;

    try {
      const filepath = path.join(this.debugDir, filename);
      if (append) {
        fs.appendFileSync(filepath, content, 'utf8');
      } else {
        fs.writeFileSync(filepath, content, 'utf8');
      }
    } catch (err) {
      this.error(`[DebugLogger] Failed to write ${filename}:`, err);
    }
  }

  /**
   * Helper: Detect changes between two objects
   */
  _detectChanges(before, after) {
    const changes = [];
    if (!before || !after) return changes;

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
      if (before[key] !== after[key]) {
        changes.push({
          field: key,
          before: before[key],
          after: after[key]
        });
      }
    }
    return changes;
  }

  /**
   * Helper: Sanitize request (remove sensitive data)
   */
  _sanitizeRequest(request) {
    if (!request) return null;
    const sanitized = { ...request };
    if (sanitized.password) sanitized.password = '***REDACTED***';
    if (sanitized.accessToken) sanitized.accessToken = '***REDACTED***';
    if (sanitized.refreshToken) sanitized.refreshToken = '***REDACTED***';
    return sanitized;
  }

  /**
   * Helper: Truncate large responses
   */
  _truncateResponse(response, maxLength = 5000) {
    const str = JSON.stringify(response);
    if (str.length > maxLength) {
      return {
        _truncated: true,
        _originalLength: str.length,
        data: str.substring(0, maxLength) + '...[TRUNCATED]'
      };
    }
    return response;
  }

  /**
   * Get debug statistics
   */
  getStats() {
    return {
      enabled: this.debugEnabled,
      mqttMessages: this.mqttMessageCount,
      shadowDumps: this.shadowDumpCount,
      debugDir: this.debugDir
    };
  }
}

module.exports = DebugLogger;
