// netlify/functions/ia.js
// Proxy Netlify Function pour l'assistant IA du CFP de Lambanyi
// Permet d'appeler l'API Anthropic depuis le navigateur sans exposer la clé API

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Clé API Anthropic non configurée." })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corps JSON invalide." }) };
  }

  const { system, messages } = body;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: system || "Tu es un assistant pour le CFP de Lambanyi.",
        messages: messages || [],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || "Erreur API Anthropic" })
      };
    }

    const reply = (data.content || []).map(b => b.text || "").join("") || "Désolé, pas de réponse.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erreur interne : " + e.message })
    };
  }
};
