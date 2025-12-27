# Fortschritt

## Kontext
- Projekt: Homey App `com.xsense.homey`
- Ziel: MQTT-Verbindung zu XSense (AWS IoT) herstellen; REST-API funktioniert, MQTT liefert 403.

## Bisherige Schritte
- Homey App lokal gestartet und umfangreiche Logs gesammelt.
- REST-Calls (Cognito, Login, Devices/Houses/Stations) funktionieren stabil.
- MQTT-WebSocket-Verbindung zu `eu-central-1.x-sense-iot.com:443/mqtt` liefert 403 `ForbiddenException`.
- Debug-Logging fuer MQTT-Presign aktiviert (URL, Headers, Body).
- Vergleich mit Home Assistant Integration und Python `xsense` library durchgefuehrt.

## Referenzen aus der HA/Python-Implementierung
- `MQTTHelper`:
  - `transport='websockets'`
  - `username_pw_set('?SDK=iOS&Version=2.26.5','')`
  - TLS: `ssl.PROTOCOL_TLS`, `CERT_NONE`
  - `ws_set_options(path=<presigned path+query>)`
- `AWSSigner` (Python):
  - Service `iotdata`
  - Canonical Query: sortiert, `X-Amz-Algorithm`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-SignedHeaders`
  - `X-Amz-Security-Token` wird nach dem Signieren an die Query angehaengt
  - Payload-Hash: SHA256 von leerem Body
  - Canonical Headers: `host`

## Homey Debug/Experimente
- Presign-URL fuer MQTT in Homey geloggt (Query und Request-Header).
- Fixes getestet:
  - Signatur-Details geloggt (canonicalRequest, stringToSign, signature).
  - `signer-debug.json` angelegt (Fixed Date zum Vergleich).
- Ergebnisse:
  - Stets `403 Forbidden` mit `ForbiddenException` von AWS IoT.

## Artefakte/Dateien
- `signer-debug.json` im Projekt und `.homeybuild/`
  - Inhalt:
    - `enabled: true`
    - `fixedDate: "20251226T120000Z"`

## Aktueller Stand
- MQTT-Verbindung scheitert an AWS-IoT-Handshake (403).
- REST/Token-Flow stabil.
- Vermutlich Abweichung im Presign/Signature-Handling gegenueber Python-Referenz.

## Naechste Schritte (Vorschlag)
- Homey Signer/Presign strikt an Python `AWSSigner.presign_url` angleichen:
  - Sortierte Query
  - Security Token erst nach dem Signieren anhaengen
  - Service `iotdata`
  - Payload-Hash leer
  - `ws_set_options` nur mit Pfad+Query (keine komplette URL)
- MQTT-Client Parameter angleichen:
  - Username `?SDK=iOS&Version=2.26.5`
  - TLS-Context wie in Python
  - `Sec-WebSocket-Protocol: mqtt`
