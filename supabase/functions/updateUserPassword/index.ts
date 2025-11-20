// supabase/functions/updateUserPassword/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("Edge function loaded: updateUserPassword");

serve(async (req) => {
  // Allow CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",       // restrict in production
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  const { userId, password } = await req.json();

  if (!userId || !password) {
    return new Response(JSON.stringify({ error: "Missing userId or password" }), {
      status: 400,
      headers,
    });
  }

  // Secure Supabase Admin Client
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers,
      });
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
      status: 500,
      headers,
    });
  }
});
