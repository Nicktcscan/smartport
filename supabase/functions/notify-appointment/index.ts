// supabase/functions/notify-appointment/index.ts
// Supabase Edge Function (Deno) — Upload PDF (service role) + update appointment + Twilio SMS
// Accepts JSON body { appointment, pdfBase64?, recipients? }.
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
  const envOrigin = (typeof Deno !== "undefined" && Deno.env.get("CORS_ORIGIN")) || "";
  const origin = envOrigin || (req && req.headers.get("origin")) || "*";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Expose-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };

  if (origin && origin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
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

function forbidden(req?: Request) {
  return jsonResponse({ ok: false, error: "Unauthorized" }, 401, req);
}

function decodeBase64ToUint8Array(b64: string) {
  // atob -> binary string -> Uint8Array
  const binStr = atob(b64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

export const handler = async (req: Request): Promise<Response> => {
  try {
    // Preflight CORS
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(req),
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, req);
    }

    const body = (await req.json().catch(() => ({}))) as BodyPayload;

    // Environment
    const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/,"");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const NOTIFY_API_KEY = Deno.env.get("NOTIFY_API_KEY") || "";
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
    const TWILIO_API_KEY_SID = Deno.env.get("TWILIO_API_KEY_SID") || "";
    const TWILIO_API_KEY_SECRET = Deno.env.get("TWILIO_API_KEY_SECRET") || "";
    const TWILIO_FROM = Deno.env.get("TWILIO_FROM") || "";
    const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "";

    // Basic auth: allow when x-api-key matches NOTIFY_API_KEY OR when Authorization header present
    const clientKey = req.headers.get("x-api-key") || "";
    const authorization = req.headers.get("authorization") || "";

    if (NOTIFY_API_KEY) {
      // if API key configured, require either matching x-api-key OR an Authorization header (so logged-in clients via supabase.functions.invoke still work)
      if (!clientKey && !authorization) return forbidden(req);
      if (clientKey && clientKey !== NOTIFY_API_KEY) {
        // allow Authorization as alternate path (so supabase.functions.invoke with session works)
        if (!authorization) return forbidden(req);
      }
    }

    const { appointment, pdfBase64, pdfFilename, recipients } = body || {};
    if (!appointment || !appointment.id) {
      return jsonResponse({ ok: false, error: "Missing appointment (id) in request body" }, 400, req);
    }

    // derive driver phone
    const driverPhone =
      (recipients && recipients.driverPhone) ||
      appointment.driverPhone ||
      appointment.driverLicense ||
      null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const agentName = (recipients && recipients.agentName) || appointment.agentName || "";

    // friendly fields
    const apptNo = appointment.appointmentNumber || appointment.appointment_number || appointment.appointmentNo || "";
    const wbNo = appointment.weighbridgeNumber || appointment.weighbridge_number || appointment.weighbridgeNo || "";
    const pickup = appointment.pickupDate || appointment.pickup_date || "";
    const truck = appointment.truckNumber || appointment.truck_number || "";
    const drvName = appointment.driverName || appointment.driver_name || "";

    // validate phone (simple E.164)
    function isValidPhone(phone: string | null | undefined) {
      if (!phone || typeof phone !== "string") return false;
      return /^\+\d{6,20}$/.test(phone.trim());
    }

    // Step 1: if pdfBase64 present → upload to storage using SERVICE ROLE
    let uploadedPublicUrl: string | null = null;
    let uploadedPath: string | null = null;
    try {
      if (pdfBase64 && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL) {
        const bucket = "appointments";
        // ensure filename
        const safeName = (pdfFilename || `WeighbridgeTicket-${apptNo || appointment.id}`).replace(/[^a-zA-Z0-9_\-.]/g, "-").slice(0, 120);
        const filename = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
        const path = `tickets/${Date.now()}-${filename}`;
        uploadedPath = path;

        const bytes = decodeBase64ToUint8Array(pdfBase64);

        // Upload via PUT to /storage/v1/object/{bucket}/{path}?upsert=true
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
          const txt = await uploadResp.text().catch(()=>null);
          console.error("Storage upload failed", uploadResp.status, txt);
          // continue — we won't block SMS on storage failure, but include the error
        } else {
          // Public URL endpoint: /storage/v1/object/public/{bucket}/{path}
          uploadedPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}`;
        }
      }
    } catch (e) {
      console.warn("PDF upload step failed:", e);
    }

    // Step 2: If uploadedPublicUrl available, PATCH appointment row to set pdf_url using Service Role
    try {
      if (uploadedPublicUrl && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL) {
        const restUrl = `${SUPABASE_URL}/rest/v1/appointments?id=eq.${encodeURIComponent(appointment.id)}`;
        const patchBody = { pdf_url: uploadedPublicUrl };

        const patchResp = await fetch(restUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(patchBody),
        });

        if (!patchResp.ok) {
          const txt = await patchResp.text().catch(()=>null);
          console.warn("Appointment PATCH failed", patchResp.status, txt);
        }
      }
    } catch (e) {
      console.warn("Appointment update failed:", e);
    }

    // Step 3: Build SMS body & send via Twilio (if configured)
    const smsText =
      `Weighbridge Appointment confirmed: APPT ${apptNo}` +
      (wbNo ? ` | WB ${wbNo}` : "") +
      `\nPickup: ${pickup}` +
      `\nTruck: ${truck}` +
      `\nDriver: ${drvName}` +
      (uploadedPublicUrl ? `\nView ticket: ${uploadedPublicUrl}` : "");

    let smsResult: any = { ok: false, error: "skipped" };

    try {
      // initialize Twilio
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
      console.error("Twilio send error:", msg);
    }

    return okResponse({
      ok: true,
      results: { sms: smsResult, uploadedPublicUrl, uploadedPath },
    }, req);

  } catch (err: any) {
    console.error("Function unexpected error:", err);
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500, req);
  }
};

export default handler;
