// pages/api/admin/updateUserPassword.js
import { supabaseAdmin } from '../../../lib/supabaseServer';

/**
 * Server endpoint to update a user's password using the Supabase service_role client.
 * - Expects POST { userId, password }
 * - Handles OPTIONS preflight.
 * - Tries both v2 and v1 admin API shapes (auth.admin.updateUserById || auth.api.updateUserById).
 *
 * Notes:
 * - Make sure this file lives at pages/api/admin/updateUserPassword.js (Next.js API route).
 * - Ensure `supabaseAdmin` is a server-side Supabase client initialised with your service_role key.
 */

/**
 * Optional Next.js API config (keeps default body parsing enabled).
 * If you are using a custom raw-body parser elsewhere you can remove/adjust this.
 */
export const config = {
  api: {
    bodyParser: true,
  },
};

const DEFAULT_CORS_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function setCorsHeaders(res) {
  // In production replace '*' with your allowed origin (e.g. https://app.example.com)
  res.setHeader('Access-Control-Allow-Origin', DEFAULT_CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // allow Content-Type so browser can send JSON; allow Authorization if you use it
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // allow credentials if you need cookies/auth (set to 'true' only for trusted origins)
  // res.setHeader('Access-Control-Allow-Credentials', 'true');
}

async function tryParseBody(req) {
  // Next.js usually parses JSON into req.body; fallback to raw parsing if empty.
  if (req.body && Object.keys(req.body).length) return req.body;
  try {
    const text = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', (e) => reject(e));
    });
    if (!text) return {};
    return JSON.parse(text);
  } catch (err) {
    // can't parse raw body — return empty object
    return {};
  }
}

export default async function handler(req, res) {
  try {
    setCorsHeaders(res);

    // Respond to preflight quickly
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(405).json({ error: `Method ${req.method} not allowed. Use POST.` });
    }

    // parse body defensively
    const body = await tryParseBody(req);
    const { userId, password } = body || {};

    if (!userId || !password) {
      return res.status(400).json({ error: 'Missing userId or password in request body' });
    }

    // sanity check for supabaseAdmin
    if (!supabaseAdmin || !supabaseAdmin.auth) {
      console.error('supabaseAdmin not configured or missing auth client');
      return res.status(500).json({ error: 'Server misconfiguration: supabaseAdmin not available' });
    }

    // Try v2 admin API: supabaseAdmin.auth.admin.updateUserById
    if (supabaseAdmin.auth.admin && typeof supabaseAdmin.auth.admin.updateUserById === 'function') {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
        if (error) {
          console.error('supabase admin (v2) update error:', error);
          // forward 400 for auth errors from Supabase
          return res.status(400).json({ error: error.message || String(error) });
        }
        return res.status(200).json({ message: 'Password updated successfully', data });
      } catch (err) {
        console.error('Exception calling supabaseAdmin.auth.admin.updateUserById', err);
        // allow fallback to older API below
      }
    }

    // Fallback: older SDK shape (v1): supabaseAdmin.auth.api.updateUserById
    if (supabaseAdmin.auth.api && typeof supabaseAdmin.auth.api.updateUserById === 'function') {
      try {
        const resp = await supabaseAdmin.auth.api.updateUserById(userId, { password });
        // older SDK often returns { user, error } or throws — attempt to normalise
        if (resp && resp.error) {
          console.error('supabase admin (v1) update error:', resp.error);
          return res.status(400).json({ error: resp.error.message || String(resp.error) });
        }
        return res.status(200).json({ message: 'Password updated successfully', data: resp });
      } catch (err) {
        console.error('Exception calling supabaseAdmin.auth.api.updateUserById', err);
        return res.status(500).json({ error: err?.message || 'Failed to update password' });
      }
    }

    // Some SDKs expose a different helper; try generic 'updateUser' if present
    if (supabaseAdmin.auth && typeof supabaseAdmin.auth.updateUser === 'function') {
      try {
        const resp = await supabaseAdmin.auth.updateUser({ id: userId, password });
        // check common shapes
        if (resp && resp.error) {
          return res.status(400).json({ error: resp.error.message || String(resp.error) });
        }
        return res.status(200).json({ message: 'Password updated successfully', data: resp });
      } catch (err) {
        console.error('supabaseAdmin.auth.updateUser error', err);
        return res.status(500).json({ error: err?.message || 'Failed to update password' });
      }
    }

    // If we reach here, no supported admin method exists on the SDK object
    console.error('No admin updateUser method available on supabaseAdmin.auth');
    return res.status(500).json({ error: 'Server misconfiguration: admin update not available' });
  } catch (err) {
    console.error('updateUserPassword API exception (outer):', err);
    const status = err?.status && Number.isFinite(Number(err.status)) ? Number(err.status) : 500;
    return res.status(status).json({ error: err?.message || 'Internal server error' });
  }
}