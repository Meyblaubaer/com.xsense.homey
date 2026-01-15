# STH51 Debug Session - Findings Report

**Date:** 2026-01-15 04:28-04:33 CET
**Duration:** 5 minutes
**Debug Mode:** XSENSE_DEBUG=true
**App Version:** 1.1.0

---

## 🎯 Executive Summary

**STATUS:** ✅ **ROOT CAUSE IDENTIFIED!**

STH51 Temperatur-Daten **WERDEN empfangen** via MQTT, aber die Integration **ignoriert sie**, weil:

1. ❌ Der falsche MQTT Topic wird NICHT subscribed (`2nd_tempdatalog`)
2. ❌ Das spezielle Datenformat wird NICHT geparst
3. ❌ Der MQTT Handler hat KEINE Logik für STH51 Temperature Logs

**Die Daten sind DA - wir holen sie nur nicht ab!**

---

## 📊 Key Findings

### Finding 1: STH51 verwendet einen ANDEREN Shadow ✅

**MQTT Topic:** `$aws/things/SBS5014998680/shadow/name/2nd_tempdatalog/update`

**Nicht wie andere Devices:**
- Rauchmelder: `2nd_alarm_status`, `2nd_sensor_data`
- SC07-WX: `2nd_alarm_status`, `2nd_sensor_data`
- **STH51:** `2nd_tempdatalog` ← **FEHLT in unserer Subscription!**

### Finding 2: Spezielles Datenformat 📝

**Empfangen:**
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
          ...
          "033300,18.6,48.8"  // Format: HHMM,TEMP,HUM
        ]
      }]
    }
  }
}
```

**Erwartet (von aktuellem Code):**
```json
{
  "temperature": 18.6,
  "humidity": 48.8
}
```

**→ Format-Mismatch!**

### Finding 3: Alternative Datenquelle vorhanden! 🎁

**Device Status** (via `getAllDevices()` API) enthält bereits Temp/Humidity:

```json
"status": {
  "a": "0",
  "b": "18.6",    // ← TEMPERATURE!
  "c": "48.8",    // ← HUMIDITY!
  "d": "1",
  "e": [-20, 60],
  "f": [0, 100],
  "t": "20260115032804"
}
```

**Dieses Format kommt JETZT SCHON an, wird aber nicht genutzt!**

### Finding 4: Aktuelle Werte (live aus Log)

**STH51 Device SN:** 00000003
**Aktuelle Werte um 03:33 Uhr:**
- Temperatur: **18.6°C**
- Luftfeuchtigkeit: **48.8%**
- Letzte 29 Messungen vorhanden (05:00 - 03:33 Uhr)
- Update-Intervall: ~1 Stunde

---

## 🐛 Root Cause Analysis

### Problem 1: Missing MQTT Subscription

**File:** `lib/XSenseAPI.js`
**Function:** `_subscribeStationTopics()`

**Aktuell subscribed:**
```javascript
- $aws/things/{thingName}/shadow/name/2nd_systime/update
- $aws/things/{thingName}/shadow/name/2nd_info_{sn}/update
- $aws/things/{thingName}/shadow/name/2nd_alarm_status/update
- etc.
```

**Fehlt:**
```javascript
- $aws/things/{thingName}/shadow/name/2nd_tempdatalog/update  ❌
- $aws/things/{thingName}/shadow/name/2nd_apptempdata/update  ❌
```

### Problem 2: Missing MQTT Handler

**File:** `lib/XSenseAPI.js`
**Function:** `_handleMQTTMessage()`

**Aktuell:**
```javascript
if (topic.includes('/shadow/name/mainpage')) { ... }
if (topic.includes('/shadow/name/pwordup')) { ... }
if (topic.includes('/shadow/name/2nd_systime')) { ... }

