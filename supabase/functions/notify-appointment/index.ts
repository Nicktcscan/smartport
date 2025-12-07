// supabase/functions/notify-appointment/index.ts
// Deno-based Supabase Edge Function — lightweight, no Node SDKs at top-level.
// Purpose:
//  1) handle CORS correctly including a very fast OPTIONS preflight (204),
//  2) optionally upload PDF to Supabase Storage using service role,
//  3) PATCH appointment with pdf_url,
//  4) send SMS via Twilio REST API.
// This file intentionally avoids heavy imports that cause runtime failures in the edge runtime.

type BodyPayload = {
  apiKey?: string;
  appointment?: Record<string, any>;
  pdfBase64?: string | null;
  pdfFilename?: string | null;
  recipients?: {
    driverPhone?: string;
    agentName?: string;
  };
};

function log(...args: any[]) {
  try { console.log(...args); } catch (_) {}
}

/** Mask a secret for safe logging (don't print full secret in logs) */
function maskSecret(s: string | null | undefined) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= 12) return '••••••••';
  return `${str.slice(0, 4)}…${str.slice(-4)}`;
}

/**
 * Build CORS headers.
 * Behavior:
 *  - If CORS_ORIGIN env is set and looks like a real origin (startsWith http or contains * or comma list),
 *    it will be used as an allow-list (if list contains the request origin it will echo it).
 *  - If CORS_ORIGIN is not set or looks invalid (e.g. the dashboard shows a SHA256 digest), the function will
 *    echo the request origin if present, otherwise fall back to "*".
 */
function buildCorsHeaders(req?: Request) {
  let rawEnv = '';
  try {
    rawEnv = (typeof Deno !== "undefined" ? (Deno.env.get("CORS_ORIGIN") || "") : "") as string;
  } catch (e) {
    rawEnv = "";
  }

  const reqOrigin = req && req.headers.get("origin") ? req.headers.get("origin")! : "";
  let origin = "*";

  const envTrim = String(rawEnv || "").trim();
  if (envTrim) {
    const parts = envTrim.split(",").map(p => p.trim()).filter(Boolean);
    // Decide if env value appears to be an origin list (contains http(s) or wildcard)
    const seemsLikeOrigins = parts.some(p => p === "*" || p.startsWith("http://") || p.startsWith("https://") || p.includes("*"));
    if (seemsLikeOrigins) {
      // If the request origin exactly matches or matches wildcard pattern, echo it back.
      if (reqOrigin && parts.some(p => p === "*" || p === reqOrigin || (p.endsWith("*") && reqOrigin.startsWith(p.replace(/\*+$/,''))))) {
        origin = reqOrigin || "*";
      } else if (parts.includes("*")) {
        origin = "*";
      } else {
        // fallback to first configured origin (useful for single-value config)
        origin = parts[0];
      }
    } else {
      // If the env value doesn't look like an origin list (dashboard may show hash),
      // prefer echoing the request origin (safe fallback).
      origin = reqOrigin || "*";
    }
  } else {
    origin = reqOrigin || "*";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,PATCH,DELETE",
    // include common headers used by browsers / supabase client
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, apikey, X-Requested-With, accept, origin, x-client-info",
    "Access-Control-Expose-Headers": "Content-Type, Location",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };

  if (origin && origin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

function textResponse(body: string, status = 200, req?: Request) {
  const h = buildCorsHeaders(req);
  h["Content-Type"] = "text/plain";
  return new Response(body, { status, headers: h });
}

function jsonResponse(obj: any, status = 200, req?: Request) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: buildCorsHeaders(req),
  });
}

function okResponse(obj: any, req?: Request) {
  return jsonResponse(obj, 200, req);
}

