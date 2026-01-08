# X-Sense Shadow & MQTT Topic Referenz

**Version:** 1.0
**Datum:** 7. Januar 2026
**Quelle:** X-Sense Home Security APK v1.33.0 (dekompiliert)

---

## Inhaltsverzeichnis

1. [AWS IoT Shadow Namen](#aws-iot-shadow-namen)
2. [Thing Name Konstruktion](#thing-name-konstruktion)
3. [DeviceShadowBean Properties](#deviceshadowbean-properties)
4. [StationShadowBean Properties](#stationshadowbean-properties)
5. [Spezielle Shadow Beans](#spezielle-shadow-beans)
6. [MQTT Topic Strukturen](#mqtt-topic-strukturen)
7. [Event Topics](#event-topics)
8. [Shadow Update Payloads](#shadow-update-payloads)

---

## AWS IoT Shadow Namen

### Standard Shadow Namen

| Shadow Name | Beschreibung | Verwendung | Beispiel Thing Name |
|-------------|--------------|------------|---------------------|
| `baseInfo` | Standard-Shadow (Default) | Basis-Gerätekonfiguration | `SC07-WX-14998680` |
| `2nd_systime` | Station-Status | Online-Status, WiFi RSSI, Firmware | `SBS5014998680` |
| `2nd_mainpage` | **Geräte-Aggregator** | Alle Device-Daten in `devs` Map | `SBS5014998680` |
| `mainpage` | Fallback für 2nd_mainpage | Legacy Alternative | `SBS5014998680` |
| `register` | Geräteregistrierung | Pairing-Prozess | `SBS5014998680` |
| `ota_update` | OTA Firmware Update | Update-Status | Alle Geräte |

### SBS50 Spezifische Shadow Namen (2nd Link)

| Shadow Name | Beschreibung | MQTT Topic |
|-------------|--------------|------------|
| `2nd_info_{deviceSN}` | Geräteinformation für spezifisches Device | `$aws/things/{stationSN}/shadow/name/2nd_info_{deviceSN}/update` |
| `2nd_mainpage` | **Hauptseite mit allen Devices** | `$aws/things/{stationSN}/shadow/name/2nd_mainpage/update` |
| `2nd_alarmtest_event` | Alarm Test Event | `$aws/things/{stationSN}/shadow/name/2nd_alarmtest_event/update` |
| `2nd_activateup` | Aktivierungsmeldung | `$aws/things/{stationSN}/shadow/name/2nd_activateup/update` |
| `2nd_drivewayup` | Auffahrts-Sensor Meldung | `$aws/things/{stationSN}/shadow/name/2nd_drivewayup/update` |
| `2nd_installtest` | Installationstest | `$aws/things/{stationSN}/shadow/name/2nd_installtest/update` |
| `2nd_installtestup` | Installationstest Meldung | `$aws/things/{stationSN}/shadow/name/2nd_installtestup/update` |
| `2nd_alarmtestup` | Alarm Test Meldung | `$aws/things/{stationSN}/shadow/name/2nd_alarmtestup/update` |
| `2nd_listenerup` | Listener Meldung | `$aws/things/{stationSN}/shadow/name/2nd_listenerup/update` |
| `2nd_listener_testup` | Listener Test Meldung | `$aws/things/{stationSN}/shadow/name/2nd_listener_testup/update` |
| `2nd_muteup` | Stummschaltung Meldung | `$aws/things/{stationSN}/shadow/name/2nd_muteup/update` |
| `2nd_mutekeyup` | Stummschalt-Taste Meldung | `$aws/things/{stationSN}/shadow/name/2nd_mutekeyup/update` |
| `2nd_extendmuteup` | Erweiterte Stummschaltung | `$aws/things/{stationSN}/shadow/name/2nd_extendmuteup/update` |
| `2nd_waterup` | Wasser-Sensor Meldung | `$aws/things/{stationSN}/shadow/name/2nd_waterup/update` |
| `2nd_selftestup` | Selbsttest Meldung | `$aws/things/{stationSN}/shadow/name/2nd_selftestup/update` |
| `2nd_signalres_{deviceSN}` | Signalstärke-Result | `$aws/things/{stationSN}/shadow/name/2nd_signalres_{deviceSN}/update` |
| `2nd_trigger_up` | Auslöser-Meldung | `$aws/things/{stationSN}/shadow/name/2nd_trigger_up/update` |
| `2nd_linkalarm` | Link-Alarm | `$aws/things/{stationSN}/shadow/name/2nd_linkalarm/update` |
| `2nd_coreset_up` | CO-Sensor Rückstellung | `$aws/things/{stationSN}/shadow/name/2nd_coreset_up/update` |

### WiFi Device Shadow Namen

| Shadow Name | Beschreibung | Verwendung |
|-------------|--------------|------------|
| `mode_{deviceSN}` | Mode-Details für Device | SC07-WX, XC01-WX Mode-Einstellungen |
| `info_{deviceSN}` | Geräte-spezifische Info | Detaillierte Device-Konfiguration |
| `prealarm` | Voralarm-Einstellungen | CO-Sensoren |
| `safealarm` | Sicherheitsalarm | Sicherheitssystem-Integration |
| `safemode` | Sicherer Modus | Alarm-System Mode |
| `mutekey` | Stummschalt-Taste | Hardware-Taste Status |
| `selftestup` | Selbsttest Ergebnis | Test-Report |
| `testirreport` | IR-Test Report | Motion-Sensor Test |
| `testirconfirm` | IR-Test Bestätigung | Motion-Sensor Test Bestätigung |

---

## Thing Name Konstruktion

### Regel-basierte Konstruktion

```javascript
function buildThingName(device) {
  const type = device.category || device.type;
  const sn = device.stationSn || device.deviceSn;

  // Spezielle Behandlung nach Gerätetyp
  switch(type) {
    case 'SBS10':
      return sn;  // Nur Seriennummer

    case 'SC07-WX':
    case 'XC01-WX':
    case 'XH02-WX':
    case 'XS01-WX':
      return `${type}-${sn}`;  // Type-Seriennummer (mit Bindestrich)

    case 'SBS50':
    case 'STH51':
    case 'STH0A':
    default:
      return `${type}${sn}`;  // TypeSeriennummer (ohne Separator)
  }
}
```

### Beispiele

| Gerätetyp | Seriennummer | Thing Name | Shadow Namen |
|-----------|--------------|------------|--------------|
| **SBS50** | 14998680 | `SBS5014998680` | `2nd_mainpage`, `2nd_systime`, `baseInfo` |
| **SBS10** | 12345678 | `12345678` | `baseInfo` |
| **SC07-WX** | 14998680 | `SC07-WX-14998680` | `2nd_systime`, `baseInfo` |
| **XC01-WX** | 87654321 | `XC01-WX-87654321` | `2nd_systime`, `baseInfo` |
| **STH51** | 11223344 | `STH5111223344` | Über `2nd_mainpage` der SBS50 |
| **STH0A** | 99887766 | `STH0A99887766` | Über `2nd_mainpage` der SBS50 |

---

## DeviceShadowBean Properties

**Datei:** `com/claybox/iot/bean/shadow/DeviceShadowBean.java`
**Anzahl Properties:** 41
**Datenbank:** GreenDAO Entity (ID = Primary Key)

### Alle Properties

| Property | Typ | Beschreibung | MQTT Path | Beispielwert |
|----------|-----|--------------|-----------|--------------|
| `ID` | Long | Datenbank-ID (Primary Key) | - | `1` |
| `_deviceSN` | String | Geräte-Seriennummer | `state.reported.deviceSN` | `"12345678"` |
| `stationSN` | String | Basisstation-Seriennummer | `state.reported.stationSN` | `"14998680"` |
| `type` | String | Gerätetyp | `state.reported.type` | `"STH51"`, `"SC07-WX"` |
| `userId` | String | Benutzer-ID | `state.reported.userId` | `"user123"` |
| **Temperatur & Luftfeuchte** | | | | |
| `tempUnit` | String | Temperatureinheit | `state.reported.tempUnit` | `"℃"`, `"℉"` |
| `tRange` | String | Temperaturbereich | `state.reported.tRange` | `"-10,50"` |
| `tAdjust` | String | Temperatur-Kalibrierung | `state.reported.tAdjust` | `"0.5"` |
| `tComfort` | String | Komfort-Temperatur | `state.reported.tComfort` | `"22"` |
| `hRange` | String | Luftfeuchtebereich | `state.reported.hRange` | `"30,70"` |
| `hAdjust` | String | Luftfeuchte-Kalibrierung | `state.reported.hAdjust` | `"0"` |
| `hComfort` | String | Komfort-Luftfeuchte | `state.reported.hComfort` | `"50"` |
| `comfortType` | String | Komfort-Typ | `state.reported.comfortType` | `"0"`, `"1"` |
| **CO-Sensor** | | | | |
| `coPpm` | String | Aktuelle CO-Konzentration (ppm) | `state.reported.coPpm` | `"0"`, `"50"` |
| `coLevel` | String | CO-Level | `state.reported.coLevel` | `"0"` (kein Alarm) - `"5"` (hoch) |
| `coPpmPeak` | String | Maximale CO-Konzentration | `state.reported.coPpmPeak` | `"120"` |
| **Alarm & Audio** | | | | |
| `alarmEnable` | String | Alarm aktiviert | `state.reported.alarmEnable` | `"0"` (aus), `"1"` (an) |
| `alarmVol` | String | Alarm-Lautstärke | `state.reported.alarmVol` | `"0"` - `"100"` |
| `alarmTone` | String | Alarm-Ton | `state.reported.alarmTone` | `"1"`, `"2"`, `"3"` |
| `alarmInterval` | String | Alarm-Intervall | `state.reported.alarmInterval` | `"60"` (Sekunden) |
| `continueAlarm` | String | Fortlaufender Alarm | `state.reported.continueAlarm` | `"0"`, `"1"` |
| `chirpTone` | String | Piep-Ton | `state.reported.chirpTone` | `"1"`, `"2"` |
| `chirpToneEnable` | String | Piep-Ton aktiviert | `state.reported.chirpToneEnable` | `"0"`, `"1"` |
| `chirpVol` | String | Piep-Lautstärke | `state.reported.chirpVol` | `"0"` - `"100"` |
| `remindTone` | String | Erinnerungs-Ton | `state.reported.remindTone` | `"1"` |
| `remindToneEnable` | String | Erinnerungs-Ton aktiviert | `state.reported.remindToneEnable` | `"0"`, `"1"` |
| `remindVol` | String | Erinnerungs-Lautstärke | `state.reported.remindVol` | `"50"` |
| `remindOn` | String | Erinnerung aktiviert | `state.reported.remindOn` | `"0"`, `"1"` |
| `remindTime` | String | Erinnerungs-Zeit | `state.reported.remindTime` | `"08:00"` |
| **Sensor-Einstellungen** | | | | |
| `detcSens` | String | Erkennungs-Empfindlichkeit | `state.reported.detcSens` | `"0"` (niedrig) - `"2"` (hoch) |
| `sensitivity` | String | Allgemeine Sensibilität | `state.reported.sensitivity` | `"1"`, `"2"`, `"3"` |
| `checkType` | String | Prüfungstyp | `state.reported.checkType` | `"0"`, `"1"` |
| **UI & Optik** | | | | |
| `ledLight` | String | LED-Licht | `state.reported.ledLight` | `"0"` (aus), `"1"` (an) |
| **Firmware** | | | | |
| `sw` | String | Software-Version | `state.reported.sw` | `"v1.6.3"` |
| `swMain` | String | Haupt-Software-Version | `state.reported.swMain` | `"v1.6"` |
| **Sonstiges** | | | | |
| `mute` | String | Stummschaltung | `state.reported.mute` | `"0"`, `"1"` |
| `mailNotice` | String | E-Mail-Benachrichtigung | `state.reported.mailNotice` | `"0"`, `"1"` |
| `deviceMAC` | String | MAC-Adresse | `state.reported.deviceMAC` | `"AA:BB:CC:DD:EE:FF"` |
| `time` | String | Zeitstempel | `state.reported.time` | `"2026-01-07T06:30:00Z"` |
| `smokeEdition` | String | Rauchmelder-Edition | `state.reported.smokeEdition` | `"EU"`, `"US"` |
| `warnIsOpen` | String | Warnung aktiviert | `state.reported.warnIsOpen` | `"0"`, `"1"` |
| `warnPeriod` | String | Warn-Periode | `state.reported.warnPeriod` | `"7"` (Tage) |
| **Verschachtelte Objekte** | | | | |
| `lightShadowBean` | LightShadowBean | Licht-Sensor Daten | `state.reported.lightShadow` | (siehe LightShadowBean) |
| `skp0aShadowBean` | Skp0aShadowBean | Keypad Daten | `state.reported.skp0aShadow` | (siehe Skp0aShadowBean) |

---

## StationShadowBean Properties

**Datei:** `com/claybox/iot/bean/shadow/StationShadowBean.java`
**Anzahl Properties:** 22
**Verwendung:** Basisstation-Konfiguration (SBS50, SBS10)

### Alle Properties

| Property | Typ | Beschreibung | MQTT Path | Beispielwert |
|----------|-----|--------------|-----------|--------------|
| `ID` | Long | Datenbank-ID | - | `1` |
| `stationSn` | String | Basisstation-Seriennummer | `state.reported.stationSN` | `"14998680"` |
| `type` | String | Stationstyp | `state.reported.type` | `"SBS50"`, `"SBS10"` |
| `userId` | String | Benutzer-ID | `state.reported.userId` | `"user123"` |
| **Netzwerk** | | | | |
| `ip` | String | IP-Adresse | `state.reported.ip` | `"192.168.1.100"` |
| `mac` | String | MAC-Adresse | `state.reported.mac` | `"C0:5D:89:80:E9:A0"` |
| `macBT` | String | Bluetooth MAC | `state.reported.macBT` | `"C0:5D:89:80:E9:A2"` |
| `ssid` | String | WiFi SSID | `state.reported.ssid` | `"MyNetwork"` |
| **Audio** | | | | |
| `alarmVol` | String | Alarm-Lautstärke | `state.reported.alarmVol` | `"0"` - `"100"` |
| `alarmTone` | String | Alarm-Ton | `state.reported.alarmTone` | `"1"`, `"2"`, `"3"` |
| `voiceVol` | String | Stimmen-Lautstärke | `state.reported.voiceVol` | `"0"` - `"100"` |
| **LED** | | | | |
| `ledBrt` | String | LED-Helligkeit | `state.reported.ledBrt` | `"0"` - `"10"` |
| `ledLight` | String | LED-Licht | `state.reported.ledLight` | `"0"`, `"1"` |
| **Sprache** | | | | |
| `languageCount` | String | Anzahl Sprachen | `state.reported.languageCount` | `"5"` |
| `languageIndex` | String | Aktuelle Sprache (Index) | `state.reported.languageIndex` | `"0"` (EN), `"1"` (DE), etc. |
| **Firmware** | | | | |
| `sw` | String | Software-Version | `state.reported.sw` | `"v1.6.3"` |
| `swMain` | String | Haupt-Software | `state.reported.swMain` | `"v1.6"` |
| **Warnungen** | | | | |
| `warnIsOpen` | String | Warnung aktiviert | `state.reported.warnIsOpen` | `"0"`, `"1"` |
| `warnPeriod` | String | Warn-Periode | `state.reported.warnPeriod` | `"7"` (Tage) |
| **Sonstiges** | | | | |
| `location` | String | Standort | `state.reported.location` | `"Wohnzimmer"` |

---

## Spezielle Shadow Beans

### LightShadowBean (Licht-Sensor)

**Datei:** `com/claybox/iot/bean/shadow/LightShadowBean.java`
**Properties:** 20

| Property | Typ | Beschreibung | Beispielwert |
|----------|-----|--------------|--------------|
| `stationSN` | String | Basisstation | `"14998680"` |
| `deviceSN` | String | Device-SN | `"12345678"` |
| `type` | String | Typ | `"LIGHT"` |
| `alarmVol` | String | Lautstärke | `"50"` |
| `alarmTone` | String | Ton | `"1"` |
| `alarmEnable` | String | Aktiviert | `"1"` |
| `lightScene` | String | Licht-Szene | `"1"`, `"2"`, `"3"` |
| `pirSensitivity` | String | PIR-Empfindlichkeit | `"0"` - `"2"` |
| `pirInterval` | String | PIR-Intervall | `"60"` (Sekunden) |
| `pirEnable` | String | PIR aktiviert | `"0"`, `"1"` |
| `sunshineEnable` | String | Sonnenlicht-Sensor | `"0"`, `"1"` |
| `awaitEnable` | String | Warte-Modus | `"0"`, `"1"` |
| `triggerBrightness` | String | Auslöse-Helligkeit | `"0"` - `"100"` |
| `awaitBrightness` | String | Warte-Helligkeit | `"0"` - `"100"` |
| `pirTime` | String | PIR-Zeit | `"120"` (Sekunden) |
| `appTime` | String | App-Zeit | Zeitstempel |
| `onEvent` | String | Bei Event | `"0"`, `"1"` |
| `sw` | String | Software-Version | `"v1.0.0"` |

### Skp0aShadowBean (Keypad)

**Datei:** `com/claybox/iot/bean/shadow/Skp0aShadowBean.java`
**Properties:** 11

| Property | Typ | Beschreibung | Beispielwert |
|----------|-----|--------------|--------------|
| `type` | String | Typ | `"SKP0A"` |
| `stationSN` | String | Basisstation | `"14998680"` |
| `deviceSN` | String | Device-SN | `"87654321"` |
| `sw` | String | Software-Version | `"v1.0.0"` |
| `keySound` | String | Tasten-Sound | `"0"`, `"1"` |
| `alarmSound` | String | Alarm-Sound | `"0"`, `"1"` |
| `scheduleTip` | String | Zeitplan-Tip | `"0"`, `"1"` |
| `appTip` | String | App-Tip | `"0"`, `"1"` |

### SmokeMainPageShadowBean (Rauchmelder Hauptseite)

**Datei:** `com/claybox/iot/bean/shadow/SmokeMainPageShadowBean.java`
**Properties:** 32
**MQTT Path:** `$aws/things/{stationSN}/shadow/name/2nd_mainpage/update`

| Property | Typ | Beschreibung | Beispielwert |
|----------|-----|--------------|--------------|
| `stationSN` | String | Basisstation | `"14998680"` |
| `deviceSN` | String | Device-SN | `"12345678"` |
| `type` | String | Gerätetyp | `"SC07-WX"`, `"XC01-WX"` |
| **Alarm-Status** | | | |
| `alarmStatus` | int | Alarm-Status | `0` (kein), `1` (Rauch), `2` (CO), etc. |
| `alarmOccur` | int | Alarm aufgetreten | `0`, `1` |
| `muteStatus` | int | Stummschaltung | `0`, `1` |
| `isLifeEnd` | boolean | Lebensdauer-Ende | `false`, `true` |
| **Temperatur & Luftfeuchte** | | | |
| `tempRangeMin` | float | Min. Temperatur | `-10.0` |
| `tempRangeMax` | float | Max. Temperatur | `50.0` |
| `humRangeMin` | float | Min. Luftfeuchte | `30.0` |
| `humRangeMax` | float | Max. Luftfeuchte | `70.0` |
| `tempAlarmStatus` | int | Temp-Alarm | `0`, `1` |
| `tempMuteStatus` | int | Temp stumm | `0`, `1` |
| `tempMuteTime` | int | Temp stumm Zeit | Sekunden |
| **Wasser** | | | |
| `waterAlarmStatus` | int | Wasser-Alarm | `0`, `1` |
| `waterMuteStatus` | int | Wasser stumm | `0`, `1` |
| `waterMuteTime` | int | Wasser stumm Zeit | Sekunden |
| **CO-Sensor** | | | |
| `coPpm` | int | CO ppm | `0` - `999` |
| `coLevel` | int | CO Level | `0` - `5` |
| `coPpmPeak` | int | CO Peak | Max. Wert |
| `coPpmPeakTime` | String | Peak-Zeit | Zeitstempel |
| `coEventId` | int | CO Event ID | Event-Nummer |
| `warnLongCoPpm` | int | Langzeit-Warn CO | ppm-Wert |
| `warnShortCoPpm` | int | Kurzzeit-Warn CO | ppm-Wert |
| `warnLong` | int | Langzeit-Warnung | `0`, `1` |
| `warnShort` | int | Kurzzeit-Warnung | `0`, `1` |
| **Sonstiges** | | | |
| `batInfo` | int | Batterie-Info | `0` - `3` (Spannung) |
| `acBreak` | int | AC-Unterbrechung | `0`, `1` |
| `onlineTime` | String | Online-Zeit | Zeitstempel |
| `time` | String | Zeit | Zeitstempel |
| `utcTime` | String | UTC-Zeit | Zeitstempel |
| `wifiRssi` | String | WiFi RSSI | `"-66"` (dBm) |
| `wifiRssiLevel` | int | WiFi Level | `0` - `5` |
| `smokeEdition` | String | Rauchmelder-Edition | `"EU"`, `"US"` |
| `standard` | int | Standard | `0`, `1` |

### CoPeakShadowBean (CO Peak Tracking)

**Datei:** `com/claybox/iot/bean/shadow/CoPeakShadowBean.java`
**Properties:** 8

| Property | Typ | Beschreibung |
|----------|-----|--------------|
| `stationSn` | String | Basisstation-SN |
| `deviceSN` | String | Device-SN |
| `type` | String | Typ |
| `time` | String | Zeitstempel |
| `coPpmPeak` | int | Peak ppm |
| `coLevel` | int | CO Level |
| `coPpm` | int | Aktueller ppm |

---

## MQTT Topic Strukturen

### AWS IoT Thing Shadow Topics

#### Standard-Format
```
$aws/things/{thingName}/shadow/name/{shadowName}/update
```

#### Topic-Komponenten

| Komponente | Beschreibung | Beispiel |
|------------|--------------|----------|
| `{thingName}` | Thing Name (siehe Konstruktion oben) | `SBS5014998680`, `SC07-WX-14998680` |
| `{shadowName}` | Shadow Name | `2nd_mainpage`, `2nd_systime`, `baseInfo` |

#### Standard Shadow Topics

```
# Default Shadow (unnamed)
$aws/things/{thingName}/shadow/update
$aws/things/{thingName}/shadow/update/accepted
$aws/things/{thingName}/shadow/update/rejected
$aws/things/{thingName}/shadow/update/delta
$aws/things/{thingName}/shadow/get
$aws/things/{thingName}/shadow/get/accepted
$aws/things/{thingName}/shadow/get/rejected

# Named Shadow
$aws/things/{thingName}/shadow/name/{shadowName}/update
$aws/things/{thingName}/shadow/name/{shadowName}/update/accepted
$aws/things/{thingName}/shadow/name/{shadowName}/update/rejected
$aws/things/{thingName}/shadow/name/{shadowName}/update/delta
$aws/things/{thingName}/shadow/name/{shadowName}/get
$aws/things/{thingName}/shadow/name/{shadowName}/get/accepted
$aws/things/{thingName}/shadow/name/{shadowName}/get/rejected
```

### User-based Shadow Topics

**Alternative Struktur:**
```
$aws/things/{userId}/shadow/name/{stationId}/update
$aws/things/{userId}/shadow/name/{houseId}/update
$aws/things/{userId}/shadow/update  (Default Shadow)
```

### Wildcard-Subscriptions (Empfohlen für Discovery)

```bash
# Alle Named Shadows für ein Thing
$aws/things/{thingName}/shadow/name/+/update

# Alle Shadows für alle Things (nicht empfohlen - zu breit)
$aws/things/+/shadow/name/+/update

# User-basiert
$aws/things/{userId}/shadow/name/+/update
```

---

## Event Topics

### X-Sense Event Topics (nicht AWS IoT Shadow)

| Topic Pattern | Beschreibung | Payload |
|---------------|--------------|---------|
| `@xsense/events/house/{houseId}` | Haus-Ereignisse | HouseEvent |
| `@xsense/events/safealarm/{houseId}` | Sicherheitsalarm | SafeAlarmEvent |
| `@xsense/events/shareadd/{houseId}` | Freigabe hinzugefügt | ShareAddEvent |
| `@xsense/events/shareupt/{houseId}` | Freigabe aktualisiert | ShareUpdateEvent |
| `@xsense/events/lampgroup/{houseId}` | Lichtgruppe | LampGroupEvent |
| `@xsense/events/lampsched/{houseId}` | Lichtplan | LampScheduleEvent |
| `@xsense/events/securityplan/{houseId}` | Sicherheitsplan | SecurityPlanEvent |
| `@xsense/events/tempcleanlog/{stationSN}` | Temperatur-Log gelöscht | TempLogClearEvent |
| `@xsense/events/master/{stationSN}` | Master-Registrierung | MasterRegisterEvent |
| `@xsense/events/common/{ipcId}` | IPC Common Event | IPCCommonEvent |
| `@claybox/events/apptoken/{userId}` | App-Token Event | AppTokenEvent |
| `@claybox/events/sospush/{stationSN}` | SOS-Push | SOSPushEvent |
| `@claybox/events/keyboard/{stationSN}` | Tastatur-Event | KeyboardEvent |

### AWS Event Topics

```
$aws/events/presence/connected/{thingName}      - Thing verbunden
$aws/events/presence/disconnected/{thingName}   - Thing getrennt
```

---

## Shadow Update Payloads

### 2nd_mainpage Shadow (Wichtigster Shadow für Geräte-Updates)

**Topic:**
```
$aws/things/SBS5014998680/shadow/name/2nd_mainpage/update
```

**Payload-Struktur:**
```json
{
  "state": {
    "reported": {
      "stationSN": "14998680",
      "type": "SBS50",
      "devs": {
        "12345678": {
          "temperature": 22.5,
          "humidity": 45.0,
          "tempUnit": "℃",
          "status": 1,
          "battStatus": 3,
          "alarmStatus": 0,
          "onLine": 1,
          "deviceSN": "12345678",
          "type": "STH51"
        },
        "87654321": {
          "temperature": 21.0,
          "humidity": 50.5,
          "tempUnit": "℃",
          "status": 1,
          "battStatus": 2,
          "alarmStatus": 0,
          "onLine": 1,
          "deviceSN": "87654321",
          "type": "STH0A",
          "dewPoint": 10.5,
          "vpd": 1.2
        }
      }
    }
  },
  "metadata": {
    "reported": {
      "stationSN": {
        "timestamp": 1704612000
      },
      "devs": {
        "12345678": {
          "temperature": {
            "timestamp": 1704612000
          }
        }
      }
    }
  },
  "version": 123,
  "timestamp": 1704612000
}
```

**Wichtig:** Die `devs` Map enthält alle Geräte-Daten indexiert nach `deviceSN`!

### 2nd_systime Shadow (Station Status)

**Topic:**
```
$aws/things/SC07-WX-14998680/shadow/name/2nd_systime/update
```

**Payload:**
```json
{
  "state": {
    "reported": {
      "type": "SC07-WX",
      "stationSN": "14998680",
      "onLine": 1,
      "wifiRSSI": "-45",
      "sw": "v1.6.3",
      "ip": "192.168.1.100",
      "mac": "C0:5D:89:80:E9:A0",
      "ssid": "MyNetwork"
    }
  },
  "version": 45,
  "timestamp": 1704612000
}
```

### AlarmTopicResult Payload

**Topic:**
```
@xsense/events/house/{houseId}
```

**Payload:**
```json
{
  "type": "SC07-WX",
  "stationSN": "14998680",
  "deviceSN": "14998680",
  "nickName": "Wohnzimmer Rauchmelder",
  "isAlarm": true,
  "alarmStatus": 1,
  "alarmSource": "smoke",
  "temperature": 22.5,
  "humidity": 45.0,
  "tempUnit": "℃",
  "tempRangeMin": -10,
  "tempRangeMax": 50,
  "humRangeMin": 30,
  "humRangeMax": 70,
  "coPpm": 0,
  "coLevel": 0,
  "time": "2026-01-07T06:30:00Z",
  "event": "alarm_triggered",
  "dismantle": 0,
  "entryDelay": 0,
  "silenceTime": 0,
  "continueAlarm": 0,
  "reAlarm": 0
}
```

### STH51LogTopicResult Payload

**Topic:**
```
(Custom Topic - zu ermitteln)
```

**Payload:**
```json
{
  "stationSN": "14998680",
  "source": "device",
  "isEnd": false,
  "time": "2026-01-07T06:30:00Z",
  "deviceSnList": ["12345678", "87654321"],
  "data": [
    {
      "deviceSN": "12345678",
      "type": "temp_hum",
      "temp": 22.5,
      "hum": 45.0
    },
    {
      "deviceSN": "87654321",
      "type": "temp_hum",
      "temp": 21.0,
      "hum": 50.5
    }
  ]
}
```

---

## Verwendungsbeispiele

### 1. Alle Geräte einer SBS50 Station abrufen

```javascript
// Topic abonnieren
client.subscribe('$aws/things/SBS5014998680/shadow/name/2nd_mainpage/update');

// Shadow abrufen (HTTPS GET)
const shadow = await getThingShadow('SBS5014998680', '2nd_mainpage', 'eu-central-1');

// Geräte verarbeiten
const devices = shadow.state.reported.devs;
for (const [deviceSN, deviceData] of Object.entries(devices)) {
  console.log(`Device ${deviceSN}:`, deviceData.temperature, deviceData.humidity);
}
```

### 2. SC07-WX Status abrufen

```javascript
// Thing Name konstruieren
const thingName = 'SC07-WX-14998680';

// Shadow abrufen
const shadow = await getThingShadow(thingName, '2nd_systime', 'eu-central-1');

console.log('Online:', shadow.state.reported.onLine);
console.log('WiFi RSSI:', shadow.state.reported.wifiRSSI);
console.log('Firmware:', shadow.state.reported.sw);
```

### 3. MQTT Subscription für Echtzeit-Updates

```javascript
const topics = [
  // Haus-Events
  '@xsense/events/+/12345',  // houseId = 12345

  // Station Shadows
  '$aws/things/SBS5014998680/shadow/name/2nd_mainpage/update',
  '$aws/things/SBS5014998680/shadow/name/2nd_systime/update',

  // WiFi Device
  '$aws/things/SC07-WX-14998680/shadow/name/2nd_systime/update',

  // Wildcard für Discovery
  '$aws/things/SBS5014998680/shadow/name/+/update'
];

topics.forEach(topic => {
  client.subscribe(topic, { qos: 0 });
});

client.on('message', (topic, payload) => {
  const data = JSON.parse(payload.toString());
  console.log(`Update on ${topic}:`, data);
});
```

---

## Anhang: Property-Datentypen Übersicht

| Datentyp | Verwendung | Beispiele |
|----------|------------|-----------|
| `String` | Überwiegend | IDs, Versionen, Konfiguration, Messwerte als String |
| `Long` | Datenbank-IDs | Primary Keys |
| `int` | Ganzzahlige Werte | Alarm-Status, Zähler, Levels |
| `float` | Dezimalwerte | Temperatur-/Luftfeuchte-Bereiche |
| `boolean` | Binäre Flags | isLifeEnd, timeZoneEnabled |
| `List<T>` | Arrays | deviceSnList, notices |
| Custom | Verschachtelte Objekte | LightShadowBean, Skp0aShadowBean |

---

## Wichtige Hinweise

1. **Named Shadows sind bevorzugt:** `2nd_mainpage` und `2nd_systime` enthalten aktuellere Daten als `baseInfo`
2. **`devs` Map ist zentral:** In `2nd_mainpage` enthält die `devs` Map alle Gerätedaten indexiert nach `deviceSN`
3. **Thing Names sind konstruiert:** Verwende die Konstruktionsregeln, nicht hartcodierte Namen
4. **Wildcards für Discovery:** Nutze `+` Wildcards zum Finden unbekannter Shadow Names
5. **SigV4 Signing erforderlich:** Alle HTTPS Shadow GET Requests benötigen AWS SigV4 Signierung
6. **MQTT benötigt Presigning:** WebSocket-URLs müssen mit AWS SigV4 vorsigniert werden

---

**Ende der Shadow-Referenz**

*Erstellt am 7. Januar 2026 aus dekompilierter X-Sense APK v1.33.0*