// FEHLT:
// if (topic.includes('/shadow/name/2nd_tempdatalog')) { ... }
```

Messages werden empfangen (SPY log zeigt sie), aber **kein Handler verarbeitet sie**.

### Problem 3: Missing Data Parser

**Aktueller Code erwartet:**
- Flache JSON Struktur
- Felder: `temperature`, `humidity`, `temp`, `hum`

**Tatsächliches Format:**
- Verschachtelte Struktur mit Datum als Key
- Array von CSV-Strings: `"HHMM,TEMP,HUM"`
- Braucht Custom Parser

### Problem 4: Device Status Ignored

**File:** `lib/XSenseAPI.js`
**Function:** `getAllDevices()` oder MQTT handler

Device Status wird geholt, **aber Felder "b" und "c" werden nicht extrahiert**.

Code sucht nach:
- `device.temperature`
- `device.temp`

Aber nicht nach:
- `device.status.b` ← **DA IST DIE TEMPERATUR!**
- `device.status.c` ← **DA IST DIE HUMIDITY!**

---

## 💡 Solutions (3 Options)

### Solution 1: Quick Fix - Parse Device Status ⚡ **EMPFOHLEN**

**Aufwand:** 10 Minuten
**Impact:** Sofortige Temp/Humidity Updates

**Implementation:**
```javascript
// In getAllDevices() oder _handleDeviceUpdate()
if (device.status) {
  device.temperature = parseFloat(device.status.b) || null;
  device.humidity = parseFloat(device.status.c) || null;
}
```

**Vorteile:**
- ✅ Nutzt BESTEHENDE Daten
- ✅ Keine neuen Subscriptions
- ✅ Funktioniert SOFORT
- ✅ Minimal Code Change

**Nachteile:**
- ⚠️ Nur Updates wenn getAllDevices() gepollt wird (60s)
- ⚠️ Kein Real-time via MQTT

### Solution 2: Add 2nd_tempdatalog Handler 📡 **KOMPLETT**

**Aufwand:** 30-45 Minuten
**Impact:** Real-time Updates via MQTT

**Implementation:**

**Step 1:** Subscribe to topic
```javascript
// In _subscribeStationTopics()
const tempDataLogTopic = `$aws/things/${thingName}/shadow/name/2nd_tempdatalog/update`;
info.client.subscribe(tempDataLogTopic, { qos: 0 }, (err) => {
  if (!err) {
    this.debug.logMQTTSubscription(tempDataLogTopic, 0);
  }
});
```

**Step 2:** Add MQTT handler
```javascript
// In _handleMQTTMessage()
if (topic.includes('/shadow/name/2nd_tempdatalog')) {
  this._handleTempDataLog(topic, data);
  return;
}
```

**Step 3:** Parse data
```javascript
_handleTempDataLog(topic, data) {
  const reported = data.state?.reported;
  if (!reported || !reported.data) return;

  this.debug.logSensorData('STH51-TempDataLog', reported.stationSN, reported, 'mqtt');

  for (const deviceData of reported.data) {
    const deviceSn = deviceData.deviceSN;
    const type = deviceData.type;

    // Get today's data (date key like "20260115")
    const dateKeys = Object.keys(deviceData).filter(k => k.match(/^\d{8}$/));
    if (dateKeys.length === 0) continue;

    const today = dateKeys[0]; // Usually only one date
    const entries = deviceData[today];
    if (!entries || entries.length === 0) continue;

    // Get latest entry
    const latest = entries[entries.length - 1];
    const parts = latest.split(',');
    if (parts.length !== 3) continue;

    const [time, temp, hum] = parts;

    // Find device and update
    const deviceId = this.devicesBySn.get(deviceSn);
    if (deviceId) {
      const device = this.devices.get(deviceId);
      if (device) {
        device.temperature = parseFloat(temp);
        device.humidity = parseFloat(hum);
        device.lastTempUpdate = new Date().toISOString();

        console.log(`[XSenseAPI] Updated ${type} ${deviceSn}: ${temp}°C, ${hum}%`);

        this._emitUpdate('device', device);
      }
    }
  }
}
```

**Vorteile:**
- ✅ Real-time Updates via MQTT
- ✅ Vollständige Integration wie bei HA
- ✅ Historische Daten verfügbar
- ✅ Debug-Logging integriert

**Nachteile:**
- ⚠️ Mehr Code
- ⚠️ Braucht Testing

### Solution 3: Hybrid - BEIDE Methoden 🏆 **OPTIMAL**

**Aufwand:** 45-60 Minuten
**Impact:** Best of both worlds

**Use:**
- Device Status (b/c) für **sofortige** Werte bei Polling
- 2nd_tempdatalog für **Real-time** MQTT Updates

**Vorteile:**
- ✅ Funktioniert auch wenn MQTT disconnected
- ✅ Real-time wenn MQTT connected
- ✅ Historische Daten verfügbar
- ✅ Redundanz

---

## 📈 Comparison: Our Integration vs Home Assistant

| Feature | Home Assistant | Unsere Integration (jetzt) | Nach Fix |
|---------|---------------|---------------------------|----------|
| MQTT `2nd_tempdatalog` | ✅ Subscribed | ❌ Not subscribed | ✅ Fixed |
| Parse array format | ✅ Yes | ❌ No | ✅ Yes |
| Device status b/c | ✅ Parsed | ❌ Ignored | ✅ Parsed |
| Real-time updates | ✅ Via MQTT | ❌ Only polling | ✅ Via MQTT |
| Historical data | ✅ Available | ❌ Not used | ✅ Available |
| Update frequency | ~Real-time | 60s polling | ~Real-time |

---

## 🔧 Implementation Plan

### Phase 1: Quick Win (JETZT) ⚡

**Ziel:** STH51 Temperature/Humidity sofort funktionsfähig

1. Parse `status.b` und `status.c` in Device Update Handler
2. Test mit echtem STH51 Device
3. Commit & Deploy

**ETA:** 15 Minuten
**Impact:** STH51 funktioniert!

### Phase 2: Complete Fix (SPÄTER) 📡

**Ziel:** Real-time Updates wie bei Home Assistant

1. Add `2nd_tempdatalog` subscription
2. Implement `_handleTempDataLog()` function
3. Add debug logging
4. Test with STH51
5. Verify MQTT real-time updates

**ETA:** 45 Minuten
**Impact:** Professional-grade integration

### Phase 3: Other Sensors (OPTIONAL) 🌡️

**Ziel:** Alle Sensor-Typen vollständig

1. Prüfe STH54, STH0A Datenformate
2. Erweitere Parser für alle Varianten
3. Test mit allen verfügbaren Devices
4. Dokumentation

**ETA:** 1-2 Stunden
**Impact:** Vollständige Sensor-Unterstützung

---

## 📝 Code Locations

### Files to Modify:

1. **lib/XSenseAPI.js**
   - Line ~2000: `_subscribeStationTopics()` - Add subscription
   - Line ~2220: `_handleMQTTMessage()` - Add handler
   - Line ~2450: Add new function `_handleTempDataLog()`
   - Line ~850: `getAllDevices()` - Parse status.b/c

2. **drivers/temperature-sensor/device.js**
   - Verify capability updates work
   - Add debug logging

---

## 🎉 Success Metrics

**After Fix:**
- ✅ STH51 temperature updates in Homey
- ✅ STH51 humidity updates in Homey
- ✅ Updates every ~60s (polling) or real-time (MQTT)
- ✅ Values match X-Sense app
- ✅ Debug logs show data processing

---

## 🚀 Next Steps

**EMPFEHLUNG: Solution 1 (Quick Fix) JETZT, Solution 2 (Complete) SPÄTER**

1. **Sofort:** Implement Quick Fix (status.b/c parsing)
2. **Test:** Verify STH51 works in Homey
3. **Später:** Add MQTT real-time support
4. **Optional:** Extend to other sensor types

---

## 📎 Appendix: Raw Data Samples

### MQTT Message - 2nd_tempdatalog
```json
{
  "state": {
    "reported": {
      "stationSN": "14998680",
      "source": "3",
      "isEnd": "1",
      "data": [{
        "deviceSN": "00000003",
        "type": "STH51",
        "20260115": [
          "030500,18.4,51.2",
          "030600,18.4,51.2",
          "030700,18.4,51.2",
          "030800,18.4,51.2",
          "030900,18.4,51.2",
          "031000,18.4,51.2",
          "031100,18.4,48.8",
          "031200,18.4,48.8",
          "031300,18.4,48.8",
          "031400,18.4,48.8",
          "031500,18.4,48.8",
          "031600,18.5,48.8",
          "031700,18.5,48.8",
          "031800,18.5,48.8",
          "031900,18.5,48.8",
          "032000,18.5,48.8",
          "032100,18.5,48.8",
          "032200,18.5,48.8",
          "032300,18.5,48.8",
          "032400,18.5,48.8",
          "032500,18.5,48.8",
          "032600,18.5,48.8",
          "032700,18.5,48.8",
          "032800,18.6,48.8",
          "032900,18.6,48.8",
          "033000,18.6,48.8",
          "033100,18.6,48.8",
          "033200,18.5,48.8",
          "033300,18.6,48.8"
        ]
      }],
      "time": "20260115033324",
      "zoneName": ""
    }
  },
  "clientToken": "552605409"
}
```

### Device Status - From getAllDevices()
```json
{
  "deviceSN": "00000003",
  "type": "STH51",
  "batInfo": "3",
  "rfLevel": "3",
  "online": "1",
  "status": {
    "a": "0",
    "b": "18.6",       // TEMPERATURE
    "c": "48.8",       // HUMIDITY
    "d": "1",
    "e": [-20, 60],
    "f": [0, 100],
    "g": "1",
    "h": "0",
    "t": "20260115032804",
    "zoneName": ""
  }
}
```

---

**Report Generated:** 2026-01-15 04:34 CET
**Analysis Tool:** XSENSE_DEBUG=true + Manual Log Analysis
**Status:** ✅ ROOT CAUSE IDENTIFIED - READY FOR FIX
