// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL ||
  'https://cgyjradpttmdancexdem.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNneWpyYWRwdHRtZGFuY2V4ZGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ1NTkzMzcsImV4cCI6MjA3MDEzNTMzN30.A9ps6I1p-GC7Anj1mLoLUy_c1sRXXZ_o3EaMDFT1Tcw';

// Create the Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10, // throttle live updates if needed
    },
  },
  auth: {
    persistSession: true,      // keep session after refresh
    detectSessionInUrl: true,  // handle OAuth callbacks
    autoRefreshToken: true,    // refresh tokens in THIS tab
    multiTab: true,           // 🚫 disable cross-tab sync (prevents unwanted auto-refresh)
    storage: window.localStorage, // ✅ store session only in this tab
  },
});
