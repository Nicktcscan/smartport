// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * Use Vite env vars (prefixed with VITE_). For local dev put them in your project root .env
 * For production (Vercel) set them in Project > Settings > Environment Variables.
 *
 * NOTE: Do NOT use your SERVICE ROLE key in the client — only the ANON key.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Helpful diagnostic in dev console
  // (Don't commit secrets to git; set them in Vercel for production)
  // eslint-disable-next-line no-console
  console.error('❌ Missing Supabase env vars. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.');
}

/**
 * createClient options:
 * - auth.detectSessionInUrl: helps when using magic links / OAuth redirects
 * - auth.persistSession: store session in localStorage
 * - realtime.params.eventsPerSecond: throttle realtime events
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  // global fetch headers can be added here if you need custom headers
  // global: { headers: { 'X-My-App': 'smartport-weighbridge' } },
});
