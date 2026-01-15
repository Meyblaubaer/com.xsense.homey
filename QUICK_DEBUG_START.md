# Quick Start: Debug deine X-Sense Integration

## 🎯 Problem: STH51 und andere Sensoren arbeiten nicht richtig

Du hast jetzt ein vollständiges Debug-System, das **alle** MQTT-Nachrichten, Shadow-Daten und Sensor-Updates mitloggt - genau wie bei der Home Assistant Integration!

## ⚡ Schnellstart (3 Schritte)

### 1. Docker Starten (falls nicht läuft)

```bash
# Docker Desktop öffnen oder:
open -a Docker
# Warte bis Docker läuft (Docker Icon in Menubar wird normal)
```

### 2. Debug Mode Aktivieren & App Starten

```bash
cd /Users/sven-christianmeyhoefer/Documents/com.xsense.svenm

# Debug aktivieren
export XSENSE_DEBUG=true

# App mit Debug starten
homey app run
```

### 3. Warte 10-15 Minuten, dann analysiere

```bash
# Alle Debug-Dateien ansehen
ls -lh /tmp/xsense-debug/

# MQTT Traffic für STH51 prüfen
grep -i "STH51\|temperature" /tmp/xsense-debug/mqtt-traffic.jsonl | head -20

# Alle Shadows für deine Devices
ls /tmp/xsense-debug/shadow-*.json

# Shadow Content ansehen (Pretty Print)
cat /tmp/xsense-debug/shadow-*.json | jq .
```

## 🔍 Was wird geloggt?

### Alle MQTT Nachrichten
**Datei:** `/tmp/xsense-debug/mqtt-traffic.jsonl`

Zeigt ALLE MQTT Messages mit:
- Topic Name
- Vollständiger Payload
- Timestamp
- Message Size

### Alle Shadow Daten
**Dateien:** `/tmp/xsense-debug/shadow-*.json`

Für jedes Device werden ALLE Thing Shadows als separate JSON-Dateien gespeichert:
- `shadow-SC07-WX-12345678-2nd_sensor_data.json`
- `shadow-STH51-87654321-2nd_systime.json`
- `shadow-SBS50-11223344-2nd_info.json`

### Sensor-spezifische Logs
**Dateien:**
- `/tmp/xsense-debug/sensor-STH51.jsonl` - Alle STH51 Daten
- `/tmp/xsense-debug/sensor-SC07-WX.jsonl` - Alle SC07-WX Daten
- `/tmp/xsense-debug/device-{deviceId}.jsonl` - Pro Device

### API Calls
**Datei:** `/tmp/xsense-debug/api-calls.jsonl`

Alle XSense API Requests/Responses mit:
- Request Parameter
- Response Data
- Duration (ms)
- Errors

## 🧪 Live-Analyse während die App läuft

```bash
# In einem separaten Terminal:

# MQTT Traffic live verfolgen
tail -f /tmp/xsense-debug/mqtt-traffic.jsonl | jq .

# Nur STH51 Messages
tail -f /tmp/xsense-debug/mqtt-traffic.jsonl | jq 'select(.topic | contains("STH51"))'

# Sensor Updates live
tail -f /tmp/xsense-debug/sensor-STH51.jsonl | jq '{temp: .data.temperature, hum: .data.humidity}'
```

## 🎯 Typische Probleme Debuggen

### Problem 1: "STH51 zeigt keine Temperatur"

```bash
# 1. Prüfe ob MQTT Messages ankommen
grep "STH51" /tmp/xsense-debug/mqtt-traffic.jsonl

# 2. Welche Topics werden verwendet?
grep "STH51" /tmp/xsense-debug/mqtt-subscriptions.log

# 3. Welche Shadows existieren?
ls /tmp/xsense-debug/shadow-*STH51*.json

# 4. Shadow Content prüfen
cat /tmp/xsense-debug/shadow-STH51-*-2nd_sensor_data.json | jq '.shadow'

# 5. Sensor Data Processing prüfen
cat /tmp/xsense-debug/sensor-STH51.jsonl | jq .
```

**Mögliche Findings:**
- Shadow Name ist anders als erwartet (z.B. `sensor_data` statt `2nd_sensor_data`)
- Temperatur-Feld heißt anders (z.B. `temp` statt `temperature`)
- MQTT Topic wird nicht subscribed
- Shadow ist leer (Device schläft)

### Problem 2: "SC07-WX CO-Werte fehlen"

