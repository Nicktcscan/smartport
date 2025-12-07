// pages/api/sendSMS.js
// or: src/pages/api/sendSMS.js
// or for Vercel Serverless: /api/sendSMS.js
//
// Environment variables required:
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN
// - TWILIO_PHONE_NUMBER  (the Twilio sender number, e.g. +1xxx)
// Optional:
// - SENDSMS_ALLOWED_ORIGIN (defaults to '*', set to your frontend origin for safety)

export default async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.SENDSMS_ALLOWED_ORIGIN || '*';

  // Always include CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // If you want credentials (cookies), set Access-Control-Allow-Credentials and handle accordingly.

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};

    // Accept either:
    // - { to, message }  OR
    // - notify body: { appointment: {...}, recipients: { driverPhone, agentName }, pdfUrl }
    const toRaw = body.to || (body.recipients && (body.recipients.driverPhone || body.recipients.to)) || null;
    const messageRaw = body.message || null;

    // Build a reasonable SMS message if full notify object supplied & message not provided
    let finalMessage = messageRaw;
    if (!finalMessage && body.appointment) {
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
    let basicAuth;
    try {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        basicAuth = Buffer.from(basicAuthRaw).toString('base64');
      } else if (typeof btoa === 'function') {
        basicAuth = btoa(basicAuthRaw);
      } else if (typeof globalThis !== 'undefined' && typeof globalThis.btoa === 'function') {
        basicAuth = globalThis.btoa(basicAuthRaw);
      } else {
        // fallback: very small base64 encoder for ASCII subset
        basicAuth = Buffer ? Buffer.from(basicAuthRaw).toString('base64') : (function(str){
          // crude fallback for ASCII only (shouldn't be needed in Node / Vercel)
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
          let output = '';
          let i = 0;
          while (i < str.length) {
            const [c1, c2, c3] = [str.charCodeAt(i++), str.charCodeAt(i++), str.charCodeAt(i++)];
            const enc1 = c1 >> 2;
            const enc2 = ((c1 & 3) << 4) | (c2 >> 4);
            const enc3 = ((c2 & 15) << 2) | (c3 >> 6);
            const enc4 = c3 & 63;
            if (isNaN(c2)) { output += chars.charAt(enc1) + chars.charAt(enc2) + '=='; }
            else if (isNaN(c3)) { output += chars.charAt(enc1) + chars.charAt(enc2) + chars.charAt(enc3) + '='; }
            else { output += chars.charAt(enc1) + chars.charAt(enc2) + chars.charAt(enc3) + chars.charAt(enc4); }
          }
          return output;
        })(basicAuthRaw);
      }
    } catch (e) {
      // Best effort - if this fails we'll attempt to use Buffer and let runtime throw meaningful error
      basicAuth = (typeof Buffer !== 'undefined') ? Buffer.from(basicAuthRaw).toString('base64') : null;
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
