// pages/api/admin/updateUserPassword.js
import { supabaseAdmin } from '../../../lib/supabaseServer';

export default async function handler(req, res) {
  // Allow preflight
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Adjust origin as needed; for same-origin apps you may remove or scope this
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
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
    // call supabaseAdmin to update password (server side, service role)
    const resp = await supabaseAdmin.auth.admin.updateUserById(userId, { password });

    // resp may contain { user, error } or { data, error } depending on SDK version
    const err = resp?.error;
    if (err) {
      const msg = err?.message || JSON.stringify(err);
      console.error('supabase admin update error:', err);
      return res.status(400).json({ error: msg });
    }

    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('updateUserPassword API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
