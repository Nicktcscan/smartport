// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://trjwjsfcebucwrfeewyt.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyandqc2ZjZWJ1Y3dyZmVld3l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3MTAxNjQsImV4cCI6MjA3NDI4NjE2NH0.a_W5Ke9AvKhBLDSQNJ2uxP4N4lbP1rrZb-iHjOedopk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10, // optional throttling for live updates
    },
  },
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
  },
});
