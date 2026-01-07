# Changelog

## Version 1.0.16

### 🐛 Bug Fixes
- **CRITICAL**: Fixed crash in `getAllDevices` due to missing `getWiFiDeviceShadow` function
- **Stability**: Improvements for SC07-WX WiFi devices

## Version 1.0.13

### 🔴 Critical Fixes
- **Code Quality**: Removed duplicate code to improve stability
- **MQTT**: Fixed temp/humidity real-time updates for STH51 sensors (Active Refresh implemented)
- **Shared Accounts**: Fixed stale data issue for Family Share users

### 📝 Documentation
- Enhanced description to explicitly warn about dedicated account requirement
- Updated README with Family Share setup instructions

### 🐛 Bug Fixes
- **SC07-WX**: Fixed missing battery status by merging multiple shadow data sources
- Temperature sensors now receive real-time updates via MQTT (not just polling)
- Fixed potential data synchronization delays

 - XSense Homey App

## Version 1.0.0 - 2024-12-24

### ✅ Implementiert

**AWS Cognito Authentication**
- Vollständige AWS Cognito SRP (Secure Remote Password) Integration
- Automatischer Abruf der Cognito Credentials (Pool ID, Client ID, Secret)
- Sichere Token-basierte Authentifizierung
- Support für Access Token, ID Token und Refresh Token

**API Integration**
- XSense Cloud API (`https://api.x-sense-iot.com`)
- Thing Shadows API für Geräte-Status
- Houses, Stations und Devices Hierarchie
- BizCode-basierte API Calls (101001, 102007, 103007)

**Driver Implementation**
- **Rauchmelder** (smoke-detector)
  - Rauch-Erkennung (alarm_smoke)
  - CO-Erkennung (alarm_co)
  - Batteriestand (measure_battery, alarm_battery)
  - Temperatur & Luftfeuchtigkeit (optional)
  - Alarmtest-Funktion

- **Temperatur/Luftfeuchtigkeit-Sensor** (temperature-sensor)
  - STH51, STH54, STH0A Support
  - Temperaturmessung (measure_temperature)
  - Luftfeuchtigkeitsmessung (measure_humidity)
  - Batteriestand
  - WiFi-Informationen (SSID in Settings)

- **Wasserleck-Detektor** (water-sensor)
  - SWS51, SWS0A Support
  - Wasserleck-Erkennung (alarm_water)
  - Batteriestand
  - 6 ultra-sensitive Probes Support

**Flow Cards**
- 7 Trigger Cards:
  - Rauch erkannt
  - CO erkannt
  - Wasserleck erkannt
  - Temperatur geändert (>0.5°C)
  - Luftfeuchtigkeit geändert (>5%)
  - Batterie schwach
  - Gerät stummgeschaltet

- 1 Condition Card:
  - Rauch ist erkannt/nicht erkannt

- 1 Action Card:
  - Alarm testen

**UI & Lokalisierung**
- Deutsche und englische Übersetzungen
- SVG Icons für alle Gerätetypen
- Device Settings mit Geräteinformationen
- Pairing Flow mit Login-Credentials

**Technische Features**
- Polling-basierte Updates (60 Sekunden für Geräte, 30 Sekunden global)
- Intelligente Capability-Erkennung basierend auf Gerätetyp
- Error Handling und Logging
- Device Availability Tracking

### ⚠️ Bekannte Einschränkungen

**MQTT Real-time Updates**
- Basis-Struktur implementiert
- AWS IoT MQTT Endpoint Discovery noch nicht vollständig
- Aktuell werden Updates via Polling abgerufen (funktional, aber nicht real-time)

**Device Actions**
- Test Alarm: Funktion vorbereitet, BizCode noch zu ermitteln
- Mute Alarm: Funktion vorbereitet, BizCode noch zu ermitteln

### 📋 Nächste Schritte

1. **AWS IoT MQTT Integration**
   - IoT Endpoint Discovery implementieren
   - WebSocket-basierte MQTT Verbindung
   - Real-time Device Shadow Updates

2. **Device Actions**
   - Korrekte BizCodes für Test/Mute Alarm finden
   - Weitere Geräte-Aktionen (falls verfügbar)

3. **Erweiterte Features**
   - VPD (Vapor Pressure Deficit) für STH0A
   - Dew Point Berechnung
   - WiFi Signal Strength (RSSI)
   - Alarm Volume/Voice Volume Settings

### 🔧 Dependencies

```json
{
  "mqtt": "^4.3.7",
  "amazon-cognito-identity-js": "^6.3.12",
  "node-fetch": "^2.7.0"
}
```

### 📚 Referenzen

- [Python XSense Library](https://github.com/theosnel/python-xsense)
- [Home Assistant Integration](https://github.com/Jarnsen/ha-xsense-component_test)
- [XSense Official](https://www.x-sense.com/)

### 🙏 Credits

Basierend auf der ausgezeichneten Arbeit von:
- [@theosnel](https://github.com/theosnel) - python-xsense Library
- [@Jarnsen](https://github.com/Jarnsen) - Home Assistant Integration
