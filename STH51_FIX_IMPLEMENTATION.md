# STH51 Temperature Sensor Fix - Implementation Complete

**Date:** 2026-01-15
**Status:** ✅ **IMPLEMENTED - READY FOR TESTING**

---

## 🎯 Problem Summary

STH51 temperature sensor was receiving data from X-Sense but the Homey integration was not updating temperature and humidity values.

**Root Cause:**
1. Temperature data exists in `device.status.b` field but was not being parsed
2. Humidity data exists in `device.status.c` field but was not being parsed
3. MQTT topic `2nd_tempdatalog` contains real-time updates in special CSV format but was not being handled

---

## ✅ Solution Implemented (Two-Phase Fix)

### Phase 1: Quick Fix - API Status Parsing ✅

**File:** `lib/XSenseAPI.js` (lines 744-790)

**What was added:**
```javascript
// STH51/STH54/STH0A FIX: Parse status.b and status.c for temperature/humidity
if (device.status && (device.type === 'STH51' || device.type === 'STH54' || device.type === 'STH0A')) {
  const temp = parseFloat(device.status.b);
  const hum = parseFloat(device.status.c);

  if (!isNaN(temp)) {
    deviceData.temperature = temp;
    console.log(`[XSenseAPI] Parsed temperature for ${device.type} ${device.deviceSn}: ${temp}°C`);
  }

  if (!isNaN(hum)) {
    deviceData.humidity = hum;
    console.log(`[XSenseAPI] Parsed humidity for ${device.type} ${device.deviceSn}: ${hum}%`);
  }

  // Debug log sensor data
  this.debug.logSensorData(device.type, device.deviceSn, {
    temperature: deviceData.temperature,
    humidity: deviceData.humidity,
    batInfo: device.batInfo,
    rfLevel: device.rfLevel,
    online: device.online
  }, 'api-status');
}
```

**Benefits:**
- ✅ Immediate fix using existing API data
- ✅ Works for STH51, STH54, and STH0A devices
- ✅ Updates every 60 seconds via polling
- ✅ No new MQTT dependencies

### Phase 2: Complete Fix - MQTT Real-Time Updates ✅

**File:** `lib/XSenseAPI.js`

#### 2.1 Added MQTT Topic Subscriptions

**Location:** Line 2172 (in `_subscribeStationTopics()`)

