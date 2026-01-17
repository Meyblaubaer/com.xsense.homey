# XP0A-iR Battery Status Analysis

**Date:** 2026-01-16
**Problem:** Battery-Anzeige funktioniert nicht für XP0A-iR Kombimelder
**Status:** Code-Analyse abgeschlossen ✅

---

## 🔍 Problem-Beschreibung

Du hast berichtet:
> "Problem bei den Kombi-Geräten war immer dass die Batterieanzeige nicht funktionierte."

**Betroffene Geräte:**
- 2x **XP0A-iR** WiFi Smoke & CO Detector
  - Device 1: EN560A3C ("CO und Brandmelder Hobbyraum")
  - Device 2: EN560A4D

---

## ✅ Was der Code BEREITS tut

### 1. Battery-Code ist implementiert

**Location:** `drivers/smoke-detector/device.js` Zeile 160-181

```javascript
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
```

**Logik:**
- Liest `deviceData.batInfo` (Wert 0-3)
- Konvertiert zu Prozent: `(batInfo / 3) * 100`
  - `batInfo = 3` → 100%
  - `batInfo = 2` → 67%
  - `batInfo = 1` → 33%
  - `batInfo = 0` → 0%
- Setzt `alarm_battery = true` wenn < 20%

### 2. XSenseAPI sammelt `batInfo`

**Location:** `lib/XSenseAPI.js`

**Von WiFi Device Shadows** (Zeile 1238-1240):
```javascript
// Battery Info
if (shadow.batInfo !== undefined || shadow.battery !== undefined) {
  aggregatedData.batInfo = shadow.batInfo || shadow.battery;
}
```

**Von MQTT Updates** (Zeile 2370):
```javascript
batInfo: reported.batInfo !== undefined ? reported.batInfo : existing.batInfo
```

**Von Event Messages** (Zeile 2506):
```javascript
batInfo: data.batInfo !== undefined ? DataSanitizer.toInt(data.batInfo) : existing.batInfo
```

### 3. WiFi Device Handler

**Location:** `lib/XSenseAPI.js` Zeile 2330-2376 (`_handleWiFiDeviceShadow()`)

XP0A-iR wird wie SC07-WX behandelt (WiFi Device), alle Felder werden gemappt.

---

## 🚨 Warum funktioniert es nicht?

### Mögliche Ursachen:

#### 1. **`batInfo` fehlt in den Shadows** ❌

**Wenn:** XP0A-iR sendet Battery-Status in anderem Feld

**Bekannte Shadow-Namen für WiFi Devices:**
```javascript
'2nd_systime',              // Metadata (IP, RSSI, FW)
'2nd_info_{sn}',            // Static Info (MAC, etc)
'2nd_alarm_status',         // CO & Alarm Data
'2nd_sensor_data',          // Sensor Readings
'2nd_status_{sn}',          // Device Status
'mainpage',                 // Main Data
'pwordup'                   // Power-Up Status
```

**Mögliche alternative Feldnamen:**
- `battery` (statt `batInfo`)
- `bat`
- `batteryLevel`
- `batteryStatus`
- `batLevel`
- `pwrLevel`

#### 2. **Devices sind OFFLINE** ❌

**Letzter Status:** Devices zeigten `onLine: 0` in früheren Tests

**Wenn offline:**
- Keine Shadow-Updates
- Keine MQTT Messages
- Keine Battery-Daten

**Lösung:** Devices müssen online sein

#### 3. **Battery-Wert in anderer Struktur** ⚠️

**Möglichkeit 1 - Nested:**
```json
{
  "status": {
    "bat": 3,
    "batInfo": 3
  }
}
```

**Möglichkeit 2 - Array:**
```json
{
  "batteries": [3, 3, 3]  // Mehrere Batterien?
}
```

**Möglichkeit 3 - Percentage:**
```json
{
  "batteryPercentage": 80  // Direkt als %
}
```

#### 4. **Capability fehlt** ❌

**Check:** Hat das Device die `measure_battery` Capability?

**Location:** `drivers/smoke-detector/driver.compose.json`

---

## 🔧 Lösungsansätze

### Ansatz 1: Debug-Log erweitern (RECOMMENDED)

**Füge temporären Debug-Code hinzu:**

**In:** `lib/XSenseAPI.js` Zeile ~1240 (nach Battery-Check)

