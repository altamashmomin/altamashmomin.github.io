#!/usr/bin/env node
/**
 * register-partner.js
 * One-time Tesla Fleet API partner registration.
 *
 * Usage:
 *   node scripts/register-partner.js <client_secret> <domain>
 *
 * Example:
 *   node scripts/register-partner.js "my-secret" "altamash.github.io"
 *
 * This only needs to be run ONCE per app/region.
 */

const https = require('https');

const CLIENT_ID = '491ed74e-3308-4835-89cb-35d2620d030b';
const AUTH_BASE = 'https://auth.tesla.com/oauth2/v3';
const FLEET_BASE = 'https://fleet-api.prd.na.vn.cloud.tesla.com';

// ---------------------------------------------------------------------------
// Tiny HTTP helpers (no extra deps needed)
// ---------------------------------------------------------------------------
function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, data: raw });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [, , clientSecret, domain] = process.argv;

  if (!clientSecret || !domain) {
    console.error('Usage: node scripts/register-partner.js <client_secret> <domain>');
    console.error('Example: node scripts/register-partner.js "abc123" "yourname.github.io"');
    process.exit(1);
  }

  // ── Step 1: Get partner token via client_credentials ────────────────────
  console.log('\n[1/2] Getting partner token...');
  const tokenBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: clientSecret,
    scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds',
    audience: FLEET_BASE,
  }).toString();

  const tokenRes = await post(`${AUTH_BASE}/token`, tokenBody);
  console.log('     Status:', tokenRes.status);

  if (tokenRes.status !== 200 || !tokenRes.data.access_token) {
    console.error('     ✗ Failed to get partner token:');
    console.error('    ', JSON.stringify(tokenRes.data, null, 2));
    process.exit(1);
  }

  const partnerToken = tokenRes.data.access_token;
  console.log('     ✓ Partner token obtained');

  // ── Step 2: Register partner account ────────────────────────────────────
  console.log('\n[2/2] Registering partner account for domain:', domain);
  const regRes = await post(
    `${FLEET_BASE}/api/1/partner_accounts`,
    JSON.stringify({ domain }),
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${partnerToken}`,
    },
  );
  console.log('     Status:', regRes.status);
  console.log('     Body:', JSON.stringify(regRes.data, null, 2));

  if (regRes.status === 200 || regRes.status === 204) {
    console.log('\n✅ Registration successful! Your app is now registered with Tesla Fleet API.');
    console.log('   You can now run the TeslaHUD app and it will connect to your vehicle.');
  } else {
    console.error('\n✗ Registration failed. Check the error above.');
    console.error('  Common issues:');
    console.error('  - Public key not yet live at https://' + domain + '/.well-known/appspecific/com.tesla.3p.public-key.pem');
    console.error('  - Domain in Tesla developer portal does not match domain argument');
    console.error('  - client_secret is incorrect');
  }
}

main().catch(e => {
  console.error('Unexpected error:', e.message);
  process.exit(1);
});
