// supabase/functions/notify-appointment/index.ts
// Supabase Edge Function (Deno) — Upload PDF (service role) + update appointment + Twilio SMS
// Accepts JSON body { appointment, pdfBase64?, pdfFilename?, recipients? }.
// If pdfBase64 provided it will upload to storage using SUPABASE_SERVICE_ROLE_KEY
// and then PATCH the appointment row to set pdf_url. Finally sends SMS via Twilio.

// Twilio (ESM)
import Twilio from "https://esm.sh/twilio@4.22.0";

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

function buildCorsHeaders(req?: Request) {
  // Prefer CORS_ORIGIN env, otherwise echo request origin if present, otherwise wildcard
  const envOrigin =
    typeof Deno !== "undefined" && (Deno.env.get("CORS_ORIGIN") || "")
      ? (Deno.env.get("CORS_ORIGIN") as string)
      : "";
  const reqOrigin = req && req.headers.get("origin") ? req.headers.get("origin")! : "";
  const origin = envOrigin || reqOrigin || "*";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,PATCH,DELETE",
    // include commonly-sent headers during preflight from browsers & supabase clients
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-api-key, X-Requested-With, apikey, accept, origin",
    "Access-Control-Expose-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };

  // Access-Control-Allow-Credentials must not be used with wildcard origin "*"
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

// decode base64 to bytes
function decodeBase64ToUint8Array(b64: string) {
  const binStr = atob(b64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

function log(...args: any[]) {
  try {
    console.log(...args);
  } catch (e) {
    // ignore
  }
}

export const handler = async (req: Request): Promise<Response> => {
  try {
    const origin = req.headers.get("origin") || "-";
    log("notify-appointment invoked; Origin:", origin, "Method:", req.method);

    // Handle CORS preflight first (return 200 OK with CORS headers)
    if (req.method === "OPTIONS") {
      // Some clients/platforms prefer 200 OK for preflight — return 200 with CORS headers.
      return new Response("", {
        status: 200,
        headers: buildCorsHeaders(req),
      });
    }

    // Simple GET health check
    if (req.method === "GET") {
      return textResponse("notify-appointment: ok", 200, req);
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, req);
    }

    // parse JSON body safely
    const body = (await req.json().catch(() => ({}))) as BodyPayload;

    // Env
    const SUPABASE_URL = ((Deno.env.get("SUPABASE_URL") || "") as string).replace(/\/+$/, "");
    const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "") as string;
    const NOTIFY_API_KEY = (Deno.env.get("NOTIFY_API_KEY") || "") as string;
    const TWILIO_ACCOUNT_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") || "") as string;
    const TWILIO_AUTH_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") || "") as string;
    const TWILIO_API_KEY_SID = (Deno.env.get("TWILIO_API_KEY_SID") || "") as string;
    const TWILIO_API_KEY_SECRET = (Deno.env.get("TWILIO_API_KEY_SECRET") || "") as string;
    const TWILIO_FROM = (Deno.env.get("TWILIO_FROM") || "") as string;
    const TWILIO_MESSAGING_SERVICE_SID = (Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "") as string;

    // NOTE: per your request we are NOT enforcing x-api-key / Authorization.
    if (NOTIFY_API_KEY) {
      // non-blocking log for debugging only
      log("NOTIFY_API_KEY is set but NOT enforced by function");
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

    // friendly fields
    const apptNo = appointment.appointmentNumber || appointment.appointment_number || appointment.appointmentNo || "";
    const wbNo = appointment.weighbridgeNumber || appointment.weighbridge_number || appointment.weighbridgeNo || "";
    const pickup = appointment.pickupDate || appointment.pickup_date || "";
    const truck = appointment.truckNumber || appointment.truck_number || "";
    const drvName = appointment.driverName || appointment.driver_name || "";

    // simple E.164 validation
    function isValidPhone(phone: string | null | undefined) {
      if (!phone || typeof phone !== "string") return false;
      return /^\+\d{6,20}$/.test(phone.trim());
    }

    // Step 1: upload PDF (if provided) using service role (PUT to /storage endpoint)
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

    // Step 3: Build SMS and send via Twilio (if configured)
    const smsText =
      `Weighbridge Appointment confirmed: APPT ${apptNo}` +
      (wbNo ? ` | WB ${wbNo}` : "") +
      `\nPickup: ${pickup}` +
      `\nTruck: ${truck}` +
      `\nDriver: ${drvName}` +
      (uploadedPublicUrl ? `\nView ticket: ${uploadedPublicUrl}` : "");

    let smsResult: any = { ok: false, error: "skipped" };

    try {
      let twilioClient: any = null;
      if (TWILIO_API_KEY_SID && TWILIO_API_KEY_SECRET && TWILIO_ACCOUNT_SID) {
        twilioClient = Twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
          accountSid: TWILIO_ACCOUNT_SID,
        });
      } else if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      }

      if (!twilioClient) {
        smsResult = { ok: false, error: "Twilio credentials not configured (server-side)" };
      } else if (!driverPhone || !isValidPhone(driverPhone)) {
        smsResult = { ok: false, error: "Invalid or missing driver phone (expected E.164 like +220...)" };
      } else {
        const createOpts: any = {
          body: smsText,
          to: driverPhone,
        };
        if (TWILIO_MESSAGING_SERVICE_SID) {
          createOpts.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
        } else if (TWILIO_FROM) {
          createOpts.from = TWILIO_FROM;
        }
        const sms = await twilioClient.messages.create(createOpts);
        smsResult = { ok: true, sid: sms.sid, raw: { status: sms.status } };
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      smsResult = { ok: false, error: msg };
      log("Twilio send error:", msg);
    }

    // Return success + results (with CORS headers)
    return okResponse(
      {
        ok: true,
        results: {
          sms: smsResult,
          uploadedPublicUrl,
          uploadedPath,
        },
      },
      req
    );
  } catch (err: any) {
    log("Function unexpected error:", err);
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500, req);
  }
};

export default handler;
