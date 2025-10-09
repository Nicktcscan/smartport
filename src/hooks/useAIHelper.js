// src/hooks/useAIHelper.js
// Centralized AI helper used by SADDeclaration.jsx
// NOTE: this file sends requests to a server-side AI proxy. Do NOT call OpenAI directly from the browser.

const AI_PROXY = process.env.REACT_APP_AI_PROXY_URL || '/api/ai-proxy';

async function callAiProxy(payload) {
  try {
    const res = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Provide clearer errors for method/availability problems
    if (!res.ok) {
      if (res.status === 405) {
        // Method not allowed — likely server handler doesn't accept POST
        throw new Error(`AI proxy error: 405 Method Not Allowed (check server route accepts POST)`);
      }
      const txt = await res.text().catch(() => '');
      throw new Error(`AI proxy error: ${res.status} ${txt ? `- ${txt}` : ''}`);
    }

    // Try to parse JSON robustly
    const json = await res.json().catch(() => null);
    return json;
  } catch (err) {
    // Re-throw with consistent message shape
    throw new Error(err?.message || 'AI proxy request failed');
  }
}

export async function suggestSadDetails(sadNo) {
  if (!sadNo) return null;
  const body = { action: 'suggestSadDetails', sadNo };
  return callAiProxy(body);
}

export async function parseDocTextForFields(text) {
  if (!text) return null;
  const body = { action: 'parseDoc', text };
  return callAiProxy(body);
}

export async function parseNaturalLanguageQuery(nlText) {
  if (!nlText) return null;
  const body = { action: 'nlToFilter', text: nlText };
  return callAiProxy(body);
}

// A lightweight explainability call — ask AI for human-friendly reasoning about discrepancy
export async function explainDiscrepancy(payload) {
  if (!payload) return null;
  const body = { action: 'explainDiscrepancy', payload };
  return callAiProxy(body);
}
