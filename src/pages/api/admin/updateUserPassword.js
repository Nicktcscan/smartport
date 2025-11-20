import { supabaseAdmin } from '../../../lib/supabaseServer';

export default async function handler(req, res) {
  // Basic CORS for testing environments — scope this to your origin in production.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    // Use the server-side supabaseAdmin client (must be instantiated with service_role)
    const resp = await supabaseAdmin.auth.admin.updateUserById(userId, { password });

    // Different SDK versions return different shapes; check for .error
    const err = resp?.error;
    if (err) {
      const msg = err?.message || JSON.stringify(err);
      console.error('supabase admin update error:', err);
      return res.status(400).json({ error: msg });
    }

    // Some SDK versions return { data, user } etc — we just confirm success
    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('updateUserPassword API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
