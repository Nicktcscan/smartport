// supabase/functions/notify-appointment/index.ts
// Serverless "notify appointment" function for Twilio SMS + SendGrid Email

// Twilio (ESM import)
import Twilio from "https://esm.sh/twilio@4.22.0";

// SendGrid (native edge-compatible client)
import sgMail from "https://esm.sh/@sendgrid/mail@7.7.0";

export const handler = async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    const body = await req.json().catch(() => ({}));

    // ENV
    const NOTIFY_API_KEY = Deno.env.get("NOTIFY_API_KEY") ?? null;

    // Twilio
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? null;
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? null;
    const TWILIO_FROM = Deno.env.get("TWILIO_FROM") ?? null;

    // SendGrid
    const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") ?? null;
    const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "no-reply@example.com";

    // Optional API key validation
    if (NOTIFY_API_KEY) {
      const clientKey = req.headers.get("x-api-key") || body.apiKey;
      if (!clientKey || clientKey !== NOTIFY_API_KEY) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    const { appointment, pdfUrl, recipients } = body || {};
    if (!appointment) {
      return new Response(JSON.stringify({ ok: false, error: "Missing appointment" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Recipients
    const driverPhone =
      recipients?.driverPhone || appointment.driverPhone || appointment.driverLicense || null;
    const agentEmail =
      recipients?.agentEmail || appointment.agentEmail || null;
    const agentName =
      recipients?.agentName || appointment.agentName || "";

    // Appointment fields
    const apptNo = appointment.appointmentNumber || appointment.appointment_number || "";
    const wbNo = appointment.weighbridgeNumber || appointment.weighbridge_number || "";
    const pickup = appointment.pickupDate || appointment.pickup_date || "";
    const truck = appointment.truckNumber || appointment.truck_number || "";
    const driverName = appointment.driverName || appointment.driver_name || "";

    const shortPdfLink = pdfUrl || "";

    // ===========================
    // SMS BODY
    // ===========================
    const smsText =
      `Weighbridge Appointment confirmed: APPT ${apptNo} ${
        wbNo ? `| WB ${wbNo}` : ""
      }\nPickup: ${pickup}\nTruck: ${truck}\nDriver: ${driverName}\n${
        shortPdfLink ? `View ticket: ${shortPdfLink}` : ""
      }`;

    // ===========================
    // EMAIL BODY (Text + HTML)
    // ===========================
    const emailSubject = `Appointment ${apptNo} — Weighbridge Ticket`;

    const emailText = `
Appointment ${apptNo} ${wbNo ? `| Weighbridge: ${wbNo}` : ""}
Agent: ${agentName}
Pickup Date: ${pickup}
Truck: ${truck}
Driver: ${driverName}

${shortPdfLink ? `Download ticket: ${shortPdfLink}` : "Ticket URL not available."}
`;

    const emailHtml = `
<p>Hello ${agentName || "Agent"},</p>
<p>Your weighbridge appointment <strong>${apptNo}</strong>${
      wbNo ? ` (Weighbridge: <strong>${wbNo}</strong>)` : ""
    } has been created.</p>

<ul>
  <li><strong>Pickup Date:</strong> ${pickup}</li>
  <li><strong>Truck:</strong> ${truck}</li>
  <li><strong>Driver:</strong> ${driverName}</li>
</ul>

${
  shortPdfLink
    ? `<p><a href="${shortPdfLink}" target="_blank">Open appointment PDF / ticket</a></p>`
    : `<p>Ticket URL not available.</p>`
}

<p>Regards,<br/>NICK TC-SCAN (GAMBIA) LTD.</p>
`;

    // ===============================
    // SEND SMS (Twilio)
    // ===============================
    function isValidPhone(phone: string) {
      if (!phone) return false;
      return /^\+\d{6,20}$/.test(phone);
    }

    let smsResult: any = null;
    let emailResult: any = null;

    // Initialize Twilio client if configured
    let twilioClient: any = null;
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    }

    if (twilioClient && driverPhone && isValidPhone(driverPhone)) {
      try {
        const sms = await twilioClient.messages.create({
          body: smsText,
          from: TWILIO_FROM,
          to: driverPhone
        });
        smsResult = { ok: true, sid: sms.sid };
      } catch (e: any) {
        smsResult = { ok: false, error: e?.message || String(e) };
      }
    } else {
      smsResult = { ok: false, error: "Twilio not configured or invalid phone" };
    }

    // ===============================
    // SEND EMAIL (SendGrid)
    // ===============================
    if (SENDGRID_API_KEY && agentEmail) {
      try {
        sgMail.setApiKey(SENDGRID_API_KEY);

        const msg = {
          to: agentEmail,
          from: EMAIL_FROM,
          subject: emailSubject,
          text: emailText,
          html: emailHtml
        };

        const sgResp = await sgMail.send(msg);
        emailResult = {
          ok: true,
          info: Array.isArray(sgResp)
            ? sgResp.map((r) => r.statusCode)
            : sgResp.statusCode
        };
      } catch (e: any) {
        emailResult = { ok: false, error: e?.message || String(e) };
      }
    } else {
      emailResult = {
        ok: false,
        error: "SendGrid not configured or agentEmail missing"
      };
    }

    return new Response(JSON.stringify({ ok: true, results: {
      sms: smsResult,
      email: emailResult
    }}), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: err?.message || String(err)
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export default handler;
