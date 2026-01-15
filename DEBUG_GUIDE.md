# X-Sense Homey App - Debug Guide

## 🐛 Debug System Overview

Das Debug-System bietet umfassendes Logging und Datenerfassung für:
- **MQTT Traffic** - Alle eingehenden/ausgehenden Nachrichten mit Topics und Payloads
- **Shadow Data** - Vollständige AWS IoT Thing Shadows
- **API Calls** - Alle XSense API Requests/Responses
- **Sensor Data** - Device-spezifische Datenverarbeitung (STH51, SC07-WX, etc.)
- **SSL/TLS** - Handshake-Details (coming soon)

## 🚀 Debug Mode Aktivieren

### Environment Variable (Empfohlen)

```bash
# Alle Debug-Features aktivieren
export XSENSE_DEBUG=true
homey app run

# Oder spezifische Features:
export XSENSE_DEBUG=mqtt,shadows,sensors
homey app run

# Einzelne Flags:
# - mqtt: MQTT Traffic Logging
# - shadows: Shadow Data Dumping
# - sensors: Sensor-spezifisches Logging
# - ssl: SSL/TLS Handshake Logging
# - api: API Call Logging
# - all: Alles aktivieren
```

### Permanent in Shell Profile

```bash
# In ~/.zshrc oder ~/.bashrc hinzufügen:
export XSENSE_DEBUG=true

# Neu laden:
source ~/.zshrc
```

## 📂 Debug Output Location

Alle Debug-Dateien werden geschrieben nach: **/tmp/xsense-debug/**

```
/tmp/xsense-debug/
├── mqtt-traffic.jsonl           # Alle MQTT Nachrichten (JSONL Format)
├── mqtt-subscriptions.log        # MQTT Topic Subscriptions
├── mqtt-device-{id}.jsonl       # Device-spezifischer MQTT Traffic
├── shadows.jsonl                 # Alle Shadow Dumps (JSONL)
├── shadow-{thing}-{name}.json   # Einzelne Shadow Dumps (Pretty JSON)
├── sensor-STH51.jsonl            # STH51-spezifische Daten
├── sensor-SC07-WX.jsonl          # SC07-WX-spezifische Daten
├── device-{deviceId}.jsonl      # Device-spezifische Logs
├── api-calls.jsonl               # API Call Logs
├── device-updates.jsonl          # Device Update History
└── snapshot-{label}-{ts}.json   # Debug Snapshots

Hinweis: /tmp wird bei Reboot gelöscht! Dateien vor Neustart sichern.
```

## 📊 Log-Formate

### MQTT Traffic (JSONL)

```json
{
  "timestamp": "2026-01-11T10:30:15.123Z",
  "messageId": 42,
  "direction": "incoming",
  "topic": "$aws/things/SC07-WX-12345678/shadow/name/2nd_sensor_data/update/accepted",
  "payload": {
    "state": {
      "reported": {
        "temperature": 22.5,
        "humidity": 45,
        "coPpm": 0
      }
    }
  },
  "metadata": {
    "payloadSize": 256,
    "timestamp": "2026-01-11T10:30:15.123Z"
  }
}
```

### Shadow Dumps (JSON)

```json
{
  "timestamp": "2026-01-11T10:30:15.123Z",
  "dumpId": 15,
  "thingName": "SC07-WX-12345678",
  "shadowName": "2nd_sensor_data",
  "metadata": {
    "deviceType": "SC07-WX",
    "stationSn": "12345678",
    "region": "eu-central-1"
  },
  "shadow": {
    "temperature": 22.5,
    "humidity": 45,
    "coPpm": 0,
    "coLevel": 0
  }
}
```

### API Calls (JSONL)

```json
{
  "timestamp": "2026-01-11T10:30:15.123Z",
  "method": "POST",
  "url": "https://api.x-sense-iot.com/server/v2/api/biz/exec",
  "bizCode": "102007",
  "duration": 342,
  "request": {
    "stationId": "ABC123...",
    "password": "***REDACTED***"
  },
  "response": {
    "code": 200,
    "data": { /* ... */ }
  }
}
```

### Sensor Data (JSONL)

```json
{
  "timestamp": "2026-01-11T10:30:15.123Z",
  "deviceType": "STH51",
  "deviceId": "D716D79B1DFF11F0822D2FC46968F13A",
  "source": "mqtt",
  "data": {
    "temperature": 22.5,
    "humidity": 45,
    "batInfo": 3,
    "online": "1"
  }
}
```

## 🔍 Häufige Debug-Szenarien

### 1. STH51 empfängt keine Temperatur-Updates

```bash
# Aktiviere Debug:
export XSENSE_DEBUG=mqtt,shadows,sensors
homey app run

