// pages/api/admin/updateUserPassword.js
import { supabaseAdmin } from '../../../lib/supabaseServer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, password } = req.body;

  if (!userId || !password) {
    return res.status(400).json({ error: 'Missing userId or password' });
  }

  try {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('updateUserPassword API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
