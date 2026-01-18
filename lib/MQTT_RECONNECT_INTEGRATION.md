# MQTT Reconnect with Exponential Backoff - Integration Guide

## Files Created

- `lib/MQTTReconnectStrategy.js` - Reconnect strategy class

## Integration in XSenseAPI.js

### 1. Import (DONE)
```javascript
const MQTTReconnectStrategy = require('./MQTTReconnectStrategy');
```

### 2. Initialize in Constructor

Add to constructor (around line 68):
```javascript
constructor(email, password, homey = null) {
  // ... existing code ...
  
  // MQTT Reconnect Strategy
  this.mqttReconnectStrategies = new Map();
}
```

### 3. Update connectMQTT() - Legacy MQTT (Line ~1741)

Replace:
```javascript
const client = mqtt.connect(broker, {
  clientId,
  username,
  password,
  clean: true,
  reconnectPeriod: 5000,  // <-- REMOVE FIXED PERIOD
  rejectUnauthorized: false
});
```

With:
```javascript
// Create reconnect strategy
const reconnectStrategy = new MQTTReconnectStrategy({
  minDelay: 1000,    // 1s
  maxDelay: 60000,   // 1min
  multiplier: 2
});
this.mqttReconnectStrategies.set(`legacy:${stationId}`, reconnectStrategy);

const client = mqtt.connect(broker, {
  clientId,
  username,
  password,
  clean: true,
  reconnectPeriod: 0,  // Disable automatic reconnect
  rejectUnauthorized: false
});

// Manual reconnect with exponential backoff
let reconnectTimer = null;
client.on('close', () => {
  const delay = reconnectStrategy.getNextDelay();
  this.debug.log(`[MQTT] Connection closed. Reconnecting in ${delay}ms (attempt ${reconnectStrategy.attemptCount})`);
  
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    this.debug.log('[MQTT] Attempting reconnect...');
    client.reconnect();
  }, delay);
});

client.on('connect', () => {
  reconnectStrategy.reset(); // Reset on successful connect
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  this.debug.log(`[XSenseAPI] Legacy MQTT connected for station ${stationId}`);
  this._subscribeLegacyTopics(info, houseId, stationId);
});
```

### 4. Update connectMQTT() - AWS IoT MQTT (Line ~1876)

Replace:
```javascript
const client = mqtt.connect(baseUrl, {
  // ... existing options ...
  reconnectPeriod: 30000,  // <-- REMOVE FIXED PERIOD
  // ... rest of options ...
});
```

With:
```javascript
// Create reconnect strategy
const reconnectStrategy = new MQTTReconnectStrategy({
  minDelay: 2000,    // 2s (AWS may be slower)
  maxDelay: 90000,   // 1.5min
  multiplier: 2
});
this.mqttReconnectStrategies.set(mqttKey, reconnectStrategy);

const client = mqtt.connect(baseUrl, {
  // ... existing options ...
  reconnectPeriod: 0,  // Disable automatic reconnect
  // ... rest of options ...
});

// Manual reconnect with exponential backoff
let reconnectTimer = null;
client.on('close', () => {
  const delay = reconnectStrategy.getNextDelay();
  this.debug.log(`[MQTT] Connection closed. Reconnecting in ${delay}ms (attempt ${reconnectStrategy.attemptCount})`);
  
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    // Re-presign URL before reconnect (AWS signatures expire)
    currentPath = presignPath('reconnect');
    client.options.path = currentPath;
    
    this.debug.log('[MQTT] Attempting reconnect with fresh signature...');
    client.reconnect();
  }, delay);
});

// Add to existing connect handler
client.on('connect', () => {
  reconnectStrategy.reset(); // Reset on successful connect
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // ... existing connect logic ...
});
```

### 5. Cleanup on disconnectMQTT()

Add cleanup for strategies:
```javascript
disconnectMQTT() {
  for (const [key, info] of this.mqttClients.entries()) {
    if (info.client) {
      info.client.end(true);
    }
    // Clean up reconnect strategy
    this.mqttReconnectStrategies.delete(key);
  }
  this.mqttClients.clear();
}
```

## Benefits

- **Prevents connection storms**: Gradual backoff prevents overwhelming server
- **Automatic recovery**: Exponential delays with jitter
- **AWS signature refresh**: Re-signs URLs before reconnect
- **Resource efficient**: Reduces unnecessary reconnect attempts
- **Production ready**: Used by AWS, Google, etc.

## Testing

```javascript
// Watch logs for reconnect pattern:
// Attempt 1: ~2s delay
// Attempt 2: ~4s delay  
// Attempt 3: ~8s delay
// Attempt 4: ~16s delay
// ...
// Max: ~90s delay
```

