/**
 * jarvis-hud-proxy
 * ------------------------------------------------------------------
 * Worker Cloudflare che fa da intermediario tra la PWA (sul telefono)
 * e l'API di Groq, in modo che la chiave GROQ_API_KEY non finisca mai
 * nel codice della PWA (che e' pubblico, essendo su GitHub Pages).
 *
 * Setup:
 *  1. Nella dashboard del Worker -> Settings -> Variables and Secrets
 *     aggiungi un secret chiamato GROQ_API_KEY con la tua chiave.
 *  2. (Opzionale ma consigliato) aggiungi anche ALLOWED_ORIGIN con
 *     l'URL esatto della tua PWA (es. https://tuonome.github.io)
 *     in modo che il proxy risponda solo a richieste provenienti da li'.
 * ------------------------------------------------------------------
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export default {
  async fetch(request, env) {
    // Gestione CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Metodo non consentito, usa POST." }, 405, env);
    }

    // Se ALLOWED_ORIGIN e' impostato, blocca chiunque altro
    const origin = request.headers.get("Origin") || "";
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: "Origine non autorizzata." }, 403, env);
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({ error: "JSON non valido nel corpo della richiesta." }, 400, env);
    }

    // Il client manda gia' il payload nel formato Groq (model, messages, ecc.)
    // Qui iniettiamo solo la chiave segreta.
    const groqResponse = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await groqResponse.text();
    return new Response(data, {
      status: groqResponse.status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(env),
      },
    });
  },
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}
