// pages/api/sendSMS.js
/**
 * sendSMS — Browser → Vercel API → VPS SMS Proxy → Comium
 *
 * Required ENV:
 *  - SMS_PROXY_BASE   (e.g. http://184.174.39.218:3000)
 *  - PROXY_KEY        (used as x-proxy-key)
 *
 * Optional:
 *  - SENDSMS_API_KEY  (protects this endpoint)
 *  - DEBUG=true
 */

const DEBUG = String(process.env.DEBUG || '').toLowerCase() === 'true';

/* -------------------- ENV -------------------- */
const SMS_PROXY_BASE = (process.env.SMS_PROXY_BASE || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/send-sms$/, '');

const PROXY_KEY = process.env.PROXY_KEY || '';
const API_KEY = process.env.SENDSMS_API_KEY || null;
const FROM = process.env.COMIUM_FROM || 'NICKTC';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 20000;

/* -------------------- Logger -------------------- */
function log(...args) {
  if (DEBUG) console.log(new Date().toISOString(), ...args);
}

/* -------------------- CORS -------------------- */
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  // Allow same-origin / server-side
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return true;
  }

  // Allow production + vercel
  if (
    origin === 'https://weighbridge-gambia.com' ||
    origin === 'https://www.weighbridge-gambia.com' ||
    origin.endsWith('.vercel.app')
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    return false;
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-api-key'
  );
  res.setHeader('Vary', 'Origin');

  return true;
}

/* -------------------- Helpers -------------------- */
function normalizeNumber(input) {
  if (!input) return '';
  return String(input)
    .split(',')
    .map(n =>
      n
        .trim()
        .replace(/[^\d+]/g, '')
        .replace(/^\+/, '')
        .replace(/^00/, '')
    )
    .filter(Boolean)
    .join(',');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

/* -------------------- Proxy Call -------------------- */
async function sendViaProxy(payload) {
  if (!SMS_PROXY_BASE) throw new Error('SMS_PROXY_BASE not set');
  if (!PROXY_KEY) throw new Error('PROXY_KEY not set');

  const url = `${SMS_PROXY_BASE}/send-sms`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log(`Proxy attempt ${attempt}`, url, payload.to);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-proxy-key': PROXY_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      const text = await resp.text();
      const json = text ? JSON.parse(text) : null;

      if (!resp.ok) {
        log('Proxy error:', resp.status, json);
        return { ok: false, status: resp.status, json };
      }

      return { ok: true, json };
    } catch (err) {
      log(
        `Proxy failed (${attempt}/${MAX_RETRIES}):`,
        err.message
      );

      if (attempt === MAX_RETRIES) {
        throw err;
      }

      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

/* -------------------- Handler -------------------- */
export default async function handler(req, res) {
  if (!setCorsHeaders(req, res)) {
    return res.status(403).json({ ok: false, error: 'CORS blocked' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (API_KEY) {
    const key =
      req.headers['x-api-key'] ||
      req.headers.authorization ||
      '';

    if (key !== API_KEY) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      proxy: SMS_PROXY_BASE
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = await readBody(req);

    const to =
      body.to ||
      body.phone ||
      body.recipients?.phone ||
      body.recipients?.driverPhone;

    const message = body.message || body.text;

    if (!to || !message) {
      return res.status(400).json({
        ok: false,
        error: 'Missing recipient or message'
      });
    }

    const payload = {
      from: body.from || FROM,
      to: normalizeNumber(to),
      text: String(message)
    };

    const result = await sendViaProxy(payload);

    return res.status(200).json({
      ok: true,
      provider: 'comium',
      result: result.json
    });
  } catch (err) {
    console.error('sendSMS error:', err);
    return res.status(502).json({
      ok: false,
      error: 'SMS delivery failed',
      details: err.message
    });
  }
}
