// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

/**
 * Use Vite env vars (must be prefixed with VITE_).
 * Also support optional runtime injection via window.__env for flexibility
 * (useful when deploying to some hosts that inject envs at runtime).
 */

const getEnv = (key) => {
  // 1) Vite static envs (available at build time)
  const viteVal = import.meta.env?.[key];
  if (viteVal) return viteVal;

  // 2) Runtime-injected (optional) - window.__env
  if (typeof window !== 'undefined' && window.__env && window.__env[key]) {
    return window.__env[key];
  }

  // 3) fallback to null (we avoid using process.env in browser)
  return null;
};

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL') || 'https://trjwjsfcebucwrfeewyt.supabase.co';
const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY') || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyandqc2ZjZWJ3ZmVld3l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3MTAxNjQsImV4cCI6MjA3NDI4NjE2NH0.a_W5Ke9AvKhBLDSQNJ2uxP4N4lbP1rrZb-iHjOedopk';

// Basic sanity checks (helps quickly spot misconfig in prod)
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Make sure these are set in your .env (for local dev) and in your hosting env (Vercel/Netlify).'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10, // throttle live updates (optional)
    },
  },
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// default export for convenience (optional)
export default supabase;
