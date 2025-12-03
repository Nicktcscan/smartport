// supabase/functions/notify-appointment/index.ts
// Deno-based Supabase Edge Function — lightweight, no Node SDKs at top-level.
// Purpose: (1) handle CORS correctly including OPTIONS preflight, (2) optionally upload PDF
// to Supabase Storage using service role, (3) PATCH appointment with pdf_url, (4) send SMS via Twilio REST API.
// NOTE: this file intentionally avoids importing heavy Node packages (no esm.sh Twilio SDK) to prevent runtime errors.

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

/**
 * Build CORS headers.
 * Behavior:
 *  - If CORS_ORIGIN env is set and looks like a real origin (startsWith http or contains * or comma list),
 *    it will be used as an allow-list (if list contains the request origin it will echo it).
 *  - If CORS_ORIGIN is not set or looks invalid (e.g. a hashed token), the function will echo the request origin
 *    if present, otherwise fall back to "*".
 */
function buildCorsHeaders(req?: Request) {
  const rawEnv = (typeof Deno !== "undefined" ? (Deno.env.get("CORS_ORIGIN") || "") : "") as string;
  const reqOrigin = req && req.headers.get("origin") ? req.headers.get("origin")! : "";
  let origin = "*";

  const envTrim = String(rawEnv || "").trim();
  if (envTrim) {
    // if env looks like a comma separated list or contains an http scheme or wildcard, treat it as allowed list
    const parts = envTrim.split(",").map(p => p.trim()).filter(Boolean);
    const seemsLikeOrigins = parts.some(p => p === "*" || p.startsWith("http://") || p.startsWith("https://") || p.includes("*"));
    if (seemsLikeOrigins) {
      // If the request origin matches one of the allowed entries, echo it.
      if (reqOrigin && parts.some(p => p === "*" || p === reqOrigin || (p.endsWith("*") && reqOrigin.startsWith(p.replace(/\*+$/,''))))) {
        origin = reqOrigin || "*";
      } else if (parts.includes("*")) {
        origin = "*";
      } else {
        // fallback to the first allowed origin (useful for single-value configs)
        origin = parts[0];
      }
    } else {
      // env value present but doesn't look like an origin list (maybe was mis-set) -> prefer echoing request origin
      origin = reqOrigin || "*";
    }
  } else {
    // no env provided -> echo request origin if present, otherwise wildcard
    origin = reqOrigin || "*";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,PATCH,DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, apikey, X-Requested-With, accept, origin",
    "Access-Control-Expose-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };

  if (origin && origin !== "*") {
    // Only set credentials true when origin is explicit (not wildcard).
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
    // btoa should be available in Deno. Fallback to Buffer if present.
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

export const handler = async (req: Request): Promise<Response> => {
  try {
    const originHeader = req.headers.get("origin") || "-";
    log("notify-appointment invoked; Origin:", originHeader, "Method:", req.method);

    // Handle CORS preflight immediately to keep response fast and avoid heavy runtime init.
    if (req.method === "OPTIONS") {
      // Prefer returning 204 No Content for preflight; still include CORS headers.
      return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
    }

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
    const SUPABASE_URL = ((Deno.env.get("SUPABASE_URL") || "") as string).replace(/\/+$/, "");
    const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "") as string;
    const NOTIFY_API_KEY = (Deno.env.get("NOTIFY_API_KEY") || "") as string;
    const TWILIO_ACCOUNT_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") || "") as string;
    const TWILIO_AUTH_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") || "") as string;
    const TWILIO_FROM = (Deno.env.get("TWILIO_FROM") || "") as string;
    const TWILIO_MESSAGING_SERVICE_SID = (Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "") as string;

    if (NOTIFY_API_KEY) {
      // not enforced here by default — consider enforcing in production if needed
      log("NOTIFY_API_KEY is set (not enforced)");
    }

    const { appointment, pdfBase64, pdfFilename, recipients } = body || {};
    if (!appointment || !appointment.id) {
      return jsonResponse({ ok: false, error: "Missing appointment (id) in request body" }, 400, req);
    }

    // derive driver phone
    const driverPhone =
      (recipients && recipients.driverPhone) ||
      (appointment.driverPhone || appointment.driverLicense) ||
      null;

    const apptNo = appointment.appointmentNumber || appointment.appointment_number || appointment.appointmentNo || "";
    const wbNo = appointment.weighbridgeNumber || appointment.weighbridge_number || appointment.weighbridgeNo || "";
    const pickup = appointment.pickupDate || appointment.pickup_date || "";
    const truck = appointment.truckNumber || appointment.truck_number || "";
    const drvName = appointment.driverName || appointment.driver_name || "";

    function isValidPhone(phone: string | null | undefined) {
      if (!phone || typeof phone !== "string") return false;
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
