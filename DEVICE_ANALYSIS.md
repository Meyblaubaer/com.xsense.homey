# Device Analysis - 5 Minute Debug Session

**Date:** 2026-01-15 04:28-04:33 CET

---

## 📊 Devices Found in System

### Active & Receiving Data ✅

#### 1. **XS0B-MR Rauchmelder** (Smoke Detectors)
- **Count:** 2 devices
- **Device SNs:** 00000002, (one more)
- **Status:** ✅ WORKING
- **Data Received:**
  - MQTT Real-time updates
  - Battery info (batInfo: 3)
  - RF Level (rfLevel: 3)
  - Alarm Status (alarmStatus: 0)
  - Online status
- **Update Frequency:** Real-time via MQTT
- **Last Update:** Within test period

**Example Data:**
```json
{
  "deviceSn": "00000002",
  "deviceName": "Rauchmelder 2",
  "deviceType": "XS0B-MR",
  "batInfo": "3",
  "rfLevel": "3",
  "online": "1",
  "alarmStatus": "0"
}
```

#### 2. **STH51 Temperature Sensor**
- **Count:** 1 device
- **Device SN:** 00000003
- **Status:** ⚠️ DATA AVAILABLE BUT NOT PARSED
- **Data Received:**
  - MQTT `2nd_tempdatalog` messages ✅
  - Device status with temp/humidity ✅
  - Historical data (hourly readings) ✅
- **Current Values:**
  - Temperature: 18.6°C
  - Humidity: 48.8%
  - Battery: batInfo "3"
  - RF Level: "3"
  - Online: "1"
- **Problem:** Shadow not subscribed, data format not parsed
- **MQTT Topic:** `2nd_tempdatalog/update`

**Example Data:**
```json
{
  "deviceSN": "00000003",
  "type": "STH51",
  "status": {
    "b": "18.6",  // Temperature
    "c": "48.8",  // Humidity
    "t": "20260115032804"
  }
}
```

#### 3. **SBS50 Base Station**
- **Count:** 1 device
- **Device SN:** 14998680
- **Status:** ✅ WORKING
- **Data Received:**
  - WiFi info (SSID, IP, MAC)
  - Firmware version: v1.6.9
  - Configuration (alarm volume, voice volume, etc.)
  - Safe Mode status
  - Last heartbeat
- **Manages:** Rauchmelder + STH51

**Example Data:**
```json
{
  "type": "SBS50",
  "deviceSN": "14998680",
  "sw": "v1.6.9",
  "ssid": "FRITZ!Box 6490 Cable",
  "ip": "192.168.179.127",
  "voiceVol": "75",
  "alarmVol": "75"
}
```

---

### Devices Present But OFFLINE/No Data ❌

#### 4. **XP0A-iR WiFi Smoke & CO Detector**
- **Count:** 2 devices
- **Device SNs:** EN560A3C, EN560A4D
- **Device Names:**
  - "CO und Brandmelder Hobbyraum"
  - (Second device name not in logs)
- **Status:** ❌ **OFFLINE**
  - `"onLine": 0`
  - `"onLineTime": 0`
- **Shadows Found:**
  - `2nd_systime` ✅
  - `2nd_info_{sn}` ✅
  - NO other shadows (mainpage, sensor_data, etc.)
- **MQTT Messages:** ❌ **NONE RECEIVED**
- **Problem:** Devices are offline, no data available

**Why Offline?**
- Batteries dead?
- Out of WiFi range?
- Devices deactivated?
- Need to be woken up?

**What Works:**
- Thing Shadows exist (basic info)
- API recognizes devices
- Structure is correct

**What Doesn't Work:**
- No real-time data
- No MQTT updates
- No current values
- Battery status unknown (because offline)

**Example Data:**
```json
{
  "stationId": "85DB4B55F0A611F0992A87157849281B",
  "stationSn": "EN560A4D",
  "stationName": "CO und Brandmelder Hobbyraum",
  "category": "XP0A-iR",
  "onLine": 0,      // ← OFFLINE!
  "onLineTime": 0,  // ← Never seen online
  "userId": "609deffc-d154-4..."
}
```

#### 5. **SC07-WX WiFi Smoke & CO Detector**
- **Count:** 0 devices found
- **Status:** ❌ **NOT PRESENT**
- **No mentions in logs**
- **Conclusion:** Du hast kein SC07-WX Device in deinem Account

---

## 🔍 Key Findings by Device Type

### Finding 1: XP0A-iR Devices Are OFFLINE

**Impact:** Battery Status & Data Updates Impossible

**Reason:** Devices report `onLine: 0`

**Evidence:**
- No MQTT messages received during 5-minute test
- Only static shadows available (2nd_systime, 2nd_info)
- No dynamic data (mainpage, status, sensor readings)

**Solution Options:**
1. **Check Physical Devices:**
   - Are they powered on?
   - Do they have batteries?
   - Are LEDs blinking?
   - WiFi in range?

2. **Wake Up Devices:**
   - Press test button
   - Trigger alarm test
   - Move closer to WiFi

3. **Check X-Sense App:**
   - Do they show as online there?
   - Last seen timestamp?
   - Can you control them?

