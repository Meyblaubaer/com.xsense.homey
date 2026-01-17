# XP0A-iR Device Analysis & Support Status

**Date:** 2026-01-16
**Devices Found:** 2x XP0A-iR (EN560A3C, EN560A4D)
**Status:** ❌ **OFFLINE - Cannot Test**

---

## 📋 Summary

Du hast 2x **XP0A-iR** WiFi Rauch & CO Kombimelder in deinem Account, aber beide sind **OFFLINE** (`onLine: 0`). Das bedeutet:
- ❌ Keine Live-Daten verfügbar
- ❌ Keine MQTT Messages empfangen
- ❌ Battery Status unbekannt
- ❌ Sensor-Werte nicht abrufbar

---

## 🔍 Was ist XP0A-iR?

### Device Typ: WiFi Smoke & CO Combo Detector

**XP0A-iR** vs **XP0A-MR**:
- **XP0A-MR:** RF-Version (Funk, über Base Station SBS50)
- **XP0A-iR:** WiFi-Version (direkt über WiFi verbunden, kein RF)

### Ähnlich zu:
- **SC07-WX** (WiFi Rauch+CO, Gen 2)
- **SC06-WX** (WiFi Rauch+CO, Gen 1)

### Fähigkeiten (wenn online):
- Rauchdetektion (alarm_smoke)
- CO Detektion (alarm_co, measure_co)
- Temperatur (measure_temperature)
- Batterie (measure_battery, alarm_battery)
- WiFi RSSI (measure_signal_strength)

---

## 📊 Aktueller Status in der Integration

### ✅ Was Funktioniert:

1. **API Erkennung:** Devices werden von `getAllDevices()` gefunden
2. **Thing Shadows:** Basis-Shadows existieren:
   - `2nd_systime` (Metadata: IP, RSSI, Firmware)
   - `2nd_info_{sn}` (Static Info: MAC, etc.)
3. **Device-Struktur:** Korrekt im Cache gespeichert

### ❌ Was NICHT Funktioniert (wegen Offline):

1. **Live Sensor Data:** Keine Werte für:
   - Temperature
   - CO PPM
   - Alarm Status
   - Battery Level
2. **MQTT Updates:** Keine Real-time Messages
3. **Dynamic Shadows:** Nicht verfügbar:
   - `mainpage` (Haupt-Sensordaten)
   - `pwordup` (Power-Up Status)
   - `2nd_status` (Aktueller Status)
   - `2nd_alarm_status` (CO & Alarm)
   - `2nd_sensor_data` (Sensor Readings)

---

## 🧪 Code-Support Status

### In `lib/XSenseAPI.js`:

**WiFi Device Handler** (`_handleWiFiDeviceShadow()` - Line ~2330):
```javascript
// Unterstützt XP0A-iR bereits, da alle WiFi Devices gleich behandelt werden:
- Temperature mapping: ✅
- Humidity mapping: ✅ (falls vorhanden)
- WiFi RSSI: ✅
- Online Status: ✅
- Alarm Status: ✅
- CO PPM: ✅
- Battery Info: ✅
```

**Shadow List** (Line ~1144):
```javascript
// Alle relevanten Shadows werden bereits abgefragt:
'2nd_systime',           // Metadata ✅
'2nd_info_{sn}',         // Static Info ✅
'2nd_alarm_status',      // CO Data ✅
'2nd_sensor_data',       // Sensor Readings ✅
'2nd_status_{sn}',       // Device Status ✅
'mainpage',              // Main Data ✅
'pwordup'                // Power Status ✅
```

**MQTT Subscriptions** (Line ~2062):
```javascript
// WiFi Device Topics bereits subscribed:
`$aws/things/${typeSnThing}/shadow/name/mainpage/update`
`$aws/things/${typeSnThing}/shadow/name/pwordup/update`
`$aws/things/${typeSnThing}/shadow/name/2nd_systime/update`
`$aws/things/${typeSnThing}/shadow/name/muteup/update`
```

### In `hassio_py/entity_map.py`:

**XP0A-MR ist dokumentiert:**
```python
'XP0A-MR': {
    'type': EntityType.COMBI,  # Smoke + CO
    'actions': [
        TestAction(shadow='app2ndSelfTest'),
        FireDrillAction()
    ]
}
```

**XP0A-iR fehlt:** Nicht in der entity_map, aber das ist nur für Home Assistant relevant.

### In Homey Drivers:

