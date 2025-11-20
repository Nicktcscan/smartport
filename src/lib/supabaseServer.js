// lib/supabaseServer.js
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  'https://cgyjradpttmdancexdem.supabase.co', // your supabase URL
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNneWpyYWRwdHRtZGFuY2V4ZGVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDU1OTMzNywiZXhwIjoyMDcwMTM1MzM3fQ.6n_T0fQawkfLNcgK9rWIM5ovrNya6EAiyWNMC4ueCWo' // service role key
);