**If Devices Are Actually Online (but app thinks offline):**
- Shadow name mismatch
- Different MQTT topics used
- Data in different format

### Finding 2: STH51 Data Available But Not Used

**Impact:** Temperature/Humidity not updating

**Reason:** Integration doesn't parse the data

**Evidence:**
- MQTT messages arriving: ✅
- Data format: Time-series array
- Alternative source: status.b/c fields

**Solution:** Implement parser (see STH51_DEBUG_FINDINGS.md)

### Finding 3: SC07-WX Not Present

**Impact:** Cannot test SC07-WX functionality

**Reason:** No SC07-WX devices in your account

**Evidence:**
- 0 mentions in logs
- Not in device list
- Not in API responses

**Note:** SC07-WX support WAS implemented (v1.1.0 added CO detection), but cannot be tested without actual device.

---

## 🎯 Device Support Status

| Device Type | Present | Online | Data Received | MQTT Updates | Battery Status | Needs Fix |
|-------------|---------|--------|---------------|--------------|----------------|-----------|
| **XS0B-MR** (Smoke) | ✅ Yes (2) | ✅ Online | ✅ Yes | ✅ Yes | ✅ Works | ❌ No |
| **STH51** (Temp) | ✅ Yes (1) | ✅ Online | ✅ Yes | ⚠️ Not parsed | ⚠️ Available | ✅ **Yes** |
| **SBS50** (Base) | ✅ Yes (1) | ✅ Online | ✅ Yes | ✅ Yes | N/A | ❌ No |
| **XP0A-iR** (WiFi) | ✅ Yes (2) | ❌ **OFFLINE** | ❌ No | ❌ No | ❌ Unknown | ⚠️ **Device Issue** |
| **SC07-WX** (WiFi) | ❌ **None** | N/A | N/A | N/A | N/A | N/A |

---

## 🔧 Recommendations by Device

### For STH51 (IMMEDIATE FIX AVAILABLE)

**Problem:** Data arrives but not parsed
**Fix:** Parse status.b/c fields OR subscribe 2nd_tempdatalog
**Priority:** 🔴 HIGH
**Impact:** User feature broken
**ETA:** 15-45 minutes

**See:** STH51_DEBUG_FINDINGS.md for detailed solution

### For XP0A-iR (PHYSICAL CHECK NEEDED)

**Problem:** Devices offline, no data
**Fix Required:**
1. Physical check of devices
2. Verify in X-Sense app
3. Check WiFi connectivity
4. Replace batteries if needed

**If devices ARE online but app thinks not:**
- Investigate shadow names
- Check MQTT topics
- Compare with Home Assistant (if you use it)

**Priority:** 🟡 MEDIUM
**Impact:** Cannot fix in code until devices online
**ETA:** Depends on device status

**Next Steps:**
1. Check X-Sense app: Are XP0A devices online there?
2. If YES: We need to debug shadow names/topics
3. If NO: Physical device issue

### For SC07-WX (NOT APPLICABLE)

**Problem:** No devices in account
**Status:** Cannot test, but code exists
**Priority:** 🟢 LOW
**Impact:** Feature works (based on code), just not testable

**v1.1.0 Added Support:**
- Extended shadow names
- CO detection parsing
- MQTT topic subscriptions
- Should work when device added

---

## 📝 Debug Log Statistics

**Total Lines:** 3,431
**Devices Mentioned:**
- XS0B-MR: Multiple mentions (working)
- STH51: 47 mentions (data available)
- XP0A-iR: 117 mentions (all about "offline" status)
- SBS50: Multiple mentions (working)
- SC07-WX: 0 mentions (not present)

**MQTT Topics Observed:**
- `$aws/things/SBS5014998680/shadow/name/2nd_tempdatalog/update` (STH51)
- `$aws/things/SBS5014998680/shadow/name/2nd_apptempdata/update` (STH51 request)
- Various device update topics for XS0B-MR

**MQTT Topics NOT Observed:**
- Any XP0A-iR topics (devices offline)
- Any SC07-WX topics (devices not present)

---

## 🎯 Conclusion

### Working Devices ✅
- **XS0B-MR Rauchmelder:** Fully functional
- **SBS50 Base Station:** Fully functional

### Fixable Issues 🔧
- **STH51:** Data available, needs parser implementation

### External Issues 🔌
- **XP0A-iR:** Devices physically offline, need troubleshooting
- **SC07-WX:** Not present in account, cannot test

---

## 🚀 Next Actions

### 1. Immediate (STH51 Fix)
Implement temperature/humidity parser
- Option A: Parse status.b/c (15 min)
- Option B: Parse 2nd_tempdatalog (45 min)

### 2. User Action Needed (XP0A-iR)
Check physical devices:
- Battery status?
- WiFi signal?
- X-Sense app shows online?
- Last seen timestamp?

### 3. Future (SC07-WX)
If you get SC07-WX device:
- Code already supports it (v1.1.0)
- Shadow names extended
- CO detection implemented
- Should work out-of-box

---

**Report Generated:** 2026-01-15 04:40 CET
**Based on:** 5-minute debug session with XSENSE_DEBUG=true