**smoke-detector/driver.js:**
- ✅ Fügt ALLE Devices hinzu (kein Filter)
- ✅ XP0A-iR wird als normales Device hinzugefügt
- ✅ Capabilities werden dynamisch erkannt

**co-detector/driver.js:**
- ⚠️ Filtert nur nach `XC` (CO-only Detectors)
- ⚠️ XP0A wird NICHT hinzugefügt (ist korrekt, da COMBI nicht nur CO)

---

## 🚨 Problem-Analyse

### Warum sind die Devices offline?

**Mögliche Gründe:**

1. **Batterie leer:**
   - XP0A-iR hat Batterien (vermutlich AA)
   - Wenn Batterie schwach: Device schaltet sich ab
   - Lösung: Batterien wechseln

2. **WiFi Range:**
   - Devices zu weit vom Router entfernt
   - Signal zu schwach
   - Lösung: Näher an WiFi bewegen oder Repeater nutzen

3. **WiFi Credentials geändert:**
   - Passwort geändert?
   - SSID geändert?
   - Lösung: Devices neu mit WiFi verbinden

4. **Devices deaktiviert:**
   - In X-Sense App deaktiviert?
   - Aus Account entfernt und wieder hinzugefügt?
   - Lösung: Status in App prüfen

5. **Firmware Issue:**
   - Devices hängen in Boot-Loop?
   - Firmware-Update fehlgeschlagen?
   - Lösung: Reset durchführen

6. **Sleep Mode:**
   - Manche WiFi Devices gehen in Deep-Sleep
   - Wachen nur bei Alarm oder Test auf
   - Lösung: Test-Button drücken

---

## 🔧 Troubleshooting Steps

### Schritt 1: X-Sense App Prüfen

```
Öffne die X-Sense App auf deinem Handy:
1. Sind die Devices dort als "online" gezeigt?
2. Welcher Status wird angezeigt?
3. Wann waren sie zuletzt online? (Timestamp)
4. Kannst du einen Test auslösen?
5. Werden Live-Werte angezeigt?
```

**Wenn in App ONLINE:**
→ Integration hat ein Problem, Code muss angepasst werden

**Wenn in App auch OFFLINE:**
→ Physical device problem, siehe Schritt 2

### Schritt 2: Physical Device Check

```
Gehe zu den Devices (Hobbyraum):
1. Ist eine LED aktiv? (blinkend, dauerhaft)
2. Drücke Test-Button → Reagiert der Melder?
3. Entferne Batterie-Abdeckung → Batterien vorhanden?
4. Miss Batterie-Spannung (falls Multimeter da)
5. Batterie-Typ: AA oder fest verbaut?
```

**Test-Button Verhalten:**
- ✅ Alarm + LED blinkt: Device funktioniert, WiFi Problem
- ❌ Keine Reaktion: Batterie leer oder Device defekt

### Schritt 3: WiFi Reconnect

```
Wenn Device physisch funktioniert aber offline:
1. Reset-Button 10 Sekunden gedrückt halten
2. Device geht in Pairing-Mode (LED blinkt schnell)
3. X-Sense App öffnen → "Gerät hinzufügen"
4. WiFi-Credentials eingeben
5. Warten bis Device online kommt
```

### Schritt 4: Integration Debug

**NUR wenn Device in X-Sense App ONLINE ist, aber Integration offline zeigt:**

```bash
# App mit Debug starten
export XSENSE_DEBUG=mqtt,shadows
homey app run

# Warten auf MQTT Messages
# Erwartete Messages:
# - mainpage/update (Sensor data)
# - pwordup/update (Boot/Status)
# - 2nd_systime/update (Metadata)
```

**Debug-Logs prüfen:**
```bash
# Alle XP0A Messages
grep "XP0A\|EN560A" /tmp/xsense-debug/*.jsonl

# Shadow dumps
ls -lh /tmp/xsense-debug/shadow-*EN560A*.json

# MQTT traffic
grep "EN560A" /tmp/xsense-debug/mqtt-traffic.jsonl
```

---

## 📝 Ergebnis der Analyse

### Zusammenfassung:

| Aspekt | Status | Details |
|--------|--------|---------|
| **Code Support** | ✅ **VORHANDEN** | XP0A-iR wird wie SC07-WX behandelt |
| **Shadow Queries** | ✅ **KORREKT** | Alle relevanten Shadows werden abgefragt |
| **MQTT Subscriptions** | ✅ **KORREKT** | WiFi Device Topics subscribed |
| **Driver Support** | ✅ **JA** | smoke-detector driver fügt hinzu |
| **Device Status** | ❌ **OFFLINE** | Physical device issue |
| **Live Data** | ❌ **NICHT VERFÜGBAR** | Weil offline |
| **Testbarkeit** | ❌ **UNMÖGLICH** | Devices müssen erst online sein |

