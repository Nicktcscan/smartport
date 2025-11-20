// pages/api/admin/updateUserPassword.js
import { supabaseAdmin } from '../../../lib/supabaseServer';

/**
 * Server endpoint to update a user's password using the Supabase service_role client.
 * - Expects POST { userId, password }
 * - Handles OPTIONS preflight.
 * - Tries both v2 and v1 admin API shapes (auth.admin.updateUserById || auth.api.updateUserById).
 */

export default async function handler(req, res) {
  // CORS: allow preflight and POST. In production lock down Access-Control-Allow-Origin.
  res.setHeader('Access-Control-Allow-Origin', '*'); // restrict this in prod
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    // Preflight
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, password } = req.body || {};

  if (!userId || !password) {
    return res.status(400).json({ error: 'Missing userId or password' });
  }

  try {
    if (!supabaseAdmin || !supabaseAdmin.auth) {
      console.error('supabaseAdmin not configured or missing auth client');
      return res.status(500).json({ error: 'Server misconfiguration: supabaseAdmin not available' });
    }

    // Prefer v2 admin API shape: supabase.auth.admin.updateUserById
    if (supabaseAdmin.auth.admin && typeof supabaseAdmin.auth.admin.updateUserById === 'function') {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (error) {
        console.error('supabase admin (v2) update error:', error);
        return res.status(400).json({ error: error.message || String(error) });
      }
      return res.status(200).json({ message: 'Password updated successfully', data });
    }

    // Fallback: older SDK shape (v1): supabase.auth.api.updateUserById
    if (supabaseAdmin.auth.api && typeof supabaseAdmin.auth.api.updateUserById === 'function') {
      const resp = await supabaseAdmin.auth.api.updateUserById(userId, { password });
      // older SDK often returns user object or throws; handle both
      if (resp && resp.error) {
        console.error('supabase admin (v1) update error:', resp.error);
        return res.status(400).json({ error: resp.error.message || String(resp.error) });
      }
      return res.status(200).json({ message: 'Password updated successfully', data: resp });
    }

    // If neither exists, we can't perform admin update
    console.error('No admin updateUserById method available on supabaseAdmin.auth');
    return res.status(500).json({ error: 'Server misconfiguration: admin update not available' });
  } catch (err) {
    console.error('updateUserPassword API exception:', err);
    // If the error object contains a status from Supabase, forward it where sensible
    const status = err?.status && Number.isFinite(Number(err.status)) ? Number(err.status) : 500;
    return res.status(status).json({ error: err?.message || 'Internal server error' });
  }
}
