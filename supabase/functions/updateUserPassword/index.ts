// supabase/functions/updateUserPassword/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("Edge function loaded: updateUserPassword");

serve(async (req) => {
  // CORS response headers (tighten in production)
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*", // restrict to your origin in production
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  // Ensure required environment variables exist
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers,
    });
  }

  // Read and validate Authorization header (expecting "Bearer <access_token>")
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader) {
    return new Response(JSON.stringify({ code: 401, message: "Missing authorization header" }), {
      status: 401,
      headers,
    });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return new Response(JSON.stringify({ code: 401, message: "Malformed authorization header" }), {
      status: 401,
      headers,
    });
  }
  const accessToken = parts[1];

  // Create secure admin client (service role)
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify the caller's JWT so only authenticated users can call this function.
  // We verify by calling auth.getUser(accessToken). If invalid, reject.
  try {
    const { data: verifyData, error: verifyError } = await supabaseAdmin.auth.getUser(accessToken as string);
    if (verifyError || !verifyData?.user) {
      console.warn("Token verification failed:", verifyError);
      return new Response(JSON.stringify({ code: 401, message: "Invalid or expired token" }), {
        status: 401,
        headers,
      });
    }

    // Optionally you could add extra checks here:
    // e.g. ensure verifyData.user?.role includes allowed role, or only admins may change other passwords.
    // For example:
    // if (!allowedToUpdate(verifyData.user)) { ... }  <-- implement as desired

  } catch (err) {
    console.error("Error verifying token:", err);
    return new Response(JSON.stringify({ code: 500, message: "Failed to verify token" }), {
      status: 500,
      headers,
    });
  }

  // Parse body safely
  let body: any = {};
  try {
    body = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers,
    });
  }

  const userId = body?.userId ?? body?.user_id ?? body?.id;
  const password = body?.password ?? body?.new_password ?? body?.newPassword;

  if (!userId || !password) {
    return new Response(JSON.stringify({ error: "Missing userId or password in request body" }), {
      status: 400,
      headers,
    });
  }

  // Perform admin password update using service-role client
  try {
    // Prefer v2 admin API
    if (supabaseAdmin.auth?.admin && typeof supabaseAdmin.auth.admin.updateUserById === "function") {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(String(userId), { password: String(password) });
      if (error) {
        console.error("supabase admin update error (v2):", error);
        return new Response(JSON.stringify({ error: error.message || String(error) }), {
          status: 400,
          headers,
        });
      }
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers });
    }

    // Fallback to older SDK shape if present
    if (supabaseAdmin.auth?.api && typeof supabaseAdmin.auth.api.updateUserById === "function") {
      try {
        const resp = await supabaseAdmin.auth.api.updateUserById(String(userId), { password: String(password) });
        if (resp && resp.error) {
          console.error("supabase admin update error (v1):", resp.error);
          return new Response(JSON.stringify({ error: resp.error.message || String(resp.error) }), {
            status: 400,
            headers,
          });
        }
        return new Response(JSON.stringify({ success: true, data: resp }), { status: 200, headers });
      } catch (err) {
        console.error("Exception calling auth.api.updateUserById:", err);
        return new Response(JSON.stringify({ error: err?.message || "Failed to update password (v1 fallback)" }), {
          status: 500,
          headers,
        });
      }
    }

    // Final fallback: generic updateUser shape
    if (supabaseAdmin.auth && typeof supabaseAdmin.auth.updateUser === "function") {
      const resp = await supabaseAdmin.auth.updateUser({ id: String(userId), password: String(password) } as any);
      if (resp && resp.error) {
        return new Response(JSON.stringify({ error: resp.error.message || String(resp.error) }), {
          status: 400,
          headers,
        });
      }
      return new Response(JSON.stringify({ success: true, data: resp }), { status: 200, headers });
    }

    console.error("No admin update method available on supabaseAdmin.auth");
    return new Response(JSON.stringify({ error: "Server misconfiguration: admin update not available" }), {
      status: 500,
      headers,
    });
  } catch (err) {
    console.error("updateUserPassword exception:", err);
    const msg = (err && (err.message || String(err))) || "Internal server error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});
