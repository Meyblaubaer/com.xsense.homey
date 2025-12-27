'use strict';

const crypto = require('crypto');
const aws4 = require('aws4');

class AwsSigner {
  constructor(accessKeyId, secretAccessKey, sessionToken, options = {}) {
    this.updateCredentials(accessKeyId, secretAccessKey, sessionToken);
    this.service = 'iotdata';
    this.useAws4 = options.useAws4 === true;
  }

  updateCredentials(accessKeyId, secretAccessKey, sessionToken) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
  }

  _sign(key, msg) {
    return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
  }

  _getSignatureKey(dateStamp, region, service = this.service) {
    const kDate = this._sign(Buffer.from('AWS4' + this.secretAccessKey, 'utf8'), dateStamp);
    const kRegion = this._sign(kDate, region);
    const kService = this._sign(kRegion, service);
    return this._sign(kService, 'aws4_request');
  }

  _formatAmzDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  _buildPresign(parsed, region, options = {}) {
    if (!this.accessKeyId || !this.secretAccessKey || !this.sessionToken) {
      throw new Error('AWS credentials not available for signing');
    }

    const now = options.fixedDate ? new Date(options.fixedDate) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new Error(`Invalid fixedDate provided to signer: ${options.fixedDate}`);
    }

    const amzDate = this._formatAmzDate(now);
    const dateStamp = amzDate.substring(0, 8);
    this.lastAmzDate = amzDate;
    this.lastLocalIso = now.toISOString();

    const credentialScope = `${dateStamp}/${region}/${this.service}/aws4_request`;
    const credential = `${this.accessKeyId}/${credentialScope}`;

    const encodeCredential = (value) => encodeURIComponent(value);
    const encodeToken = (value) => encodeURIComponent(value);

    // Prepare query params
    const queryParams = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-SignedHeaders': 'host'
    };

    // NOTE: For XSense/AWS IoT Websockets, the Security Token must NOT be signed.
    // It is appended to the URL after the signature is calculated.
    // This contradicts standard AWS SigV4 but matches the working Python implementation behavior.

    // Sort and encode params for canonical query string
    const canonicalQuerystring = Object.keys(queryParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
      .join('&');

    const canonicalHeaders = `host:${parsed.host}\n`;
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');

    const canonicalRequest = [
      'GET',
      parsed.pathname || '/',
      canonicalQuerystring,
      canonicalHeaders,
      'host',
      payloadHash
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    const signingKey = this._getSignatureKey(dateStamp, region, this.service);
    const signature = crypto.createHmac('sha256', signingKey)
      .update(stringToSign, 'utf8')
      .digest('hex');

    // Final URL: Canonical Query + Security Token + Signature
    const requestQueryParts = [
      canonicalQuerystring
    ];

    if (this.sessionToken) {
      requestQueryParts.push(`X-Amz-Security-Token=${encodeToken(this.sessionToken)}`);
    }

    requestQueryParts.push(`X-Amz-Signature=${signature}`);

    const requestQuery = requestQueryParts.join('&');

    const finalUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}?${requestQuery}`;

    return {
      url: finalUrl,
      debug: {
        amzDate,
        dateStamp,
        credentialScope,
        credential,
        canonicalQuerystring,
        canonicalHeaders,
        payloadHash,
        canonicalRequest,
        stringToSign,
        signature,
        requestQuery,
        host: parsed.host,
        path: parsed.pathname || '/',
        fixedDate: options.fixedDate || null
      }
    };
  }

  presignWebsocketUrl(url, region) {
    const parsed = new URL(url);
    if (this.useAws4) {
      return this._presignWithAws4(parsed, region);
    }

    return this._buildPresign(parsed, region).url;
  }

  presignWebsocketUrlWithDebug(url, region, options = {}) {
    const parsed = new URL(url);
    if (this.useAws4) {
      return {
        url: this._presignWithAws4(parsed, region),
        debug: { note: 'aws4 signer enabled; canonical request debug unavailable.' }
      };
    }

    return this._buildPresign(parsed, region, options);
  }

  _presignWithAws4(parsed, region) {
    const now = new Date();
    this.lastLocalIso = now.toISOString();
    const request = {
      host: parsed.host,
      method: 'GET',
      path: parsed.pathname || '/',
      service: this.service,
      region,
      signQuery: true
    };

    aws4.sign(request, {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken
    });

    const queryIndex = request.path.indexOf('?');
    let orderedPath = request.path;
    if (queryIndex !== -1) {
      const query = new URLSearchParams(request.path.substring(queryIndex + 1));
      const amzDate = query.get('X-Amz-Date');
      if (amzDate) {
        this.lastAmzDate = amzDate;
      }
      const getParam = (name) => query.get(name);
      const ordered = [];
      const addParam = (name) => {
        const value = getParam(name);
        if (value !== null) {
          ordered.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
        }
      };
      addParam('X-Amz-Algorithm');
      addParam('X-Amz-Credential');
      addParam('X-Amz-Date');
      addParam('X-Amz-Expires');
      addParam('X-Amz-SignedHeaders');
      addParam('X-Amz-Security-Token');
      addParam('X-Amz-Signature');

      if (ordered.length) {
        orderedPath = `${request.path.substring(0, queryIndex)}?${ordered.join('&')}`;
      }
    }
    return `${parsed.protocol}//${parsed.host}${orderedPath}`;
  }
}

module.exports = AwsSigner;