**What was added:**
```javascript
// STH51 Specific Topics (from refresh.md)
topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_tempdatalog/update`);
topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_apptempdata/update`); // ← NEW
topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_extendmuteup/update`);
topics.push(`$aws/things/${typeSnThing}/shadow/name/2nd_extendalarm/update`);
```

**Note:** `2nd_tempdatalog` was already present, added `2nd_apptempdata` for completeness.

#### 2.2 Added MQTT Message Handler Routing

**Location:** Line 2278 (in `_handleMQTTMessage()`)

**What was added:**
```javascript
// STH51/STH54 Temperature Data Log Handler
if (topic.includes('/shadow/name/2nd_tempdatalog') || topic.includes('/shadow/name/2nd_apptempdata')) {
  this._handleTempDataLog(topic, data);
  return;
}
```

#### 2.3 Implemented `_handleTempDataLog()` Function

**Location:** After `_handleWiFiDeviceShadow()` (~line 2378)

**Function Purpose:** Parse MQTT temperature data in CSV array format

**Data Format Handled:**
```json
{
  "state": {
    "reported": {
      "stationSN": "14998680",
      "data": [{
        "deviceSN": "00000003",
        "type": "STH51",
        "20260115": [
          "030500,18.4,51.2",
          "030600,18.4,51.2",
          "033300,18.6,48.8"
        ]
      }]
    }
  }
}
```

**Implementation:**
```javascript
_handleTempDataLog(topic, data) {
  const reported = data?.state?.reported;
  if (!reported || !reported.data) return;

  const stationSN = reported.stationSN || reported.stationSn;
  this.debug.logSensorData('STH51-TempDataLog', stationSN, reported, 'mqtt');

  for (const deviceData of reported.data) {
    const deviceSn = deviceData.deviceSN || deviceData.deviceSn;
    const type = deviceData.type;
    if (!deviceSn) continue;

    // Get today's date key (e.g., "20260115")
    const dateKeys = Object.keys(deviceData).filter(k => k.match(/^\d{8}$/));
    if (dateKeys.length === 0) continue;

    const today = dateKeys[0];
    const entries = deviceData[today];
    if (!entries || !Array.isArray(entries) || entries.length === 0) continue;

    // Parse latest entry: "HHMM,TEMP,HUM"
    const latest = entries[entries.length - 1];
    const parts = latest.split(',');
    if (parts.length !== 3) {
      console.warn(`[XSenseAPI] Invalid temp data format for ${deviceSn}: ${latest}`);
      continue;
    }

    const [time, tempStr, humStr] = parts;
    const temp = parseFloat(tempStr);
    const hum = parseFloat(humStr);

    if (isNaN(temp) || isNaN(hum)) {
      console.warn(`[XSenseAPI] Invalid temp/hum values for ${deviceSn}: temp=${tempStr}, hum=${humStr}`);
      continue;
    }

    // Update device in cache
    const deviceId = this.devicesBySn.get(deviceSn);
    if (deviceId) {
      const existing = this.devices.get(deviceId) || { id: deviceId };
      const merged = {
        ...existing,
        temperature: temp,
        humidity: hum,
        lastTempUpdate: new Date().toISOString(),
        id: deviceId
      };

      this.devices.set(deviceId, merged);
      this._emitUpdate('device', merged);

      console.log(`[XSenseAPI] 🌡️ Updated ${type} ${deviceSn} via MQTT: ${temp}°C, ${hum}%`);

      // Debug logging
      this.debug.logSensorData(type, deviceSn, {
        temperature: temp,
        humidity: hum,
        time: time,
        date: today,
        totalEntries: entries.length
      }, 'mqtt-tempdatalog');
    } else {
      console.warn(`[XSenseAPI] Temperature data received for unknown device ${deviceSn}`);
    }
  }
}
```

**Benefits:**
- ✅ Real-time temperature/humidity updates via MQTT
- ✅ Parses CSV array format correctly
- ✅ Handles multiple devices in single message
- ✅ Comprehensive error handling
- ✅ Debug logging for troubleshooting

---

## 🎉 What This Fix Provides

### For STH51 Devices:
1. **Temperature Updates** - Parsed from `status.b` (API) and `2nd_tempdatalog` (MQTT)
2. **Humidity Updates** - Parsed from `status.c` (API) and `2nd_tempdatalog` (MQTT)
3. **Dual Update Sources:**
   - **Polling:** Every 60s via `getAllDevices()` API call
   - **Real-time:** Via MQTT `2nd_tempdatalog` topic
4. **Redundancy:** If MQTT disconnects, polling still works
5. **Debug Support:** All data logged to `/tmp/xsense-debug/sensor-STH51.jsonl`

### Also Works For:
- **STH54** - Temperature/Humidity sensor (newer model)
- **STH0A** - Temperature/Humidity sensor (alternative model)

---

## 🧪 Testing Instructions

### 1. Start App with Debug Enabled

```bash
cd /Users/sven-christianmeyhoefer/Documents/com.xsense.svenm
export XSENSE_DEBUG=true
homey app run
```

### 2. Watch for Temperature Updates (Live)

In another terminal:
```bash
# Watch console logs
tail -f /tmp/homey-debug-test.log | grep -E "(STH51|Temperature|Humidity|🌡️)"

# Watch MQTT messages
tail -f /tmp/xsense-debug/mqtt-traffic.jsonl | grep "tempdatalog"