```javascript
// Battery Info
if (shadow.batInfo !== undefined || shadow.battery !== undefined) {
  aggregatedData.batInfo = shadow.batInfo || shadow.battery;
}

// DEBUG: Log ALL fields that might contain battery info
if (station.category?.includes('XP0A') || thingName?.includes('XP0A')) {
  console.log(`[XSenseAPI] 🔋 XP0A Battery Debug for ${thingName}:`);
  console.log(`  Shadow Name: ${shadowName}`);
  console.log(`  batInfo: ${shadow.batInfo}`);
  console.log(`  battery: ${shadow.battery}`);
  console.log(`  All Keys:`, Object.keys(shadow));

  // Check for battery-related keys
  const batteryKeys = Object.keys(shadow).filter(k =>
    k.toLowerCase().includes('bat') ||
    k.toLowerCase().includes('power') ||
    k.toLowerCase().includes('pwr')
  );
  if (batteryKeys.length > 0) {
    console.log(`  🔍 Found battery-related keys:`, batteryKeys);
    batteryKeys.forEach(key => {
      console.log(`    ${key}: ${JSON.stringify(shadow[key])}`);
    });
  }
}
```

**In:** `drivers/smoke-detector/device.js` Zeile ~162 (vor Battery-Check)

```javascript
// Update battery level
// DEBUG: Log device data for XP0A
if (this.getSetting('deviceType')?.includes('XP0A')) {
  this.log('🔋 XP0A Battery Debug:', {
    batInfo: deviceData.batInfo,
    battery: deviceData.battery,
    allKeys: Object.keys(deviceData).filter(k =>
      k.toLowerCase().includes('bat') ||
      k.toLowerCase().includes('power')
    )
  });
}

// batInfo: "3" (full) or "1" (low) usually for X-Sense. Scale 0-3?
if (this.hasCapability('measure_battery') && deviceData.batInfo !== undefined) {
  // ... existing code ...
}
```

### Ansatz 2: Alternative Feldnamen hinzufügen

**In:** `lib/XSenseAPI.js` Zeile ~1238

```javascript
// Battery Info - Check multiple possible field names
if (shadow.batInfo !== undefined) {
  aggregatedData.batInfo = shadow.batInfo;
} else if (shadow.battery !== undefined) {
  aggregatedData.batInfo = shadow.battery;
} else if (shadow.bat !== undefined) {
  aggregatedData.batInfo = shadow.bat;
} else if (shadow.batteryLevel !== undefined) {
  // Convert from percentage to 0-3 scale
  aggregatedData.batInfo = Math.round((shadow.batteryLevel / 100) * 3);
} else if (shadow.batteryStatus !== undefined) {
  aggregatedData.batInfo = shadow.batteryStatus;
}
```

### Ansatz 3: Nested Status-Check

**In:** `lib/XSenseAPI.js` nach Zeile ~1240

```javascript
// Battery Info
if (shadow.batInfo !== undefined || shadow.battery !== undefined) {
  aggregatedData.batInfo = shadow.batInfo || shadow.battery;
}

// Check nested status object for XP0A
if (!aggregatedData.batInfo && shadow.status) {
  if (shadow.status.batInfo !== undefined) {
    aggregatedData.batInfo = shadow.status.batInfo;
  } else if (shadow.status.battery !== undefined) {
    aggregatedData.batInfo = shadow.status.battery;
  } else if (shadow.status.bat !== undefined) {
    aggregatedData.batInfo = shadow.status.bat;
  }
}
```

### Ansatz 4: WiFi-spezifische Battery-Felder

Manche WiFi-Devices nutzen andere Felder als RF-Devices:

**In:** `lib/XSenseAPI.js` Zeile ~2370 (`_handleWiFiDeviceShadow()`)

```javascript
const merged = {
  ...existing,
  ...reported,
  id: deviceId,
  deviceSn: deviceSn,

  // Map common fields
  temperature: reported.temperature !== undefined ? reported.temperature : existing.temperature,
  humidity: reported.humidity !== undefined ? reported.humidity : existing.humidity,
  wifiRssi: reported.wifiRSSI || reported.wifiRssi || existing.wifiRssi,
  onLine: reported.onLine !== undefined ? reported.onLine : existing.onLine,
  alarmStatus: reported.alarmStatus !== undefined ? reported.alarmStatus : existing.alarmStatus,
  coPpm: reported.coPpm !== undefined ? reported.coPpm : existing.coPpm,

  // ENHANCED: Battery mapping for WiFi devices
  batInfo: reported.batInfo !== undefined ? reported.batInfo :
           reported.battery !== undefined ? reported.battery :
           reported.bat !== undefined ? reported.bat :
           reported.batteryLevel !== undefined ? Math.round((reported.batteryLevel / 100) * 3) :
           existing.batInfo
};
```

---

## 📋 Testing-Anleitung (Wenn App läuft)

### 1. Aktiviere Debug-Logs

```bash
# In Homey App oder CLI
export XSENSE_DEBUG=true
homey app run
```

### 2. Suche nach Battery-Logs

**Console Output:**
```bash
grep -E "XP0A.*Battery|batInfo|battery" /tmp/homey-debug.log
```

