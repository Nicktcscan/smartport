// supabase/functions/notify-appointment/index.ts
// Supabase Edge Function (Deno) — Notify appointment via Twilio SMS
// SendGrid removed as requested.

// Twilio (ESM)
import Twilio from "https://esm.sh/twilio@4.22.0";

type BodyPayload = {
  apiKey?: string;
  appointment?: Record<string, any>;
  pdfUrl?: string | null;
  recipients?: {
    driverPhone?: string;
    agentEmail?: string;
    agentName?: string;
  };
};

function buildCorsHeaders(req?: Request) {
  // Priority:
  // 1) Use explicit env var CORS_ORIGIN if set
  // 2) Fallback to request Origin header (so Access-Control-Allow-Origin echoes caller)
  // 3) Fallback to wildcard '*'
  const envOrigin = (typeof Deno !== "undefined" && Deno.env.get("CORS_ORIGIN")) || "";
  const origin = envOrigin || (req && req.headers.get("origin")) || "*";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    // allow clients to read these headers if needed
    "Access-Control-Expose-Headers": "Content-Type",
    // small optimization for preflights
    "Access-Control-Max-Age": "3600",
    "Vary": "Origin",
  };

  if (origin && origin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

function jsonResponse(obj: any, status = 200, req?: Request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: buildCorsHeaders(req),
  });
}

export const handler = async (req: Request): Promise<Response> => {
  try {
    // Handle preflight
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

    // ENV (Deno)
    const NOTIFY_API_KEY = (Deno.env.get("NOTIFY_API_KEY") ?? null) as string | null;

    const TWILIO_ACCOUNT_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? null) as string | null;
    const TWILIO_AUTH_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? null) as string | null;
    const TWILIO_API_KEY_SID = (Deno.env.get("TWILIO_API_KEY_SID") ?? null) as string | null;
    const TWILIO_API_KEY_SECRET = (Deno.env.get("TWILIO_API_KEY_SECRET") ?? null) as string | null;
    const TWILIO_FROM = (Deno.env.get("TWILIO_FROM") ?? null) as string | null;
    const TWILIO_MESSAGING_SERVICE_SID = (Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? null) as string | null;

    // validate API key if set
    if (NOTIFY_API_KEY) {
      const clientKey = req.headers.get("x-api-key") || body.apiKey;
      if (!clientKey || clientKey !== NOTIFY_API_KEY) {
        return jsonResponse({ ok: false, error: "Unauthorized" }, 401, req);
      }
    }

    const { appointment, pdfUrl, recipients } = body || {};
    if (!appointment) {
      return jsonResponse({ ok: false, error: "Missing appointment in request body" }, 400, req);
    }

    // determine recipients (prefer explicit recipients object)
    const driverPhone =
      (recipients && recipients.driverPhone) ||
      appointment.driverPhone ||
      appointment.driverLicense ||
      null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const agentName = (recipients && recipients.agentName) || appointment.agentName || "";

    // friendly appointment fields
    const apptNo =
      appointment.appointmentNumber ||
      appointment.appointment_number ||
      appointment.appointmentNo ||
      "";
    const wbNo =
      appointment.weighbridgeNumber ||
      appointment.weighbridge_number ||
      appointment.weighbridgeNo ||
      "";
    const pickup = appointment.pickupDate || appointment.pickup_date || "";
    const truck = appointment.truckNumber || appointment.truck_number || "";
    const drvName = appointment.driverName || appointment.driver_name || "";

    const shortPdfLink = pdfUrl || "";

    // SMS body
    const smsText =
      `Weighbridge Appointment confirmed: APPT ${apptNo}` +
      (wbNo ? ` | WB ${wbNo}` : "") +
      `\nPickup: ${pickup}` +
      `\nTruck: ${truck}` +
      `\nDriver: ${drvName}` +
      (shortPdfLink ? `\nView ticket: ${shortPdfLink}` : "");

    // Helper: basic E.164 phone validation (expects +<country><number>)
    function isValidPhone(phone: string | null | undefined) {
      if (!phone || typeof phone !== "string") return false;
      return /^\+\d{6,20}$/.test(phone.trim());
    }

    // Twilio SMS send
    let smsResult: any = { ok: false, error: "skipped" };
    try {
      // initialize Twilio with preferred API key credentials if provided (safer)
      let twilioClient: any = null;
      if (TWILIO_API_KEY_SID && TWILIO_API_KEY_SECRET && TWILIO_ACCOUNT_SID) {
        twilioClient = Twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
          accountSid: TWILIO_ACCOUNT_SID,
        });
      } else if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      }

      if (!twilioClient) {
        smsResult = { ok: false, error: "Twilio credentials not configured" };
      } else if (!driverPhone || !isValidPhone(driverPhone)) {
        smsResult = { ok: false, error: "Invalid or missing driver phone (expected E.164 like +220...)" };
      } else {
        const createOpts: any = {
          body: smsText,
          to: driverPhone,
        };
        // prefer messaging service SID if configured (handles from number selection)
        if (TWILIO_MESSAGING_SERVICE_SID) {
          createOpts.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
        } else if (TWILIO_FROM) {
          createOpts.from = TWILIO_FROM;
        }
        const sms = await twilioClient.messages.create(createOpts);
        smsResult = { ok: true, sid: sms.sid, raw: { status: sms.status } };
      }
    } catch (e: any) {
      // include helpful hints for common issues
      const msg = e?.message || String(e);
      smsResult = { ok: false, error: msg };
      console.error("Twilio send error:", msg);
    }

    // Return only sms result since email (SendGrid) removed
    return jsonResponse(
      {
        ok: true,
        results: {
          sms: smsResult,
          note: "Email functionality removed from this function (SendGrid).",
        },
      },
      200,
      req
    );
  } catch (err: any) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500, req);
  }
};

export default handler;
