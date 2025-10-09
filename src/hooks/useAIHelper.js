// src/hooks/useAIHelper.js
// Centralized AI helper used by SADDeclaration.jsx
// NOTE: this file sends requests to a server-side AI proxy. Do NOT call OpenAI directly from the browser.

const AI_PROXY = process.env.REACT_APP_AI_PROXY_URL || '/api/ai-proxy';

export async function suggestSadDetails(sadNo) {
  if (!sadNo) return null;
  const res = await fetch(`${AI_PROXY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'suggestSadDetails', sadNo }),
  });
  if (!res.ok) throw new Error(`AI proxy error: ${res.status}`);
  return res.json();
}

export async function parseDocTextForFields(text) {
  const res = await fetch(`${AI_PROXY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'parseDoc', text }),
  });
  if (!res.ok) throw new Error('AI parse error');
  return res.json();
}

export async function parseNaturalLanguageQuery(nlText) {
  const res = await fetch(`${AI_PROXY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'nlToFilter', text: nlText }),
  });
  if (!res.ok) throw new Error('AI nl parse error');
  return res.json();
}

// A lightweight explainability call — ask AI for human-friendly reasoning about discrepancy
export async function explainDiscrepancy(payload) {
  const res = await fetch(`${AI_PROXY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'explainDiscrepancy', payload }),
  });
  if (!res.ok) throw new Error('AI explain error');
  return res.json();
}
