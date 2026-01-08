# XSense for Homey

Diese Homey App ermöglicht die Integration von XSense Rauchmeldern und anderen XSense Sicherheitsgeräten in Homey Self Hosted.

## Funktionen

- **Rauch- und CO-Erkennung**: Empfange Alarme bei Rauch- oder Kohlenmonoxid-Detektion
- **Batteriestatus**: Überwache den Batteriestatus deiner Geräte
- **Temperatur & Luftfeuchtigkeit**: Zeige Umgebungsdaten an (für unterstützte Geräte)
- **Echtzeit-Updates**: MQTT-basierte Live-Updates von deinen Geräten
- **Flow-Integration**: Nutze XSense-Geräte in Homey Flows

## Unterstützte Geräte

### Rauchmelder & CO-Melder
- XSense Rauchmelder (XS01-WX, XS03-WX, XS01-M, XS0B-MR, etc.)
- XSense CO-Melder (XC04-WX, XC01-M)
- XSense Kombi-Melder Rauch + CO (SC07-WX, XP0A-MR) - **Volle Unterstützung inkl. Temperatur & CO-Werten!**
- XSense Hitzemelder (XH02-M)

### WLAN-Temperatur- & Luftfeuchtigkeitssensoren
- **STH51** - WiFi Thermometer Hygrometer (Swiss Sensor, ±0.2°C Genauigkeit) - **Verbesserte Unterstützung**
- **STH54** - WiFi Thermometer Hygrometer (3er-Pack Variante)
- **STH0A** - WiFi Thermometer Hygrometer mit LCD (inkl. VPD & Taupunkt)

### Wassersensoren
- **SWS51** - Smart Water Leak Detector (mit eingebautem Alarm)
- **SWS0A** - Smart Water Leak Detector (kompakt, nur Base Station Alarm)

### Andere Sensoren
- **XH02-M** - Hitzemelder (Heat Detector)
- **MA01** - Briefkasten-Alarm (Mailbox Alarm)

## Installation

1. Installiere die App über den Homey App Store oder lade sie manuell hoch
2. Füge ein neues XSense Gerät hinzu
3. Melde dich mit deinen XSense-Zugangsdaten an (E-Mail und Passwort)
4. Wähle die Geräte aus, die du hinzufügen möchtest

## ⚠️ WICHTIG: Erstelle einen eigenen Account für Homey!

X-Sense erlaubt **nur eine aktive Sitzung pro Account**.
Wenn du denselben Account auf deinem Smartphone und in Homey nutzt, werden sich die Geräte gegenseitig ausloggen ("Another device is logged in").
Dies führt zu Lücken in den Daten-Updates.

**Lösung:**
1.  Erstelle einen **zweiten X-Sense Account** (z.B. mit einer anderen E-Mail-Adresse).
2.  Nutze die "Familienfreigabe" (Family Share) Funktion in der X-Sense App, um dein "Zuhause" mit diesem neuen Account zu teilen.
3.  Benutze diesen neuen Account **ausschließlich für Homey**.

## Capabilities

Die App unterstützt folgende Capabilities:

- `alarm_smoke` - Rauchmelder-Alarm
- `alarm_co` - Kohlenmonoxid-Alarm
- `alarm_battery` - Batterie-Warnung
- `measure_battery` - Batteriestatus in %
- `measure_temperature` - Temperatur in °C
- `measure_humidity` - Luftfeuchtigkeit in %
- `measure_co` - CO-Wert in ppm (für SC07-WX und andere CO-Melder)

## Flow Cards

### Triggers (Wenn...)

- **Rauch erkannt** - Wird ausgelöst, wenn Rauch erkannt wird
- **CO erkannt** - Wird ausgelöst, wenn Kohlenmonoxid erkannt wird
- **Batterie schwach** - Wird ausgelöst, wenn die Batterie schwach ist
- **Gerät stummgeschaltet** - Wird ausgelöst, wenn ein Alarm stummgeschaltet wurde
- **Wasserleck erkannt** - Wird ausgelöst, wenn ein Wasserleck erkannt wird
- **Temperatur geändert** - Wird ausgelöst, wenn sich die Temperatur um mehr als 0,5°C ändert
- **Luftfeuchtigkeit geändert** - Wird ausgelöst, wenn sich die Luftfeuchtigkeit um mehr als 5% ändert