# Watch sensor data logs
tail -f /tmp/xsense-debug/sensor-STH51.jsonl | jq '{temp: .data.temperature, hum: .data.humidity, source: .source}'
```

### 3. Expected Console Output

**From API Polling (every 60s):**
```
[XSenseAPI] Parsed temperature for STH51 00000003: 18.6°C
[XSenseAPI] Parsed humidity for STH51 00000003: 48.8%
```

**From MQTT Real-time:**
```
[XSenseAPI] 🌡️ Updated STH51 00000003 via MQTT: 18.6°C, 48.8%
```

### 4. Verify in Homey App

Open your Homey mobile app or web interface:
1. Find your STH51 device
2. Check temperature capability - should show current value (e.g., 18.6°C)
3. Check humidity capability - should show current value (e.g., 48.8%)
4. Values should update every ~60 seconds or immediately via MQTT

---

## 🔍 Troubleshooting

### Temperature Still Not Showing?

**Check 1: Is data arriving?**
```bash
grep "status.*b.*:" /tmp/xsense-debug/device-*.jsonl | head -5
```
Should show: `"b": "18.6"` for STH51 devices

**Check 2: Is MQTT working?**
```bash
grep "tempdatalog" /tmp/xsense-debug/mqtt-traffic.jsonl | head -5
```
Should show MQTT messages with CSV data

**Check 3: Is parsing working?**
```bash
grep "Parsed temperature" /tmp/homey-debug-test.log
```
Should show: `Parsed temperature for STH51 00000003: 18.6°C`

**Check 4: Device exists in Homey?**
- Check Homey app - is STH51 device visible?
- Check device driver - is `temperature` capability registered?

### MQTT Handler Not Called?

**Check subscription:**
```bash
grep "2nd_tempdatalog" /tmp/xsense-debug/mqtt-subscriptions.log
```
Should show: Topic subscribed successfully

**Check routing:**
Add temporary console.log in `_handleMQTTMessage()` to verify topic detection

---

## 📊 Comparison: Before vs After

| Feature | Before Fix | After Fix |
|---------|-----------|-----------|
| Temperature Updates | ❌ None | ✅ Every 60s (API) + Real-time (MQTT) |
| Humidity Updates | ❌ None | ✅ Every 60s (API) + Real-time (MQTT) |
| MQTT Support | ⚠️ Topic subscribed but ignored | ✅ Fully parsed |
| API Data | ⚠️ Available but not used | ✅ Extracted from status.b/c |
| Debug Logging | ❌ None | ✅ Comprehensive |
| Update Speed | ❌ Never | ✅ ~1-60 seconds |
| Redundancy | ❌ Single point of failure | ✅ API + MQTT fallback |

---

## 🚀 Next Steps

### Immediate (For You):
1. **Test the fix** - Run app and verify STH51 temperature/humidity updates
2. **Check logs** - Confirm data is being parsed correctly
3. **Report results** - Let me know if it works or if there are any issues

### Future Enhancements (Optional):
1. **Historical Data** - Parse entire CSV array for temperature history graphs
2. **Other Sensors** - Extend to other X-Sense sensor types if needed
3. **Alerting** - Add temperature threshold alerts

---

## 📝 Code Changes Summary

**Files Modified:**
- `lib/XSenseAPI.js` - 3 sections modified/added

**Lines Changed:**
- Line 744-790: Added status.b/c parsing in `getAllDevices()`
- Line 2172: Added `2nd_apptempdata` subscription
- Line 2278: Added MQTT handler routing for tempdatalog
- Line ~2378: Added `_handleTempDataLog()` function (~95 lines)

**Total Lines Added:** ~120 lines
**Breaking Changes:** None
**Backward Compatible:** Yes

---

## ✅ Completion Status

- [x] Phase 1: Quick Fix (status.b/c parsing) - **DONE**
- [x] Phase 2: MQTT subscription - **DONE** (was already present)
- [x] Phase 2: Add 2nd_apptempdata subscription - **DONE**
- [x] Phase 2: MQTT handler implementation - **DONE**
- [x] Phase 2: Debug logging - **DONE**
- [ ] Testing with real device - **PENDING** (your turn!)

---

**Implementation Date:** 2026-01-15 05:15 CET
**Ready for Testing:** ✅ YES
**Next Action:** Run `homey app run` with `XSENSE_DEBUG=true` and verify STH51 updates work!
