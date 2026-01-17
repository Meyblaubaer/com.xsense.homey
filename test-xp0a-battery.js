#!/usr/bin/env node
/**
 * Direct XSense API Test for XP0A-iR Battery Analysis
 * Bypasses Homey CLI to avoid build issues
 */

const XSenseAPI = require('./lib/XSenseAPI.js');
const fs = require('fs');
const path = require('path');

// Mock Homey object
const mockHomey = {
  setTimeout: (fn, delay) => setTimeout(fn, delay),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, delay) => setInterval(fn, delay),
  clearInterval: (id) => clearInterval(id),
};

// Load credentials from settings
const settingsPath = path.join(__dirname, '.homeycompose', 'app.json');
let email, password;

// Try to get credentials from environment or ask user
email = process.env.XSENSE_EMAIL;
password = process.env.XSENSE_PASSWORD;

if (!email || !password) {
  console.error('❌ Please set XSENSE_EMAIL and XSENSE_PASSWORD environment variables');
  console.error('');
  console.error('Usage:');
  console.error('  XSENSE_EMAIL="your@email.com" XSENSE_PASSWORD="yourpass" node test-xp0a-battery.js');
  process.exit(1);
}

console.log('🚀 Starting XP0A-iR Battery Analysis...');
console.log(`📧 Email: ${email}`);
console.log('⏱️  Will run for 5 minutes and collect data\n');

// Enable debug
process.env.XSENSE_DEBUG = 'true';

let api;
let updateCount = 0;

async function main() {
  try {
    // Initialize API
    console.log('🔐 Authenticating...');
    api = new XSenseAPI(mockHomey);
    await api.login(email, password);
    console.log('✅ Authenticated!\n');

    // Get all devices
    console.log('📱 Fetching devices...');
    const data = await api.getAllDevices();
    console.log(`✅ Found ${data.devices.length} devices\n`);

    // Find XP0A-iR devices
    const xp0aDevices = data.devices.filter(d =>
      (d.type || d.category || d.deviceType || '').includes('XP0A')
    );

    console.log(`🔍 Found ${xp0aDevices.length} XP0A devices:\n`);

    xp0aDevices.forEach((device, idx) => {
      console.log(`\n--- XP0A Device ${idx + 1} ---`);
      console.log(`Name: ${device.deviceName || device.name}`);
      console.log(`Type: ${device.type || device.category || device.deviceType}`);
      console.log(`SN: ${device.deviceSn || device.stationSn}`);
      console.log(`Online: ${device.onLine !== undefined ? (device.onLine ? 'YES ✅' : 'NO ❌') : 'Unknown'}`);
      console.log(`\n📊 Battery Info:`);
      console.log(`  batInfo: ${JSON.stringify(device.batInfo)}`);
      console.log(`  battery: ${device.battery}`);
      console.log(`  batteryLevel: ${device.batteryLevel}`);
      console.log(`  batteryStatus: ${device.batteryStatus}`);

      console.log(`\n🌡️  Sensor Data:`);
      console.log(`  temperature: ${device.temperature}`);
      console.log(`  coPpm: ${device.coPpm}`);
      console.log(`  alarmStatus: ${device.alarmStatus}`);

      console.log(`\n📡 Connection:`);
      console.log(`  wifiRssi: ${device.wifiRssi}`);
      console.log(`  rfLevel: ${device.rfLevel}`);

      console.log(`\n🔍 Raw Status Object:`);
      if (device.status) {
        console.log(`  ${JSON.stringify(device.status, null, 2)}`);
      } else {
        console.log(`  No status object`);
      }

      console.log(`\n📝 All Available Fields:`);
      const allKeys = Object.keys(device).sort();
      allKeys.forEach(key => {
        if (!['stationId', 'houseId', 'userId', 'mqttRegion'].includes(key)) {
          const value = device[key];
          if (value !== undefined && value !== null && value !== '') {
            console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
          }
        }
      });
    });

    // Listen for updates
    console.log('\n\n⏳ Listening for real-time updates for 5 minutes...');
    console.log('(Press Ctrl+C to stop early)\n');

    api.on('device', (device) => {
      const isXP0A = (device.type || device.category || device.deviceType || '').includes('XP0A');
      if (isXP0A) {
        updateCount++;
        console.log(`\n[${new Date().toISOString()}] 🔄 XP0A Update #${updateCount}:`);
        console.log(`  Device: ${device.deviceName || device.name}`);
        console.log(`  Battery: ${JSON.stringify(device.batInfo)} (batteryLevel: ${device.batteryLevel})`);
        console.log(`  Temperature: ${device.temperature}°C`);
        console.log(`  CO: ${device.coPpm} ppm`);
        console.log(`  Online: ${device.onLine}`);
      }
    });

    // Wait 5 minutes
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));

    console.log(`\n\n✅ Test completed!`);
    console.log(`📊 Received ${updateCount} XP0A device updates`);

    // Final device state
    console.log('\n📸 Final Device State:');
    const finalData = await api.getAllDevices();
    const finalXP0A = finalData.devices.filter(d =>
      (d.type || d.category || d.deviceType || '').includes('XP0A')
    );

    finalXP0A.forEach((device, idx) => {
      console.log(`\n--- XP0A Device ${idx + 1} FINAL STATE ---`);
      console.log(`Name: ${device.deviceName || device.name}`);
      console.log(`Battery: ${JSON.stringify(device.batInfo)}`);
      console.log(`BatteryLevel: ${device.batteryLevel}`);
      console.log(`Temperature: ${device.temperature}`);
      console.log(`CO PPM: ${device.coPpm}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Interrupted by user');
  console.log(`📊 Received ${updateCount} updates before stopping`);
  process.exit(0);
});

main();
