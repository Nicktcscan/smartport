// src/pages/api/sendSMS.js

import twilio from "twilio";

export default async function handler(req, res) {
  // Allow only POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Extract values sent from frontend
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: "Missing 'to' or 'message' field" });
    }

    // Load secrets from environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const smsFrom    = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !smsFrom) {
      return res.status(500).json({
        error: "Twilio environment variables not configured",
      });
    }

    // Initialize Twilio client
    const client = twilio(accountSid, authToken);

    // Send SMS through Twilio
    const result = await client.messages.create({
      body: message,
      from: smsFrom,
      to: to.startsWith("+") ? to : `+${to}`, // auto-correct number
    });

    // Success
    return res.status(200).json({
      success: true,
      sid: result.sid,
      status: result.status,
    });

  } catch (error) {
    console.error("Twilio Error:", error);

    return res.status(500).json({
      error: "Failed to send SMS",
      details: error.message,
    });
  }
}
