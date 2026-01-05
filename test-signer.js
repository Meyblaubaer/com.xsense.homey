const AwsSigner = require('./lib/AwsSigner');

const accessKey = 'AKIAIOSFODNN7EXAMPLE';
const secretKey = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const sessionToken = 'AQoDYXdzEJr...';
const region = 'eu-central-1';

const signer = new AwsSigner(accessKey, secretKey, sessionToken);

// Mock fixed date for reproducibility
const options = {
    fixedDate: '2025-12-27T12:00:00Z'
};

const url = 'wss://example.com/mqtt'; // Base URL typically used

try {
    const result = signer.presignWebsocketUrlWithDebug(url, region, options);
    console.log('--- Presigned URL ---');
    console.log(result.url);
    console.log('\n--- Debug Info ---');
    console.log('Canonical Querystring:', result.debug.canonicalQuerystring);
    console.log('Signature:', result.debug.signature);

    // Validation checks
    const hasTokenInQuery = result.debug.canonicalQuerystring.includes('X-Amz-Security-Token');
    const hasTokenInUrl = result.url.includes('X-Amz-Security-Token');

    if (hasTokenInQuery && hasTokenInUrl) {
        console.log('\nSUCCESS: Security Token is present in canonical query string and final URL.');
    } else {
        console.log('\nFAILURE: Security Token missing from canonical query or URL.');
    }

} catch (error) {
    console.error('Error:', error);
}
