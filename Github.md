# XSense Homey App - Public Repository Guide

This document outlines the project structure and confirms which files are safe to be committed to a public GitHub repository. The application code is designed to be secure and does not contain hardcoded personal credentials.

## ✅ Safe to Upload

The following files and directories contain the application logic and configuration structure. They are safe to make public:

### Source Code
- **`/drivers/`**: Contains the device logic for Smoke Detectors, Sensors, etc.
- **`/lib/`**: Contains the `XSenseAPI.js` and `AwsSigner.js`.
    - *Note:* The API client is implemented to fetch sensitive keys (like Client Secret) dynamically from the server or derive them from user login. **No personal keys are hardcoded.**
- **`/assets/`**: Icons and images.
- **`/locales/`**: Translation files (en.json, de.json).
- **`app.js`**: The main application entry point.
- **`app.json`**: The Homey app manifest (defines capabilities, flow cards, etc.).

### Documentation
- `README.md`
- `CHANGELOG.md`
- `INSTALLATION.md`
- `TODO.md`

### Configuration
- **`.gitignore`**: Defines what should always be hidden.
- `package.json`: Dependency definitions.
- `package-lock.json`: Dependency tree lock file.

---

## ⛔️ DO NOT UPLOAD (Sensitive Data)

The following files should **NEVER** be committed to GitHub. They are already listed in `.gitignore` to prevent accidental uploads, but you should double-check:

- **`env.json`**: Contains local development secrets (e.g. your Homey credentials or test accounts).
- **`.env`**: Standard environment variable file (if used).
- **`node_modules/`**: External libraries (installable via `npm install`).
- **`.homeybuild/` & `.homeycompose/`**: Temporary build artifacts.
- **`*.log`**: Debug log files (may contain temporary session tokens).
- **`*.pcap`**: Network capture files (contain raw traffic data).
- **`.DS_Store`**: macOS system files.

## Security Overview

This application uses **AWS Cognito with SRP (Secure Remote Password) Authentication**.

1.  **User Credentials**: The user enters their email/password only during the pairing process in the Homey App. These are never stored in the code.
2.  **API Keys**: The App ID and Client Secrets required to talk to X-Sense are fetched dynamically from the X-Sense cloud during initialization (`bizCode 101001`), or are standard public app identifiers.
3.  **Session Tokens**: Regular session tokens are retrieved at runtime and stored in memory or Homey's encrypted storage, never in the source files.

## Initial Setup for GitHub

1.  Initialize git:
    ```bash
    git init
    ```
2.  Add safe files (respecting .gitignore):
    ```bash
    git add .
    ```
3.  Commit:
    ```bash
    git commit -m "Initial release of XSense Homey App"
    ```
4.  Push to GitHub.