# Warte 5 Minuten, dann analysiere:
# 1. MQTT Traffic prüfen
grep -i "STH51\|temperature" /tmp/xsense-debug/mqtt-traffic.jsonl

# 2. Shadow Data prüfen
ls -la /tmp/xsense-debug/shadow-*STH51*.json

# 3. Sensor-spezifische Logs
cat /tmp/xsense-debug/sensor-STH51.jsonl | jq .
```

**Zu prüfen:**
- Werden MQTT Nachrichten für das STH51 Device empfangen?
- Welche Shadow Names werden verwendet?
- Sind Temperatur/Humidity Felder in den Shadows vorhanden?
- Stimmen die Topic-Namen mit den subscriptions überein?

### 2. SC07-WX CO-Werte fehlen

```bash
export XSENSE_DEBUG=shadows,mqtt
homey app run

# Nach 5 Minuten:
# Alle SC07-WX Shadows prüfen
ls /tmp/xsense-debug/shadow-*SC07*.json

# CO-relevante Topics suchen
grep -i "alarm_status\|sensor_data\|co" /tmp/xsense-debug/mqtt-traffic.jsonl

# Shadow Content inspizieren
cat /tmp/xsense-debug/shadow-SC07-WX-*-2nd_alarm_status.json | jq '.shadow'
```

**Zu prüfen:**
- Welche Shadows enthalten `coPpm` oder `co` Felder?
- Werden `2nd_alarm_status` oder `2nd_sensor_data` Shadows gefunden?
- Sind die Shadow Names korrekt gebildet (mit/ohne SN-Suffix)?

### 3. MQTT Disconnects nach 15 Minuten

```bash
export XSENSE_DEBUG=mqtt
homey app run

# 20 Minuten warten, dann:
grep -i "disconnect\|close\|error" /tmp/xsense-debug/mqtt-traffic.jsonl

# Signature Refresh Events
grep -i "signature.*refresh" /tmp/homey-test.log
```

**Zu prüfen:**
- Timestamp des letzten MQTT Disconnect
- Wurde Signature Refresh ausgelöst?
- Welcher Error Code wurde zurückgegeben?

### 4. API Call Performance

```bash
export XSENSE_DEBUG=api
homey app run

# Nach Test:
cat /tmp/xsense-debug/api-calls.jsonl | jq '.duration' | sort -n
cat /tmp/xsense-debug/api-calls.jsonl | jq 'select(.duration > 1000)'
```

**Analysiere:**
- Durchschnittliche Response Time
- Langsame API Calls (> 1s)
- Fehlerhafte Responses

## 🧪 Live-Debugging mit tail

```bash
# MQTT Traffic live verfolgen
tail -f /tmp/xsense-debug/mqtt-traffic.jsonl | jq .

# Nur STH51 Messages
tail -f /tmp/xsense-debug/mqtt-traffic.jsonl | jq 'select(.topic | contains("STH51"))'

# API Calls live
tail -f /tmp/xsense-debug/api-calls.jsonl | jq '{bizCode, duration, status: .response.code}'

# Sensor Updates
tail -f /tmp/xsense-debug/sensor-STH51.jsonl | jq '{time: .timestamp, temp: .data.temperature, hum: .data.humidity}'
```

## 📦 Debug Data Sammeln für Issue Reports

```bash
# 1. Debug aktivieren
export XSENSE_DEBUG=true
homey app run

# 2. Problem reproduzieren (z.B. 10 Minuten warten)

# 3. Debug Data archivieren
cd /tmp
tar -czf xsense-debug-$(date +%Y%m%d-%H%M%S).tar.gz xsense-debug/

