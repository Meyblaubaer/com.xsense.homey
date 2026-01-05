# Installation und Entwicklung

## Voraussetzungen

- Node.js (v16 oder höher)
- Homey Self Hosted oder Homey Pro (2023)
- XSense Account mit konfigurierten Geräten

## Installation für Entwickler

1. **Repository klonen oder Dateien herunterladen**
   ```bash
   cd com.xsense.homey
   ```

2. **Abhängigkeiten installieren**
   ```bash
   npm install
   ```

3. **Homey CLI installieren** (falls noch nicht installiert)
   ```bash
   npm install -g homey
   ```

4. **Bei Homey anmelden**
   ```bash
   homey login
   ```

5. **App auf Homey installieren**
   ```bash
   homey app install
   ```

## Entwicklung

### App ausführen
```bash
homey app run
```

Dies installiert die App auf deinem Homey und zeigt Live-Logs an.

### Logs anzeigen
```bash
homey app log
```

### App validieren
```bash
homey app validate
```

### App bauen
```bash
homey app build
```

Dies erstellt eine `.tar.gz` Datei, die auf anderen Homey-Geräten installiert werden kann.

## Struktur

```
com.xsense.homey/
├── app.js                      # Haupt-App-Klasse
├── app.json                    # App-Manifest
├── package.json                # Node.js Abhängigkeiten
├── lib/
│   └── XSenseAPI.js           # XSense API Client
├── drivers/
│   └── smoke-detector/
│       ├── driver.js          # Driver-Klasse
│       ├── device.js          # Device-Klasse
│       └── assets/
│           └── images/        # Device Icons
├── locales/
│   ├── en.json                # Englische Übersetzungen
│   └── de.json                # Deutsche Übersetzungen
└── assets/
    └── images/                # App Icons
```

## API-Hinweise

Die XSense API ist nicht offiziell dokumentiert. Diese Implementierung basiert auf der Reverse-Engineering-Arbeit der Home Assistant Community.

### Bekannte API-Endpunkte

- **Login**: `POST /api/v1/user/login`
- **Houses**: `GET /api/v1/houses`
- **Stations**: `GET /api/v1/houses/{houseId}/stations`
- **Devices**: `GET /api/v1/stations/{stationId}/devices`
- **MQTT Config**: `GET /api/v1/stations/{stationId}/mqtt`
- **Test Alarm**: `POST /api/v1/devices/{deviceId}/test`

### MQTT Topics

- `house/{houseId}/event` - Haus-Events
- `house/{houseId}/shadow/+/update` - Device Shadow Updates
- `house/{houseId}/presence/station/{stationId}` - Station Präsenz

## Anpassungen

### Neue Gerätetypen hinzufügen

1. Erstelle einen neuen Driver in `drivers/`
2. Füge den Driver zu `app.json` hinzu
3. Implementiere `driver.js` und `device.js`
4. Füge entsprechende Capabilities hinzu

### Polling-Intervall ändern

In `app.js`:
```javascript
// Standard: 30 Sekunden
this.pollInterval = setInterval(() => {
  this._pollDeviceUpdates();
}, 30000);
```

In `drivers/smoke-detector/device.js`:
```javascript
// Standard: 60 Sekunden
this.pollInterval = setInterval(() => {
  this.updateDevice();
}, 60000);
```

### Flow Cards anpassen

Flow Cards werden in `app.json` unter dem `flow` Schlüssel definiert. Die Implementierung erfolgt in `app.js` oder in den Device-Klassen.

## Debugging

### Verbose Logging aktivieren

Setze in `app.js`:
```javascript
this.log = console.log;
this.error = console.error;
```

### MQTT Debugging

In `lib/XSenseAPI.js` können zusätzliche MQTT-Events geloggt werden:
```javascript
client.on('message', (topic, message) => {
  console.log('MQTT Message:', topic, message.toString());
  this._handleMQTTMessage(topic, message);
});
```

## Bekannte Probleme

1. **API-Endpunkte können sich ändern**: Da die API nicht offiziell ist, können Updates der XSense-Dienste Breaking Changes verursachen.

2. **MQTT-Verbindung**: Die MQTT-Verbindung kann bei Netzwerkproblemen abbrechen. Die App versucht automatisch, die Verbindung wiederherzustellen.

3. **Rate Limiting**: Bei zu vielen API-Anfragen kann es zu Timeouts kommen.

## Beitragen

Verbesserungen und Bug-Fixes sind willkommen! Bitte erstelle einen Pull Request oder öffne ein Issue auf GitHub.

## Lizenz

GPL-3.0
