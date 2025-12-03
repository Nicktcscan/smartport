// api/notify-appointment.js
// Vercel serverless function (Node) — proxy to Supabase Edge Function to avoid browser CORS issues.
// Add to your project under /api/notify-appointment.js (or /api/notify-appointment/index.js)

const fetch = global.fetch || require('node-fetch');

function buildCorsHeaders(req) {
  const reqOrigin = (req.headers && req.headers.origin) || '';
  const origin = reqOrigin || '*';
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,PUT,PATCH,DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, apikey, X-Requested-With, accept, origin',
    'Access-Control-Expose-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
  // Only set credentials header when origin is explicit (not wildcard)
  if (origin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

module.exports = async function handler(req, res) {
  const corsHeaders = buildCorsHeaders(req);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }

  // Only accept POST (you can keep GET health-check if you like)
  if (req.method === 'GET') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(JSON.stringify({ ok: true, msg: 'notify-appointment proxy running' }));
  }

  if (req.method !== 'POST') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Read body (works for both bodyParser enabled frameworks).
    const body = req.body && Object.keys(req.body).length ? req.body : await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
      });
      req.on('error', reject);
    });

    // Supabase function URL (set in Vercel env): e.g. https://<project>.supabase.co/functions/v1/notify-appointment
    const SUPABASE_FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;
    // Use service role for server-to-server calls (stored securely in Vercel env)
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_FUNCTIONS_URL) {
      Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(500).json({ ok: false, error: 'SUPABASE_FUNCTIONS_URL not configured on server' });
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured on server' });
    }

    const functionUrl = SUPABASE_FUNCTIONS_URL.replace(/\/+$/, '') + '/notify-appointment';

    // Forward request to Supabase Edge Function. Include server-side key in Authorization & apikey headers.
    const forwardResp = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Provide server-side credentials — safe because this function runs server-side on Vercel.
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(body),
    });

    // Read response body as text then try to parse JSON
    const text = await forwardResp.text().catch(() => null);
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }

    // Mirror status and body back to client; include CORS headers.
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json');
    res.status(forwardResp.status).send(JSON.stringify({ ok: forwardResp.ok, status: forwardResp.status, data: parsed }));
  } catch (err) {
    console.error('Proxy error', err);
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ ok: false, error: err?.message || 'Proxy unexpected error' });
  }
};