### Conditions (Und...)

- **Rauch ist erkannt/nicht erkannt** - Prüfe, ob aktuell Rauch erkannt wird
- **CO ist erkannt/nicht erkannt** - Prüfe, ob aktuell CO erkannt wird

### Actions (Dann...)

- **Alarm testen** - Führe einen Alarmtest durch (nur für Rauchmelder)

## Beispiel-Flows

### Rauchmelder-Alarm
**Wenn** ein XSense Rauchmelder Rauch erkennt
**Dann** sende eine Push-Benachrichtigung
**Und** schalte alle Lichter ein

### Wasserleck-Alarm
**Wenn** ein XSense Wassersensor ein Leck erkennt
**Dann** sende eine dringende Benachrichtigung
**Und** schalte das Hauptwasserventil ab

### Temperaturüberwachung
**Wenn** die Temperatur auf über 25°C steigt
**Dann** schalte die Klimaanlage ein

### Batterie-Warnung
**Wenn** die Batterie eines XSense Geräts schwach ist
**Dann** sende eine Benachrichtigung

### Wöchentlicher Test
**Wenn** es Sonntag 10:00 Uhr ist
**Dann** teste den Alarm aller Rauchmelder

### Gewächshaus-Überwachung
**Wenn** die Luftfeuchtigkeit unter 60% fällt
**Dann** schalte die Bewässerung ein
**Und** sende eine Benachrichtigung

## ✅ AWS Cognito Integration - Vollständig Implementiert

Die App nutzt jetzt **vollständige AWS Cognito SRP Authentication** für die Verbindung mit der XSense Cloud API.

**Status:**
- ✅ Komplette App-Struktur (Driver, Flow Cards, UI)
- ✅ Alle drei Gerätetypen implementiert (Rauchmelder, Temperatur, Wasser)
- ✅ **AWS Cognito Authentication vollständig implementiert**
- ✅ **Auto-Relogin / Session Recovery** (Keine "Another device is logged in" Fehler mehr)
- ✅ Thing Shadows API für Geräte-Daten (Verbesserte Parsing-Logik für STH51 & SC07-WX)
- ⚠️ MQTT Real-time Updates (Basis implementiert)

**Funktionen:**
- Automatischer Abruf der Cognito Credentials vom XSense Server
- Sichere SRP-basierte Authentifizierung
- Unterstützung für Houses, Stations und Devices
- Intelligente Geräte-Erkennung (auch für "Station-only" Devices wie SC07-WX)
- Thing Shadows API für aktuellen Gerätestatus


## Fehlerbehebung

### Geräte werden nicht gefunden
- Stelle sicher, dass deine Geräte in der offiziellen XSense App sichtbar sind
- Überprüfe deine Anmeldedaten
- Stelle sicher, dass die Base Station online ist

### Keine Echtzeit-Updates
- Überprüfe die Internetverbindung deines Homey
- Stelle sicher, dass die Base Station mit dem Internet verbunden ist
- Die App versucht automatisch, die MQTT-Verbindung wiederherzustellen

### Gerät zeigt "Nicht verfügbar"
- Überprüfe, ob das Gerät in der XSense App online ist
- Warte auf das nächste Update (alle 60 Sekunden)
- Starte das Gerät in Homey neu



## Support

Bei Problemen oder Fragen erstelle bitte ein Issue auf GitHub.

## Lizenz

GPL-3.0

## Danksagung

Basierend auf der Arbeit von [@Jarnsen](https://github.com/Jarnsen) und der [ha-xsense-component_test](https://github.com/Jarnsen/ha-xsense-component_test) Integration für Home Assistant.
