// pages/api/sendSMS.js
// or: src/pages/api/sendSMS.js
// or for Vercel Serverless: /api/sendSMS.js
//
// Environment variables required:
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN
// - TWILIO_PHONE_NUMBER  (the Twilio sender number, e.g. +1xxx)
// Optional:
// - SENDSMS_ALLOWED_ORIGIN (defaults to 'https://smartport-test.vercel.app')

export default async function handler(req, res) {
  // safer default: use your frontend origin if env not set
  const DEFAULT_ORIGIN = 'https://smartport-test.vercel.app';
  const ALLOWED_ORIGIN = process.env.SENDSMS_ALLOWED_ORIGIN || DEFAULT_ORIGIN;

  // Always include CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  // allow GET so manual browser visits return a helpful message
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // If you want credentials (cookies), set Access-Control-Allow-Credentials and handle accordingly.

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Helpful GET handler — useful when someone accidentally loads the .js file in browser
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      info: 'sendSMS endpoint (POST) — This route expects a POST with JSON. Example: POST /api/sendSMS with { to, message } OR { appointment, recipients: { driverPhone } }.',
      note: 'Do NOT call /api/sendSMS.js in browser for POST — use /api/sendSMS (no .js) as the request path. If you see a 405 it likely means you requested a static file or used a method the endpoint does not accept.',
      examplePayloads: {
        simple: { to: '+220770123456', message: 'Appointment APPT1234 — Pickup tomorrow 08:00' },
        notify: {
          appointment: { appointmentNumber: '2512010001', pickupDate: '2025-12-08', truckNumber: 'BJL1234' },
          recipients: { driverPhone: '+220770123456', agentName: 'Agent Ltd' }
        }
      }
    });
  }

  if (req.method !== 'POST') {
    // Return a descriptive 405 for unsupported methods
    return res.status(405).json({ error: 'Method Not Allowed. Use POST for sending SMS.' });
  }

  // POST handling
  try {
    // Some runtimes (Edge) may not auto-parse JSON into req.body.
    // Try to use req.body if available, otherwise attempt to parse raw body.
    let body = req.body;
    if (!body || Object.keys(body).length === 0) {
      // attempt to parse raw body as fallback
      try {
        // When using Next.js node runtime, req is a stream; reading raw body:
        body = await new Promise((resolve, reject) => {
          let raw = '';
          req.on && req.on('data', (chunk) => { raw += chunk; });
          req.on && req.on('end', () => {
            if (!raw) return resolve({});
            try { return resolve(JSON.parse(raw)); } catch (e) { return resolve({ _raw: raw }); }
          });
          req.on && req.on('error', (err) => reject(err));
        });
      } catch (e) {
        // ignore parse error; keep body as {}
        body = body || {};
      }
    }

    // Accept either:
    // - { to, message }  OR
    // - notify body: { appointment: {...}, recipients: { driverPhone, agentName }, pdfUrl }
    const toRaw = (body && (body.to || (body.recipients && (body.recipients.driverPhone || body.recipients.to)))) || null;
    const messageRaw = (body && body.message) || null;

    // Build a reasonable SMS message if full notify object supplied & message not provided
    let finalMessage = messageRaw;
    if (!finalMessage && body && body.appointment) {
      const a = body.appointment;
      const appt = a.appointmentNumber || a.appointment_number || a.appointmentNo || '';
      const wb = a.weighbridgeNumber || a.weighbridge_number || a.weighbridge || '';
      const date = a.pickupDate || a.pickup_date || '';
      const truck = a.truckNumber || a.truck_number || '';
      const agent = (a.agentName || a.agent_name || '') || (body.recipients && body.recipients.agentName) || '';
      // Keep SMS short
      finalMessage = `Appointment ${appt}${wb ? ` | ${wb}` : ''}\nAgent: ${agent}\nDate: ${date}\nTruck: ${truck}\nReply for details.`;
    }

    if (!toRaw) {
      return res.status(400).json({ error: "Missing recipient phone (to or recipients.driverPhone)" });
    }
    if (!finalMessage) {
      return res.status(400).json({ error: "Missing message body (message) and no appointment info to build one" });
    }

    // Normalize number: ensure leading +
    const to = String(toRaw || '').trim();
    const toNormalized = to.startsWith('+') ? to : (to.match(/^\d+$/) ? `+${to}` : to);

    // Twilio envs
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const smsFrom    = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !smsFrom) {
      return res.status(500).json({ error: "Twilio environment variables not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER)" });
    }

    // Build Basic auth header (works both in Node and Edge runtimes)
    const basicAuthRaw = `${accountSid}:${authToken}`;
    let basicAuth = null;
    try {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        basicAuth = Buffer.from(basicAuthRaw).toString('base64');
      } else if (typeof btoa === 'function') {
        basicAuth = btoa(basicAuthRaw);
      } else if (typeof globalThis !== 'undefined' && typeof globalThis.btoa === 'function') {
        basicAuth = globalThis.btoa(basicAuthRaw);
      }
    } catch (e) {
      // ignore - we'll fallback below
    }
    if (!basicAuth) {
      try { basicAuth = Buffer.from(basicAuthRaw).toString('base64'); } catch (e) { /* final fallback */ }
    }

    if (!basicAuth) {
      return res.status(500).json({ error: "Could not create Basic auth header for Twilio" });
    }

    const form = new URLSearchParams();
    form.append('To', toNormalized);
    form.append('From', smsFrom);
    form.append('Body', String(finalMessage));

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

    const twRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    const twText = await twRes.text().catch(() => null);
    let twJson = null;
    try { twJson = twText ? JSON.parse(twText) : null; } catch (e) { twJson = { raw: twText }; }

    if (!twRes.ok) {
      // Twilio returned an error (bad number, auth problem, etc)
      // Mirror Twilio's status and response to help debugging in client logs.
      return res.status(twRes.status || 500).json({
        ok: false,
        error: 'Twilio API error',
        status: twRes.status,
        response: twJson,
      });
    }

    // success
    return res.status(200).json({
      ok: true,
      sid: twJson?.sid || null,
      twilio: twJson,
    });
  } catch (err) {
    console.error('sendSMS handler error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err?.message || String(err) });
  }
}
