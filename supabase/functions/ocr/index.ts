import { serve } from "https://deno.land/std@0.181.0/http/server.ts";
import { createWorker } from "npm:tesseract.js@5.0.3";

const allowedOrigins = [
  "http://localhost:3000",
  "https://weighbridge-system.vercel.app",
];

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const isAllowedOrigin = allowedOrigins.includes(origin);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": isAllowedOrigin ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Accept Content-Type and Authorization headers for CORS preflight
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method Not Allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return new Response(
        JSON.stringify({ error: "No file uploaded" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // OCR with Tesseract.js
    const worker = await createWorker();
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const { data: { text } } = await worker.recognize(uint8Array);
    await worker.terminate();

    return new Response(
      JSON.stringify({ text }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("OCR Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