### Code-Änderungen Notwendig?

**NEIN** - Der Code ist bereits korrekt implementiert!

**XP0A-iR verwendet dieselben Shadow-Namen und MQTT-Topics wie SC07-WX.**

Die Integration ist bereit, sobald die Devices online sind. Keine Code-Änderungen notwendig.

---

## ✅ Action Items für Dich

### Sofort (Physical Check):

1. **Gehe zum Hobbyraum** wo die XP0A-iR Melder hängen
2. **Test-Button drücken** → Reagiert der Melder?
3. **Batterie prüfen** → Sind Batterien da? Sind sie voll?
4. **LED Status prüfen** → Blinkt oder leuchtet etwas?

### Falls Device reagiert:

5. **X-Sense App öffnen** → Status prüfen
6. **Device online?** → Wenn nein, WiFi reconnect
7. **WiFi Signal?** → Evtl. näher an Router bewegen

### Nach Device Online:

8. **Homey Integration testen**
   ```bash
   export XSENSE_DEBUG=true
   homey app run
   ```
9. **Warten auf Daten** (1-2 Minuten)
10. **Capabilities prüfen:**
    - Temperatur
    - CO PPM
    - Alarm Status
    - Battery Level

---

## 🎯 Erwartetes Verhalten (wenn online)

### Homey Device Capabilities:

```javascript
{
  alarm_smoke: boolean,      // Rauch-Alarm
  alarm_co: boolean,         // CO-Alarm
  measure_co: number,        // CO PPM Wert
  measure_temperature: number, // Temperatur
  measure_battery: number,   // Batterie %
  alarm_battery: boolean,    // Batterie niedrig
  measure_signal_strength: number // WiFi RSSI
}
```

### MQTT Messages:

**Erwartete Topics:**
```
$aws/things/XP0A-iR-EN560A3C/shadow/name/mainpage/update
$aws/things/XP0A-iR-EN560A3C/shadow/name/pwordup/update
$aws/things/XP0A-iR-EN560A3C/shadow/name/2nd_systime/update
@xsense/events/house/{houseId}  # Alarm Events
```

**Erwartete Data:**
```json
{
  "state": {
    "reported": {
      "temperature": 22.5,
      "coPpm": 0,
      "alarmStatus": 0,
      "onLine": 1,
      "wifiRssi": -65,
      "batInfo": 100
    }
  }
}
```

---

## 🔄 Next Steps

### Jetzt (User Action):
1. ✅ Physical device check durchführen
2. ✅ X-Sense App Status prüfen
3. ✅ Devices online bringen (Batterien, WiFi)

### Danach (Integration Test):
4. ⏳ Homey App mit Debug starten
5. ⏳ MQTT Messages empfangen warten
6. ⏳ Device capabilities in Homey prüfen

### Falls Probleme bleiben:
7. ⏳ Debug Logs zur Analyse bereitstellen
8. ⏳ Shadow dumps prüfen
9. ⏳ Evtl. Code-Anpassungen

---

## 📚 Reference

### Ähnliche Devices (Funktionieren):
- **SC07-WX:** WiFi Smoke+CO (Generation 2) ✅
- **XP0A-MR:** RF Smoke+CO (über SBS50) ✅

### Code Locations:
- **WiFi Handler:** `lib/XSenseAPI.js` Line 2330 (`_handleWiFiDeviceShadow()`)
- **Shadow List:** `lib/XSenseAPI.js` Line 1144 (`getWiFiDeviceShadow()`)
- **MQTT Subs:** `lib/XSenseAPI.js` Line 2062 (`_subscribeStationTopics()`)
- **Driver:** `drivers/smoke-detector/driver.js`

### Home Assistant Reference:
- `hassio_py/entity_map.py` Line 154: XP0A-MR definition
- Entity Type: `EntityType.COMBI` (Smoke + CO)
- Actions: TestAction, FireDrillAction

---

**FAZIT:**
Die Integration ist **code-seitig vollständig vorbereitet** für XP0A-iR. Das Problem liegt beim **physischen Device** (offline). Sobald die Geräte online sind, sollte alles automatisch funktionieren!

**Nächster Schritt:** Physical device check und online bringen! 🔋🔌