**Debug Files:**
```bash
# Alle Shadows für XP0A
ls /tmp/xsense-debug/shadow-*XP0A*.json

# Shadow-Inhalte prüfen
cat /tmp/xsense-debug/shadow-*XP0A*.json | jq '.batInfo, .battery, .status'
```

### 3. X-Sense App Vergleich

**Wenn X-Sense App Battery zeigt:**
1. Öffne X-Sense App
2. Gehe zu XP0A-iR Device
3. Prüfe Battery-Anzeige:
   - Zeigt es % oder Balken?
   - Zeigt es "Full", "Medium", "Low"?
   - Gibt es "Battery OK" Status?

**Screenshot senden** → Dann kann ich sagen welches Feld wir suchen müssen!

---

## 🎯 Erwartetes Ergebnis

### Wenn `batInfo` korrekt empfangen wird:

**Homey Device:**
```
Capabilities:
  measure_battery: 100%        ← Zeigt 100% bei batInfo=3
  alarm_battery: false         ← Kein Alarm bei >20%
```

**Bei niedriger Batterie (batInfo=1):**
```
Capabilities:
  measure_battery: 33%         ← Zeigt 33% bei batInfo=1
  alarm_battery: true          ← Alarm bei <20%
```

### Wenn `batInfo` FEHLT:

**Homey Device:**
```
Capabilities:
  measure_battery: undefined   ← Keine Anzeige
  alarm_battery: undefined     ← Kein Status
```

**Console Log:**
```
🔋 XP0A Battery Debug: { batInfo: undefined, battery: undefined, allKeys: [] }
```

→ Dann müssen wir das korrekte Feld finden!

---

## 📊 Vergleich mit anderen Devices

### SC07-WX (funktioniert ✅):
```json
{
  "batInfo": "3",
  "temperature": 22.5,
  "coPpm": 0
}
```

### XS0B-MR RF Device (funktioniert ✅):
```json
{
  "status": {
    "b": "3",  // batInfo
    "i": "0"   // alarmStatus
  }
}
```

### STH51 Temp Sensor (funktioniert ✅):
```json
{
  "status": {
    "b": "18.6",  // temperature
    "c": "48.8"   // humidity
  }
}
```

### XP0A-iR (Status unbekannt ❓):
```json
{
  // Battery field location unknown
  // Need real device data to verify
}
```

---

## 🔄 Next Steps

### Sofort (Code-Erweiterung):

1. **Debug-Logs hinzufügen** (Ansatz 1) ✅
   - Zeigt alle verfügbaren Felder
   - Findet battery-related keys

2. **Alternative Feldnamen** (Ansatz 2) ✅
   - Prüft `battery`, `bat`, `batteryLevel`, etc.

3. **Nested Check** (Ansatz 3) ✅
   - Prüft `status.batInfo`, `status.battery`, etc.

### Danach (Testing):

4. **App mit Debug starten**
5. **XP0A-iR Logs prüfen**
6. **Korrektes Feld identifizieren**
7. **Code anpassen falls nötig**

### Alternativ (Wenn App nicht startet):

8. **X-Sense App Screenshots** 📸
   - Battery-Anzeige
   - Device-Details
   - Status-Screen

9. **Basierend darauf:** Code-Fix ohne Testing

---

## 📚 Reference

### Code Locations:

**Battery Parsing:**
- `drivers/smoke-detector/device.js` Line 160-181
- `drivers/co-detector/device.js` (ähnlich)
- `drivers/water-sensor/device.js` (ähnlich)

**Battery Data Collection:**
- `lib/XSenseAPI.js` Line 1238-1240 (WiFi Shadows)
- `lib/XSenseAPI.js` Line 2370 (MQTT WiFi Handler)
- `lib/XSenseAPI.js` Line 2506 (Event Handler)

**WiFi Device Handler:**
- `lib/XSenseAPI.js` Line 2330-2376 (`_handleWiFiDeviceShadow()`)

**Shadow Query:**
- `lib/XSenseAPI.js` Line 1133-1247 (`getWiFiDeviceShadow()`)

---

## 💡 Recommendation

**BESTE VORGEHENSWEISE:**

1. **Füge Debug-Logs hinzu** (alle 3 Ansätze kombinieren)
2. **Starte App einmal erfolgreich**
3. **Prüfe Console Output für XP0A**
4. **Identifiziere korrektes Battery-Feld**
5. **Erstelle finalen Fix**

**ODER:**

1. **Zeige mir X-Sense App Screenshots**
2. **Ich sage dir welches Feld es ist**
3. **Wir fügen direkten Fix hinzu**

---

**FAZIT:**

Der Code IST bereit für Battery-Status! Wir müssen nur herausfinden, in welchem Feld XP0A-iR die Battery-Daten sendet. Mit Debug-Logs oder X-Sense App Screenshots können wir das schnell lösen! 🔋
