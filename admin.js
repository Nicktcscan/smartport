// server-side endpoint for Users CRUD
import supabaseAdmin from '../../../lib/supabaseAdmin';

export default async function handler(req, res) {
  const { method } = req;

  try {
    if (method === 'GET') {
      // List users (auth + table combined if needed)
      const { users, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) return res.status(400).json({ error });

      // fetch additional profile info from users table
      const { data: profiles } = await supabaseAdmin.from('users').select('*');
      // merge
      const merged = users.map((u) => ({
        ...u,
        ...profiles.find((p) => p.id === u.id),
      }));
      return res.status(200).json({ users: merged });
    }

    if (method === 'POST') {
      // Create user
      const { full_name, email, password, role } = req.body;
      if (!email || !password || !full_name || !role) return res.status(400).json({ error: 'Missing required fields' });

      const { user, error: createErr } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
      if (createErr) return res.status(400).json({ error: createErr });

      const username = generateUsername(full_name);
      const { data, error: insertErr } = await supabaseAdmin.from('users').insert([{
        id: user.id,
        full_name,
        email,
        role,
        username,
      }]).select().single();
      if (insertErr) return res.status(400).json({ error: insertErr });

      return res.status(200).json({ user: data });
    }

    if (method === 'PUT') {
      // Update user info
      const { id, full_name, email, role, password } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing user id' });

      const { data, error: updateErr } = await supabaseAdmin.from('users').update({ full_name, email, role }).eq('id', id).select().single();
      if (updateErr) return res.status(400).json({ error: updateErr });

      if (password && password.length >= 6) {
        const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
        if (pwErr) console.warn('Password update failed', pwErr);
      }

      return res.status(200).json({ user: data });
    }

    if (method === 'DELETE') {
      // Delete user
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing user id' });

      await supabaseAdmin.from('users').delete().eq('id', id);
      await supabaseAdmin.auth.admin.deleteUserById(id);

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

// helper: username generator
function generateUsername(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  const firstInitial = parts[0] ? parts[0][0].toUpperCase() : '';
  const last = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  return `${firstInitial}${last}`.replace(/[^a-z0-9_]/gi, '');
}
