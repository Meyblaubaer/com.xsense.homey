# TODO - XSense Homey App

## Kritische Punkte

### AWS Cognito Authentication
Die XSense API nutzt **AWS Cognito SRP (Secure Remote Password) Authentication**, nicht einfache REST API Calls.

**Aktueller Status:**
- ❌ Simplified API implementation (funktioniert nicht mit echtem API)
- ✅ Korrekte API-URL: `https://api.x-sense-iot.com`
- ✅ App-Struktur und alle Driver implementiert

**Benötigt für Production:**

Die `lib/XSenseAPI.js` muss komplett neu implementiert werden mit:

1. **AWS Cognito SRP Authentication**
   - Node.js Paket: `amazon-cognito-identity-js` oder `aws-sdk`
   - USER_SRP_AUTH Flow implementieren
   - Pool ID, Client ID und Client Secret von python-xsense übernehmen

2. **API-Endpunkte**
   - Base URL: `https://api.x-sense-iot.com`
   - Thing Shadows API für Geräte-Status
   - MQTT über AWS IoT

3. **Referenz-Implementation:**
   - Python: https://github.com/theosnel/python-xsense/blob/main/xsense/base.py
   - Verwendet: pycognito, boto3, botocore

## Alternative Lösungsansätze

### Option 1: Python Bridge
- Erstelle einen kleinen Python Service, der python-xsense nutzt
- Homey App kommuniziert mit dem Service via REST
- Vorteil: Nutzt bewährte python-xsense Library
- Nachteil: Zusätzlicher Service notwendig

### Option 2: AWS Cognito in Node.js
- Nutze `amazon-cognito-identity-js` npm Paket
- Implementiere SRP Auth Flow
- Portiere python-xsense Logik nach JavaScript
- Vorteil: Native Homey Integration
- Nachteil: Komplexe Implementation

### Option 3: Reverse-Engineering
- Analysiere XSense Mobile App Traffic (via mitmproxy)
- Finde alternative/einfachere API-Endpoints
- Vorteil: Möglicherweise einfachere Auth
- Nachteil: Nicht offiziell, könnte sich ändern

## Nächste Schritte

1. **AWS Cognito Client ID & Pool ID beschaffen**
   - Aus python-xsense extrahieren oder
   - Via App Traffic Analyse finden

2. **Cognito Authentication implementieren**
   ```javascript
   const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
   // Implement USER_SRP_AUTH flow
   ```

3. **API Calls anpassen**
   - Thing Shadows statt REST endpoints
   - AWS Signature V4 für authentifizierte Requests

4. **MQTT über AWS IoT**
   - Nutze AWS IoT MQTT Endpoints
   - Device Shadow Updates subscriben

## Hilfreiche Links

- Python XSense Library: https://github.com/theosnel/python-xsense
- Home Assistant Integration: https://github.com/Jarnsen/ha-xsense-component_test
- AWS Cognito JS SDK: https://www.npmjs.com/package/amazon-cognito-identity-js
- AWS SDK for JavaScript: https://www.npmjs.com/package/aws-sdk

## Aktuelle Einschränkungen

⚠️ **Die App ist aktuell nicht funktionsfähig**, da die Authentication fehlt.

Die komplette App-Struktur ist fertig:
- ✅ 3 Driver (Rauchmelder, Temperatur, Wasser)
- ✅ Flow Cards
- ✅ Icons und Lokalisierung
- ✅ Device Management
- ❌ **Funktionierende API-Anbindung**

## Für Entwickler

Wenn du zur API-Implementation beitragen möchtest:

1. Schau dir `xsense/base.py` aus python-xsense an
2. Portiere die Cognito Auth nach JavaScript
3. Teste mit echten XSense Geräten
4. Pull Request erstellen
