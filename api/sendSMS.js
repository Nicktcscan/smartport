// pages/api/sendSMS.js
/**
 * sendSMS — Vercel → VPS Proxy → Comium (final, hardened)
 *
 * Flow:
 * Browser (HTTPS)
 *   → Vercel /api/sendSMS (HTTPS)
 *     → VPS SMS Proxy (server-to-server, x-proxy-key header)
 *       → Comium API (internal)
 *
 * Required env:
 *  - SMS_PROXY_BASE (e.g. https://your-proxy.example.com or http://ip:3000)
 *  - SMS_PROXY_KEY  (the x-proxy-key value accepted by your proxy)
 * Optional:
 *  - SENDSMS_API_KEY (optional API key for protecting the Vercel endpoint)
 *  - DEBUG=true to enable logs
 */

const ALLOWED_ORIGINS = [
  'https://weighbridge-gambia.com',
  'https://smartport-test.vercel.app'
];

const API_KEY = process.env.SENDSMS_API_KEY || null;

/**
 * 🔐 SAFETY GUARD (CRITICAL)
 * - strips trailing slashes
 * - strips accidental `/send-sms`
 * - guarantees clean base URL
 */
const SMS_PROXY_BASE = (process.env.SMS_PROXY_BASE || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/send-sms$/, '');

const SMS_PROXY_KEY = process.env.SMS_PROXY_KEY || process.env.PROXY_KEY || '';
const FROM = process.env.COMIUM_FROM || 'NICKTC';
const DEBUG = String(process.env.DEBUG || '').toLowerCase() === 'true';

const MAX_RETRIES = Number(process.env.SMS_PROXY_RETRIES || 3);
const RETRY_BASE_MS = Number(process.env.SMS_PROXY_RETRY_BASE_MS || 500);
const REQUEST_TIMEOUT_MS = Number(process.env.SMS_PROXY_TIMEOUT_MS || 20000);

/* -------------------- Logger -------------------- */
function log(...args) {
  if (DEBUG) console.log(new Date().toISOString(), ...args);
}

/* -------------------- CORS -------------------- */
function setCorsHeaders(req, res) {
  const origin = req.headers?.origin || null;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0]);
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
  const list = Array.isArray(input) ? input : String(input).split(',');
  return list
    .map(n =>
      String(n || '')
        .trim()
        .replace(/[^\d+]/g, '')
        .replace(/^\+/, '')
        .replace(/^00/, '')
    )
    .filter(Boolean)
    .join(',');
}

function buildAppointmentMessage(a = {}, r = {}) {
  const lines = [];
  if (a.appointmentNumber) lines.push(`APPT: ${a.appointmentNumber}`);
  if (a.weighbridgeNumber) lines.push(`WB Number: ${a.weighbridgeNumber}`);
  if (a.sadNumber) lines.push(`SAD Number: ${a.sadNumber}`);
  if (a.pickupDate) lines.push(`Pickup: ${a.pickupDate}`);
  if (a.truckNumber) lines.push(`Truck: ${a.truckNumber}`);
  if (a.driverName || r.driverName)
    lines.push(`Driver: ${a.driverName || r.driverName}`);
  if (a.ticketUrl) lines.push(`View ticket: ${a.ticketUrl}`);

  return `NICK TC-SCAN (GAMBIA) LTD.:\n${lines.join('\n')}`;
}

/* -------------------- Proxy POST -------------------- */
async function postToProxy(payload) {
  if (!SMS_PROXY_BASE) throw new Error('SMS_PROXY_BASE not configured');
  if (!SMS_PROXY_KEY) throw new Error('SMS_PROXY_KEY not configured');

  const url = `${SMS_PROXY_BASE}/send-sms`;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    let controller;

    try {
      log(
        'POST → SMS Proxy (attempt):',
        attempt,
        url,
        payload?.to ? `to=${payload.to}` : ''
      );

      controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-proxy-key': SMS_PROXY_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      const rawText = await resp.text().catch(() => null);
      let parsed;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = { raw: rawText };
      }

      if (!resp.ok) {
        log('Proxy non-OK:', resp.status, rawText);
        return { ok: false, status: resp.status, parsed, rawText };
      }

      log('Proxy success:', parsed);
      return { ok: true, status: resp.status, parsed, rawText };
    } catch (err) {
      const isLast = attempt >= MAX_RETRIES;
      log(
        `Proxy attempt ${attempt} failed:`,
        err?.message || err,
        isLast ? 'LAST' : 'retrying'
      );

      if (isLast) {
        return { ok: false, error: err?.message || String(err) };
      }

      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  return { ok: false, error: 'exhausted_retries' };
}

/* -------------------- Body Reader -------------------- */
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
    req.on('error', () => resolve({}));
  });
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
    const key = String(
      req.headers['x-api-key'] || req.headers.authorization || ''
    );
    if (!key || key !== API_KEY) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      info: 'POST { to, message } or { appointment, recipients }',
      proxyBase: SMS_PROXY_BASE
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = await readBody(req);

    const to =
      body.to ||
      body.recipients?.driverPhone ||
      body.recipients?.phone ||
      null;

    const message =
      body.message ||
      body.text ||
      (body.appointment
        ? buildAppointmentMessage(body.appointment, body.recipients)
        : null);

    if (!to || !message) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing recipient or message' });
    }

    const payload = {
      from: body.from || FROM,
      to: normalizeNumber(to),
      text: String(message)
    };

    const proxyResp = await postToProxy(payload);

    if (!proxyResp.ok) {
      console.error('sendSMS proxy error:', proxyResp);
      return res
        .status(502)
        .json({ ok: false, error: 'proxy_error', details: proxyResp });
    }

    return res.status(200).json({
      ok: true,
      provider: 'comium-via-proxy',
      result: proxyResp.parsed || null
    });
  } catch (err) {
    console.error('sendSMS handler error:', err);
    return res.status(502).json({
      ok: false,
      error: 'internal_error',
      details: err?.message || String(err)
    });
  }
}