// decode base64 to Uint8Array (atob available in Deno runtime)
function decodeBase64ToUint8Array(b64: string) {
  const binStr = atob(b64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

/** Small Twilio helper using fetch + Basic Auth (no SDK). */
async function sendSmsViaTwilioRest(
  accountSid: string,
  authToken: string,
  fromOrMessagingServiceSid: { from?: string; messagingServiceSid?: string },
  to: string,
  body: string
) {
  try {
    if (!accountSid || !authToken) {
      return { ok: false, error: "Twilio credentials not configured (server-side)" };
    }
    if (!to) return { ok: false, error: "Missing recipient phone" };

    const auth = `${accountSid}:${authToken}`;
    const basic = (typeof btoa === "function")
      ? btoa(auth)
      : (typeof (globalThis as any).Buffer !== "undefined" ? (globalThis as any).Buffer.from(auth).toString("base64") : "");

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const params = new URLSearchParams();
    params.append("To", to);
    params.append("Body", body);
    if (fromOrMessagingServiceSid.messagingServiceSid) {
      params.append("MessagingServiceSid", fromOrMessagingServiceSid.messagingServiceSid);
    } else if (fromOrMessagingServiceSid.from) {
      params.append("From", fromOrMessagingServiceSid.from);
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const text = await resp.text().catch(() => null);
    if (!resp.ok) {
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : text; } catch (_) { parsed = text; }
      return { ok: false, status: resp.status, error: parsed || `Twilio returned ${resp.status}` };
    }
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
    return { ok: true, sid: parsed?.sid || null, status: parsed?.status || "queued", raw: parsed };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Attempt to read header key in several common names */
function readApiKeyFromRequest(req: Request) {
  const h = req.headers;
  // prefer explicit apikey or x-api-key
  const direct = h.get("apikey") || h.get("x-api-key") || h.get("x-api_key") || h.get("x-apikey");
  if (direct) return direct.trim();
  // Authorization: Bearer <token>
  const auth = h.get("authorization") || h.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export const handler = async (req: Request): Promise<Response> => {
  try {
    // VERY IMPORTANT: handle preflight immediately before any heavy runtime work
    if (req.method === "OPTIONS") {
      // quick debug log (masked)
      try {
        const rawEnv = (typeof Deno !== "undefined" ? (Deno.env.get("CORS_ORIGIN") || "") : "") as string;
        log("OPTIONS preflight; request Origin:", req.headers.get("origin") || "-", "CORS_ORIGIN(masked):", maskSecret(rawEnv));
      } catch (_) { /* ignore */ }

      return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
    }

    const originHeader = req.headers.get("origin") || "-";
    log("notify-appointment invoked; Origin:", originHeader, "Method:", req.method);

    // Simple health-check
    if (req.method === "GET") {
      return textResponse("notify-appointment: ok", 200, req);
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, req);
    }

    // parse JSON body safely
    const body = (await req.json().catch(() => ({}))) as BodyPayload;

    // runtime env (read inside handler)
    const SUPABASE_URL = (((() => { try { return Deno.env.get("SUPABASE_URL") || ""; } catch(_) { return ""; } })()) as string).replace(/\/+$/, "");
    const SUPABASE_SERVICE_ROLE_KEY = (() => { try { return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; } catch(_) { return ""; } })() as string;
    const NOTIFY_API_KEY = (() => { try { return Deno.env.get("NOTIFY_API_KEY") || ""; } catch(_) { return ""; } })() as string;
    const TWILIO_ACCOUNT_SID = (() => { try { return Deno.env.get("TWILIO_ACCOUNT_SID") || ""; } catch(_) { return ""; } })() as string;
    const TWILIO_AUTH_TOKEN = (() => { try { return Deno.env.get("TWILIO_AUTH_TOKEN") || ""; } catch(_) { return ""; } })() as string;
    const TWILIO_FROM = (() => { try { return Deno.env.get("TWILIO_FROM") || ""; } catch(_) { return ""; } })() as string;
    const TWILIO_MESSAGING_SERVICE_SID = (() => { try { return Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || ""; } catch(_) { return ""; } })() as string;

    // safe debug logs (masked)
    log("Runtime env (masked): SUPABASE_URL:", maskSecret(SUPABASE_URL), "SUPABASE_SERVICE_ROLE_KEY:", maskSecret(SUPABASE_SERVICE_ROLE_KEY), "TWILIO_ACCOUNT_SID:", maskSecret(TWILIO_ACCOUNT_SID));

    if (NOTIFY_API_KEY) {
      log("NOTIFY_API_KEY is set (will be enforced).");
    }

    // Validate API key if configured
    const apiKeyFromReq = readApiKeyFromRequest(req) || (body && body.apiKey ? String(body.apiKey).trim() : null);
    if (NOTIFY_API_KEY && String(NOTIFY_API_KEY).trim() !== "") {
      // If NOTIFY_API_KEY is set, require match
      if (!apiKeyFromReq || apiKeyFromReq !== String(NOTIFY_API_KEY).trim()) {
        log("Auth failed: provided key", maskSecret(apiKeyFromReq || ""), "expected", maskSecret(NOTIFY_API_KEY));
        return jsonResponse({ ok: false, error: "Unauthorized: missing or invalid api key" }, 401, req);
      }
    }

    const { appointment, pdfBase64, pdfFilename, recipients } = body || {};
    if (!appointment || !appointment.id) {
      return jsonResponse({ ok: false, error: "Missing appointment (id) in request body" }, 400, req);
    }

    // derive driver phone - prefer explicit recipients.driverPhone, then appointment fields (various names)
    const driverPhone =
      (recipients && recipients.driverPhone) ||
      (appointment.driverPhone || appointment.driverLicense || appointment.driver_phone || appointment.driver_license) ||
      null;

    const apptNo = (appointment.appointmentNumber || appointment.appointment_number || appointment.appointmentNo || "").toString().trim();
    const wbNo = (appointment.weighbridgeNumber || appointment.weighbridge_number || appointment.weighbridgeNo || "").toString().trim();
    const pickup = (appointment.pickupDate || appointment.pickup_date || "").toString().trim();
    const truck = (appointment.truckNumber || appointment.truck_number || "").toString().trim();
    const drvName = (appointment.driverName || appointment.driver_name || "").toString().trim();

    function isValidPhone(phone: string | null | undefined) {
      if (!phone || typeof phone !== "string") return false;
      // require E.164-ish: + and at least 6 digits (some international numbers shorter), up to 20 digits
      return /^\+\d{6,20}$/.test(phone.trim());
    }

    // Step 1: upload PDF (if provided) to Storage using SUPABASE_SERVICE_ROLE_KEY
    let uploadedPublicUrl: string | null = null;
    let uploadedPath: string | null = null;
    try {
      if (pdfBase64 && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL) {
        const bucket = "appointments";
        const safeName = (pdfFilename || `WeighbridgeTicket-${apptNo || appointment.id}`)
          .replace(/[^a-zA-Z0-9_\-.]/g, "-")
          .slice(0, 120);
        const filename = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
        const path = `tickets/${Date.now()}-${filename}`;
        uploadedPath = path;

        const bytes = decodeBase64ToUint8Array(pdfBase64);
        const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}?upsert=true`;

        const uploadResp = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/pdf",
          },
          body: bytes,
        });

        if (!uploadResp.ok) {
          const txt = await uploadResp.text().catch(() => null);
          log("Storage upload failed", uploadResp.status, txt);
        } else {
          uploadedPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}`;
        }
      }
    } catch (e) {
      log("PDF upload step failed:", e);
    }

    // Step 2: PATCH appointment row with uploadedPublicUrl (if available)
    try {
      if (uploadedPublicUrl && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL) {
        const restUrl = `${SUPABASE_URL}/rest/v1/appointments?id=eq.${encodeURIComponent(appointment.id)}`;
        const patchBody = { pdf_url: uploadedPublicUrl };
        const patchResp = await fetch(restUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(patchBody),
        });
        if (!patchResp.ok) {
          const txt = await patchResp.text().catch(() => null);
          log("Appointment PATCH failed", patchResp.status, txt);
        }
      }
    } catch (e) {
      log("Appointment update failed:", e);
    }

    // Step 3: Build SMS and send via Twilio (REST)
    const shortPdfLink = uploadedPublicUrl || (appointment.pdfUrl || appointment.pdf_url) || "";
    const smsText =
      `Weighbridge Appointment confirmed: APPT ${apptNo}` +
      (wbNo ? ` | WB ${wbNo}` : "") +
      `\nPickup: ${pickup}` +
      `\nTruck: ${truck}` +
      `\nDriver: ${drvName}` +
      (shortPdfLink ? `\nView ticket: ${shortPdfLink}` : "");

    let smsResult: any = { ok: false, error: "skipped" };
    try {
      const toPhone = (recipients && recipients.driverPhone) || driverPhone;
      const fromOrMessagingServiceSid = TWILIO_MESSAGING_SERVICE_SID ? { messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID } : { from: TWILIO_FROM };

      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        smsResult = { ok: false, error: "Twilio credentials not configured (server-side)" };
      } else if (!toPhone || !isValidPhone(toPhone)) {
        smsResult = { ok: false, error: "Invalid or missing driver phone (expected E.164 like +220...)" };
      } else {
        smsResult = await sendSmsViaTwilioRest(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, fromOrMessagingServiceSid, toPhone, smsText);
      }
    } catch (e: any) {
      smsResult = { ok: false, error: e?.message || String(e) };
      log("Twilio send error:", e);
    }

    // Return unified result with CORS headers
    return okResponse({ ok: true, results: { sms: smsResult, uploadedPublicUrl, uploadedPath } }, req);
  } catch (err: any) {
    log("Function unexpected error:", err);
    // Always include CORS headers on error responses as well
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500, req);
  }
};

export default handler;
