// supabase/functions/notify-appointment/index.ts
// Supabase Edge Function (Deno) — Notify appointment via Twilio SMS + SendGrid Email

// Twilio (ESM)
import Twilio from "https://esm.sh/twilio@4.22.0";
// SendGrid (ESM)
import sgMail from "https://esm.sh/@sendgrid/mail@7.7.0";

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

function jsonResponse(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    // parse body safely
    const body = (await req.json().catch(() => ({}))) as BodyPayload;

    // ENV (Deno)
    const NOTIFY_API_KEY = (Deno.env.get("NOTIFY_API_KEY") ?? null) as string | null;

    const TWILIO_ACCOUNT_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? null) as string | null;
    const TWILIO_AUTH_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? null) as string | null;
    const TWILIO_API_KEY_SID = (Deno.env.get("TWILIO_API_KEY_SID") ?? null) as string | null;
    const TWILIO_API_KEY_SECRET = (Deno.env.get("TWILIO_API_KEY_SECRET") ?? null) as string | null;
    const TWILIO_FROM = (Deno.env.get("TWILIO_FROM") ?? null) as string | null;
    const TWILIO_MESSAGING_SERVICE_SID = (Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? null) as string | null;

    const SENDGRID_API_KEY = (Deno.env.get("SENDGRID_API_KEY") ?? null) as string | null;
    const EMAIL_FROM = (Deno.env.get("EMAIL_FROM") ?? "no-reply@example.com") as string;

    // validate API key if set
    if (NOTIFY_API_KEY) {
      const clientKey = req.headers.get("x-api-key") || body.apiKey;
      if (!clientKey || clientKey !== NOTIFY_API_KEY) {
        return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
      }
    }

    const { appointment, pdfUrl, recipients } = body || {};
    if (!appointment) {
      return jsonResponse({ ok: false, error: "Missing appointment in request body" }, 400);
    }

    // determine recipients (prefer explicit recipients object)
    const driverPhone =
      (recipients && recipients.driverPhone) ||
      appointment.driverPhone ||
      appointment.driverLicense ||
      null;

    const agentEmail = (recipients && recipients.agentEmail) || appointment.agentEmail || null;
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

    // Email subject + bodies
    const emailSubject = `Appointment ${apptNo} — Weighbridge Ticket`;
    const emailText = `
Appointment ${apptNo} ${wbNo ? `| Weighbridge: ${wbNo}` : ""}
Agent: ${agentName}
Pickup Date: ${pickup}
Truck: ${truck}
Driver: ${drvName}

${shortPdfLink ? `Download ticket: ${shortPdfLink}` : "Ticket URL not available."}
`.trim();

    const emailHtml = `
      <p>Hello ${agentName || "Agent"},</p>
      <p>Your weighbridge appointment <strong>${apptNo}</strong>${wbNo ? ` (Weighbridge: <strong>${wbNo}</strong>)` : ""} has been created.</p>
      <ul>
        <li><strong>Pickup Date:</strong> ${pickup}</li>
        <li><strong>Truck:</strong> ${truck}</li>
        <li><strong>Driver:</strong> ${drvName}</li>
      </ul>
      ${shortPdfLink ? `<p><a href="${shortPdfLink}" target="_blank" rel="noopener">Open appointment PDF / ticket</a></p>` : `<p>Ticket URL not available.</p>`}
      <p>Regards,<br/>NICK TC-SCAN (GAMBIA) LTD.</p>
    `;

    // Helper: basic E.164 phone validation (expects +<country><number>)
    function isValidPhone(phone: string | null | undefined) {
      if (!phone || typeof phone !== "string") return false;
      return /^\+\d{6,20}$/.test(phone.trim());
    }

    // ---------- Twilio SMS send ----------
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
      smsResult = { ok: false, error: e?.message || String(e) };
    }

    // ---------- SendGrid Email send ----------
    let emailResult: any = { ok: false, error: "skipped" };
    try {
      if (!SENDGRID_API_KEY) {
        emailResult = { ok: false, error: "SendGrid API key not configured" };
      } else if (!agentEmail || typeof agentEmail !== "string") {
        emailResult = { ok: false, error: "Missing agent email" };
      } else {
        sgMail.setApiKey(SENDGRID_API_KEY);
        const msg = {
          to: agentEmail,
          from: EMAIL_FROM,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        };
        const sgResp = await sgMail.send(msg);
        emailResult = {
          ok: true,
          info: Array.isArray(sgResp) ? sgResp.map((r) => r.statusCode) : sgResp.statusCode,
        };
      }
    } catch (e: any) {
      emailResult = { ok: false, error: e?.message || String(e) };
    }

    return jsonResponse({
      ok: true,
      results: {
        sms: smsResult,
        email: emailResult,
      },
    });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500);
  }
};

export default handler;