```bash
# 1. Alle SC07-WX Shadows anzeigen
ls /tmp/xsense-debug/shadow-*SC07*.json

# 2. CO-relevante Shadows prüfen
cat /tmp/xsense-debug/shadow-SC07-WX-*-2nd_alarm_status.json | jq .
cat /tmp/xsense-debug/shadow-SC07-WX-*-2nd_sensor_data.json | jq .

# 3. Welche Felder enthalten CO-Daten?
grep -r "coPpm\|co\|coLevel" /tmp/xsense-debug/shadow-*SC07*.json

# 4. MQTT Messages für CO
grep -i "co\|alarm" /tmp/xsense-debug/mqtt-traffic.jsonl | grep SC07
```

### Problem 3: "Device Updates kommen nicht an"

```bash
# 1. Wie oft kommen Updates?
cat /tmp/xsense-debug/device-updates.jsonl | jq -r '.timestamp' | head -20

# 2. Welche Felder ändern sich?
cat /tmp/xsense-debug/device-updates.jsonl | jq '.changes'

# 3. MQTT Health Status
grep "MQTT health" /tmp/homey-debug-test.log

# 4. Polling vs MQTT
grep -E "(Skipping poll|Polling updates)" /tmp/homey-debug-test.log
```

## 📦 Debug Data für GitHub Issue sammeln

Wenn du ein Problem reportieren willst:

```bash
# 1. App mit Debug laufen lassen (10+ Minuten)

# 2. Debug Data archivieren
cd /tmp
tar -czf xsense-debug-$(date +%Y%m%d-%H%M%S).tar.gz xsense-debug/

# 3. Auch Homey Log mitschicken
cp /tmp/homey-debug-test.log xsense-homey-$(date +%Y%m%d-%H%M%S).log

# 4. Beide Dateien zu GitHub Issue hochladen
```

**Was ich dann sehen kann:**
- Exakte MQTT Topics und Payloads
- Alle Shadow Names und deren Inhalt
- Ob Temperatur/CO Daten überhaupt in den Shadows sind
- Wie die Daten strukturiert sind
- Ob MQTT Subscriptions korrekt sind

## 🔧 Debug Optionen

```bash
# Nur MQTT Traffic
export XSENSE_DEBUG=mqtt
homey app run

# Nur Shadows
export XSENSE_DEBUG=shadows
homey app run

# MQTT + Shadows (für Sensor-Probleme)
export XSENSE_DEBUG=mqtt,shadows,sensors
homey app run

# Alles (vollständig)
export XSENSE_DEBUG=true
homey app run
```

## 💡 Tipps

1. **Lass die App mindestens 10-15 Minuten laufen** - Manche Devices schicken Updates nur alle 5-10 Minuten

2. **Prüfe alle Shadow-Dateien** - Die Daten können in überraschenden Shadows sein

3. **Vergleiche mit Home Assistant** - Wenn HA deine Sensoren richtig ausliest, vergleiche die MQTT Topics/Shadows

4. **jq ist dein Freund** - Installieren mit `brew install jq` für Pretty-Printing

5. **/tmp wird bei Reboot gelöscht** - Sichere wichtige Debug-Dateien!

## 🚀 Next Level: Vergleich mit Home Assistant

Wenn du Home Assistant auch nutzt:

```bash
# 1. HA Debug Logs holen (falls vorhanden)
# In HA: Configuration > Logs, Level auf DEBUG

# 2. HA MQTT Topics vergleichen
# In HA: Developer Tools > MQTT, Subscribe to: $aws/things/#

# 3. Unsere MQTT Topics vergleichen
cat /tmp/xsense-debug/mqtt-subscriptions.log

# 4. Shadow Names vergleichen
ls /tmp/xsense-debug/shadow-*.json
```

**Frage die zu beantworten ist:**
- Welche Topics subscribed HA, die wir nicht haben?
- Welche Shadow Names verwendet HA?
- Wie heißen die Felder in HA vs. unserer Integration?

---

## 📝 Beispiel Debug Session

```bash
# Start
export XSENSE_DEBUG=true
homey app run

# In anderem Terminal, nach 5 Minuten:
cd /tmp/xsense-debug

# Schneller Überblick
echo "=== Shadow Files ==="
ls -1 shadow-*.json

echo "=== MQTT Topics ==="
cat mqtt-subscriptions.log

echo "=== STH51 Data ==="
cat sensor-STH51.jsonl | jq '{temp: .data.temperature, hum: .data.humidity, source: .source}'

echo "=== Shadow Content STH51 ==="
cat shadow-*STH51*.json | jq '{shadow: .shadowName, keys: .shadow | keys}'

# Findings dokumentieren und GitHub Issue erstellen!
```

---

**Vollständige Doku:** Siehe `DEBUG_GUIDE.md` für alle Details!
