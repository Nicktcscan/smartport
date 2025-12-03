// pages/api/notify-appointment.js
// Next.js / Vercel serverless API route that proxies requests to a Supabase Edge Function
// - Handles CORS preflight
// - Forwards POST body to Supabase function using SERVICE_ROLE_KEY (server-side only)
// - Returns proxied response and preserves useful info to client

async function getFetch() {
  // eslint-disable-next-line no-undef
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  // dynamic import for older runtimes
  const mod = await import('node-fetch');
  return mod.default || mod;
}

function buildCorsHeaders(req) {
  const reqOrigin = (req.headers && req.headers.origin) || '';
  const origin = reqOrigin || '*';
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, apikey, X-Requested-With, Accept, Origin',
    'Access-Control-Expose-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
  // only set allow-credentials when a specific origin is present
  if (origin && origin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

export default async function handler(req, res) {
  const corsHeaders = buildCorsHeaders(req);

  // Always set CORS headers early
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  // Handle preflight
  if (req.method === 'OPTIONS') {
    // 204 No Content for preflight
    res.status(204).end();
    return;
  }

  // Simple health check for GET
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ ok: true, msg: 'notify-appointment proxy running' });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    res.status(405).json({ ok: false, error: 'Method not allowed, use POST' });
    return;
  }

  // At this point we have a POST
  try {
    // Parse body reliably (Next.js may have parsed it already)
    let body = req.body;
    if (!body) {
      // attempt to read raw body
      body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => {
          if (!data) return resolve({});
          try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); }
        });
        req.on('error', reject);
      });
    }

    // Resolve the Supabase Functions URL and service key from env
    const SUPABASE_FUNCTIONS_URL = (process.env.SUPABASE_FUNCTIONS_URL || '').replace(/\/+$/, '');
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

    if (!SUPABASE_FUNCTIONS_URL) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ ok: false, error: 'SUPABASE_FUNCTIONS_URL not configured on server' });
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured on server' });
    }

    // Build target function endpoint (append function path)
    const functionUrl = `${SUPABASE_FUNCTIONS_URL}/notify-appointment`;

    const fetchFn = await getFetch();

    const forwardResp = await fetchFn(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(body),
    });

    const text = await forwardResp.text().catch(() => null);
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }

    // Mirror back status and data in a predictable shape
    res.setHeader('Content-Type', 'application/json');
    return res.status(forwardResp.status).json({
      ok: forwardResp.ok,
      status: forwardResp.status,
      forwardedTo: functionUrl,
      data: parsed,
    });
  } catch (err) {
    console.error('notify-appointment proxy error:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ ok: false, error: err?.message || 'Proxy unexpected error' });
  }
}
