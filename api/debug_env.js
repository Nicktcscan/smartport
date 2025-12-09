export default function handler(req, res) {
  return res.status(200).json({
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "NOT FOUND",
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "SET" : "NOT FOUND",
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || "NOT FOUND"
  });
}
