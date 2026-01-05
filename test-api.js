#!/usr/bin/env node
'use strict';

const XSenseAPI = require('./lib/XSenseAPI.js');

async function testAPI() {
  console.log('=== XSense API Test ===\n');

  // Note: Replace with actual credentials for testing
  const email = 'YOUR_EMAIL@example.com';
  const password = 'YOUR_PASSWORD';

  console.log('Email:', email);
  console.log('Creating API client...\n');

  const api = new XSenseAPI(email, password);

  try {
    console.log('Step 1: Initializing API...');
    await api.init();

    console.log('\n✅ Authentication successful!');
    console.log('\nAPI Tokens:');
    console.log('- Access Token:', api.accessToken ? 'Present (length: ' + api.accessToken.length + ')' : 'Missing');
    console.log('- ID Token:', api.idToken ? 'Present (length: ' + api.idToken.length + ')' : 'Missing');
    console.log('- Refresh Token:', api.refreshToken ? 'Present (length: ' + api.refreshToken.length + ')' : 'Missing');

    console.log('\nDiscovered Devices:');
    console.log('- Houses:', api.houses.size);
    console.log('- Stations:', api.stations.size);
    console.log('- Devices:', api.devices.size);

    if (api.devices.size > 0) {
      console.log('\nDevice List:');
      api.devices.forEach((device, id) => {
        console.log(`  - ${device.deviceName || 'Unnamed'} (${device.deviceType || 'Unknown type'})`);
        console.log(`    ID: ${id}`);
        console.log(`    Station: ${device.stationName}`);
        console.log(`    House: ${device.houseName}`);
      });
    }

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    api.destroy();
  }
}

testAPI();
