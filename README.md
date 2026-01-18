# X-Sense for Homey

![X-Sense Logo](assets/images/large.png)

Connect your X-Sense security and climate monitoring devices to Homey for smart home automation and alerts!

## 🔥 Supported Devices

### Security Devices
- **Smoke Detectors**
  - XS01-WT (WiFi)
  - XS0B-MR (Base Station)
  - SC07-WX (WiFi with Display)
- **CO Detectors** (Carbon Monoxide)
- **Heat Detectors**
- **Water Leak Sensors**

### Access Control
- **Door/Window Sensors**
- **Motion Sensors** (PIR)
- **Mailbox Alarms**

### Climate Monitoring
- **Temperature & Humidity Sensors**
  - STH51 (Temperature/Humidity)

## ✨ Features

- ✅ **Real-time Monitoring**: Instant notifications when smoke, CO, or water is detected
- ✅ **Battery Monitoring**: Track battery levels for all wireless devices
- ✅ **WiFi Signal Strength**: Monitor connection quality
- ✅ **Flow Cards**: Create advanced automations with triggers, conditions, and actions
- ✅ **Multi-language**: English and German support
- ✅ **Auto-discovery**: All your X-Sense devices are automatically discovered

## 📱 Installation

1. Install this app from the Homey App Store
2. Go to **Devices** → **Add Device** → **X-Sense**
3. Enter your X-Sense account credentials
4. Your devices will be discovered automatically
5. Start creating flows!

### ⚠️ Important: Family Share Account Required

**CRITICAL**: Do NOT use your main X-Sense account! The X-Sense app can only be logged in on ONE device at a time.

**Recommended Setup**:
1. Create a new X-Sense account (e.g., `homey@yourdomain.com`)
2. In the X-Sense mobile app, use **Family Share** to share your devices with this new account
3. Use this dedicated account for Homey

This way, both your mobile app and Homey can stay connected simultaneously.

## 🔄 Flow Cards

### Triggers (When...)
- Smoke detected
- CO detected  
- Device muted
- Temperature changed
- Keypad event
- SOS button pressed

### Conditions (And...)
- Is smoke detected?

### Actions (Then...)
- Mute alarm
- Test alarm
- Trigger fire drill

## 🛠️ Troubleshooting

### Devices not discovered
- Ensure your X-Sense devices are online in the mobile app
- Check that you're using a Family Share account, not your main account
- Try removing and re-adding the app

### Connection issues
- Verify your X-Sense credentials are correct
- Make sure Homey has internet connectivity
- Check if devices show as online in the X-Sense mobile app

### Battery not updating
- WiFi devices (SC07-WX): Battery status updates every ~60 seconds
- Base station devices: Battery status is synced via MQTT shadows

## 📊 Technical Details

### Capabilities
- `alarm_smoke` - Smoke alarm status
- `alarm_co` - CO alarm status
- `alarm_water` - Water leak alarm
- `alarm_contact` - Door/window contact
- `alarm_motion` - Motion detection
- `measure_temperature` - Temperature (°C)
- `measure_humidity` - Humidity (%)
- `measure_battery` - Battery level (%)
- `measure_last_seen` - Last update timestamp
- `measure_smoke_status` - Detailed smoke status

### Data Sources
- **MQTT Shadows**: Real-time device status via AWS IoT
- **X-Sense Cloud API**: Device discovery and configuration
- **Update Frequency**: 1-60 seconds depending on device type

## 🔐 Privacy & Security

- Your credentials are stored securely in Homey
- Connection to X-Sense cloud uses encrypted HTTPS and MQTT over TLS
- No data is shared with third parties
- All processing happens locally on your Homey

## 🐛 Bug Reports & Feature Requests

Found a bug or have a suggestion?  
Please report it on GitHub: https://github.com/Meyblaubaer/com.xsense.svenm/issues

## 📝 Changelog

### v1.1.1 (2026-01-18)
- ✅ Fixed battery status for WiFi devices (SC07-WX)
- ✅ Enhanced shadow discovery system
- ✅ Improved MQTT stability

### v1.1.0
- ✅ Added STH51 Temperature/Humidity sensor support
- ✅ Comprehensive debug system
- ✅ Multiple house support

### v1.0.0
- 🎉 Initial release
- ✅ Smoke detector support
- ✅ CO detector support
- ✅ Basic flow cards

## 👨‍💻 Developer

**Sven-Christian Meyhoefer**  
GitHub: [@Meyblaubaer](https://github.com/Meyblaubaer)

## 📄 License

This app is provided as-is without warranty. X-Sense is a trademark of their respective owners.

## 🙏 Support

If you find this app useful, please leave a review in the Homey App Store!

---

**Made with ❤️ for the Homey Community**
