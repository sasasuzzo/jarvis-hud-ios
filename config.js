// ------------------------------------------------------------------
// Configurazione pubblica della PWA. Nessun segreto qui: la chiave
// Groq resta SOLO nel Worker Cloudflare.
// ------------------------------------------------------------------
const CONFIG = {
  // Sostituisci con l'URL del tuo Worker, es:
  // "https://jarvis-hud-proxy.tuoaccount.workers.dev"
  WORKER_URL: "https://jarvis-hud-proxy.YOUR-SUBDOMAIN.workers.dev",

  GROQ_VISION_MODEL: "llama-3.2-11b-vision-preview",
  GROQ_TEXT_MODEL: "llama-3.3-70b-versatile",

  // Nome citta' di fallback se il GPS non e' disponibile / negato
  FALLBACK_LOCATION: { lat: 41.9028, lon: 12.4964, label: "Roma" },
};