# 4. Archive hochladen zu GitHub Issue
```

## 🔧 Erweiterte Debug-Funktionen

### Snapshot erstellen (Programmatisch)

In `app.js` oder Device Code:

```javascript
// Debug Snapshot des aktuellen App-Zustands
if (this.api && this.api.debug) {
  this.api.debug.createSnapshot('app-state', {
    devices: Array.from(this.api.devices.values()),
    stations: Array.from(this.api.stations.values()),
    mqttConnections: this.api.mqttClients.size,
    timestamp: new Date().toISOString()
  });
}
```

### Device Update Tracking

```javascript
// In device.js
const before = this.getCapabilityValue('measure_temperature');
const after = newData.temperature;

this.api.debug.logDeviceUpdate(
  this.getData().id,
  this.getName(),
  { temperature: before },
  { temperature: after },
  'mqtt'
);
```

## 📝 Debug Log Analyse mit jq

### Häufigste MQTT Topics

```bash
cat /tmp/xsense-debug/mqtt-traffic.jsonl | jq -r '.topic' | sort | uniq -c | sort -rn
```

### Alle Device Types

```bash
cat /tmp/xsense-debug/shadows.jsonl | jq -r '.metadata.deviceType' | sort -u
```

### Shadow Names pro Device Type

```bash
cat /tmp/xsense-debug/shadows.jsonl | jq -r '"\(.metadata.deviceType): \(.shadowName)"' | sort | uniq
```

### API Error Rate

```bash
total=$(cat /tmp/xsense-debug/api-calls.jsonl | wc -l)
errors=$(cat /tmp/xsense-debug/api-calls.jsonl | jq 'select(.response.code != 200)' | wc -l)
echo "Error Rate: $errors / $total"
```

### Durchschnittliche API Response Time

```bash
cat /tmp/xsense-debug/api-calls.jsonl | jq '.duration' | awk '{sum+=$1; count++} END {print "Average:", sum/count, "ms"}'
```

## 🚨 Troubleshooting

### Debug Logs werden nicht geschrieben

```bash
# Prüfe Permissions
ls -la /tmp/xsense-debug/

# Prüfe ob Variable gesetzt ist
echo $XSENSE_DEBUG

# Prüfe Homey Log für DebugLogger Init
grep "DEBUG MODE ENABLED" /tmp/homey-test.log
```

### /tmp/xsense-debug/ existiert nicht

Debug Mode wurde nicht aktiviert oder DebugLogger konnte Verzeichnis nicht erstellen.

```bash
# Manuell erstellen:
mkdir -p /tmp/xsense-debug
chmod 755 /tmp/xsense-debug

# App neu starten
```

### JSONL Files sind zu groß

```bash
# Alte Logs rotieren
cd /tmp/xsense-debug
tar -czf archive-$(date +%Y%m%d-%H%M%S).tar.gz *.jsonl
rm *.jsonl
```

### Performance Impact

Debug Mode hat minimal Performance Impact:
- MQTT Logging: ~1ms pro Message
- Shadow Dumping: ~5ms pro Shadow
- API Logging: ~2ms pro Call
- File I/O: Asynchron, blockiert nicht

**Tipp:** Verwende spezifische Flags (z.B. `XSENSE_DEBUG=sensors`) statt `all` um Overhead zu reduzieren.

## 📚 Vergleich mit Home Assistant Debug

Die Home Assistant Integration hat ähnliche Debug-Features:

**Home Assistant:**
```python
_LOGGER.debug("MQTT message: %s - %s", topic, payload)
```

**Homey (neu):**
```javascript
this.debug.logMQTTMessage('incoming', topic, payload);
```

**Vorteile des neuen Systems:**
- ✅ Strukturierte JSONL Logs (maschinenlesbar)
- ✅ Device-spezifische Log-Dateien
- ✅ Shadow Dumps als separate JSON Files
- ✅ Before/After Comparison bei Updates
- ✅ Automatische Datensanitisierung (Passwords, Tokens)

## 🎯 Nächste Schritte

1. **SSL/TLS Handshake Logging** hinzufügen (geplant)
2. **WebSocket Frame Logging** für MQTT (geplant)
3. **Performance Profiling** Integration
4. **Auto-Upload zu GitHub** für Bug Reports

---

**Fragen oder Probleme?**
- GitHub Issues: https://github.com/Meyblaubaer/com.xsense.svenm/issues
- Debug Logs bitte IMMER mit Issue Report anhängen!
