// ------------------------------------------------------------------
// J.A.R.V.I.S. HUD - logica principale
// ------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Non bloccante: l'app funziona anche senza service worker registrato
    });
  });
}

let leafletMap = null;
let leafletMarker = null;
let recognition = null;
let isListening = false;
let currentStream = null;

// ---------- Avvio ----------

document.getElementById("btn-boot-start").addEventListener("click", bootSequence);

async function bootSequence() {
  unlockSpeech();
  setBootStatus("Richiesta accesso alla fotocamera...");
  try {
    await startCamera();
  } catch (err) {
    setBootStatus("Fotocamera negata. Impossibile procedere senza HUD visivo.");
    return;
  }

  setBootStatus("Richiesta posizione GPS...");
  requestLocation(); // non bloccante: se negata, usiamo il fallback

  setBootStatus("Caricamento vitali...");
  await loadVitalsIntoUI();

  setBootStatus("Sistema pronto.");
  document.getElementById("boot-screen").classList.add("hidden");

  startClock();
  startWeatherLoop();
  initSpeechRecognition();
  initAvatar();
  initHudStyling();
  terminalLog("Sistema avviato. In attesa.");
}

function setBootStatus(text) {
  document.getElementById("boot-status").textContent = text;
}

// ---------- Stile HUD: angoli a mirino sui pannelli + righello decorativo ----------

function initHudStyling() {
  document.querySelectorAll(".panel").forEach((panel) => {
    ["tl", "tr", "bl", "br"].forEach((pos) => {
      const span = document.createElement("span");
      span.className = `corner corner-${pos}`;
      panel.appendChild(span);
    });
  });

  const ruler = document.getElementById("ruler-left");
  if (ruler) {
    for (let i = 0; i <= 10; i++) {
      const pct = (i / 10) * 100;
      const tick = document.createElement("div");
      tick.className = "tick" + (i % 5 === 0 ? " major" : "");
      tick.style.top = pct + "%";
      ruler.appendChild(tick);
      if (i % 5 === 0) {
        const label = document.createElement("div");
        label.className = "tick-label";
        label.style.top = pct + "%";
        label.textContent = String(100 - i * 10).padStart(3, "0");
        ruler.appendChild(label);
      }
    }
  }
}

// ---------- Fotocamera ----------

async function startCamera() {
  const video = document.getElementById("camera-feed");
  currentStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = currentStream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
}

function captureFrameAsDataUrl() {
  const video = document.getElementById("camera-feed");
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Fotocamera non ancora pronta, riprova tra un istante.");
  }
  const canvas = document.getElementById("capture-canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

// ---------- Orologio ----------

function startClock() {
  const giorni = ["DOM", "LUN", "MAR", "MER", "GIO", "VEN", "SAB"];
  const mesi = ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"];
  function tick() {
    const now = new Date();
    document.getElementById("clock-time").textContent =
      String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    document.getElementById("clock-date").textContent =
      `${giorni[now.getDay()]} ${String(now.getDate()).padStart(2, "0")} ${mesi[now.getMonth()]}`;
  }
  tick();
  setInterval(tick, 1000 * 15);
}

// ---------- GPS + Mappa ----------

function requestLocation() {
  if (!("geolocation" in navigator)) {
    initMap(CONFIG.FALLBACK_LOCATION.lat, CONFIG.FALLBACK_LOCATION.lon);
    fetchWeather(CONFIG.FALLBACK_LOCATION.lat, CONFIG.FALLBACK_LOCATION.lon);
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      updateMapPosition(latitude, longitude);
    },
    () => {
      initMap(CONFIG.FALLBACK_LOCATION.lat, CONFIG.FALLBACK_LOCATION.lon);
      fetchWeather(CONFIG.FALLBACK_LOCATION.lat, CONFIG.FALLBACK_LOCATION.lon);
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
  );
}

function initMap(lat, lon) {
  leafletMap = L.map("map", {
    zoomControl: false,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: false,
  }).setView([lat, lon], 15);

  // Tema scuro per coerenza con l'HUD (CartoDB dark, gratuito)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
  }).addTo(leafletMap);

  leafletMarker = L.circleMarker([lat, lon], {
    radius: 7,
    color: "#00E5FF",
    fillColor: "#00E5FF",
    fillOpacity: 0.9,
    weight: 2,
  }).addTo(leafletMap);
}

let lastWeatherFetch = 0;
function updateMapPosition(lat, lon) {
  if (!leafletMap) {
    initMap(lat, lon);
  } else {
    leafletMarker.setLatLng([lat, lon]);
    leafletMap.panTo([lat, lon]);
  }
  // Aggiorna meteo al massimo ogni 10 minuti
  const now = Date.now();
  if (now - lastWeatherFetch > 10 * 60 * 1000) {
    lastWeatherFetch = now;
    fetchWeather(lat, lon);
  }
}

// ---------- Meteo (Open-Meteo, gratuito, senza chiave) ----------

function startWeatherLoop() {
  // Il primo fetch avviene appena arriva una posizione (vedi updateMapPosition
  // e requestLocation -> fallback). Qui impostiamo solo un refresh periodico
  // di sicurezza nel caso la posizione non cambi mai.
  setInterval(() => {
    if (leafletMarker) {
      const { lat, lng } = leafletMarker.getLatLng();
      fetchWeather(lat, lng);
    }
  }, 10 * 60 * 1000);
}

async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    document.getElementById("weather-temp").textContent = Math.round(c.temperature_2m) + "\u00B0";
    document.getElementById("weather-desc").textContent = weatherCodeToLabel(c.weather_code);
    document.getElementById("weather-sub").textContent =
      `umidita ${Math.round(c.relative_humidity_2m)}% / vento ${Math.round(c.wind_speed_10m)} km/h`;
  } catch (err) {
    document.getElementById("weather-desc").textContent = "N/D";
  }
}

function weatherCodeToLabel(code) {
  // Mappatura semplificata dei WMO weather code di Open-Meteo
  if (code === 0) return "SERENO";
  if ([1, 2, 3].includes(code)) return "NUVOLOSO";
  if ([45, 48].includes(code)) return "NEBBIA";
  if ([51, 53, 55, 56, 57].includes(code)) return "PIOVIGGINE";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "PIOGGIA";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "NEVE";
  if ([95, 96, 99].includes(code)) return "TEMPORALE";
  return "---";
}

// ---------- Vitali (inserimento manuale) ----------

document.getElementById("btn-edit-vitals").addEventListener("click", () => {
  document.getElementById("vitals-modal").classList.remove("hidden");
});
document.getElementById("btn-vitals-cancel").addEventListener("click", () => {
  document.getElementById("vitals-modal").classList.add("hidden");
});
document.getElementById("btn-vitals-save").addEventListener("click", async () => {
  const vitals = {
    sonno: parseFloat(document.getElementById("input-sonno").value) || 0,
    battiti: parseInt(document.getElementById("input-battiti").value) || 0,
    energia: parseInt(document.getElementById("input-energia").value) || 0,
    stato: document.getElementById("input-stato").value,
  };
  await JarvisMemory.saveVitals(vitals);
  renderVitals(vitals);
  document.getElementById("vitals-modal").classList.add("hidden");
  terminalLog("Vitali aggiornati manualmente.");
});

async function loadVitalsIntoUI() {
  const vitals = await JarvisMemory.getVitals();
  if (vitals) {
    renderVitals(vitals);
    document.getElementById("input-sonno").value = vitals.sonno;
    document.getElementById("input-battiti").value = vitals.battiti;
    document.getElementById("input-energia").value = vitals.energia;
    document.getElementById("input-stato").value = vitals.stato;
  }
}

function renderVitals(vitals) {
  document.getElementById("vital-sonno").textContent = vitals.sonno + " h";
  document.getElementById("vital-battiti").textContent = vitals.battiti + " bpm";
  document.getElementById("vital-energia").textContent = vitals.energia + "%";
  document.getElementById("vital-stato").textContent = vitals.stato;
}

// ---------- Avatar 3D (placeholder stilizzato, Three.js) ----------

function initAvatar() {
  const canvas = document.getElementById("avatar-canvas");
  const wrap = document.getElementById("avatar-canvas-wrap");
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0.4, 5);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const cyan = 0x00e5ff;
  const group = new THREE.Group();

  // Silhouette umanoide stilizzata a wireframe (placeholder finche' non
  // colleghiamo dati reali via HealthKit lato app nativa futura)
  const bodyMat = new THREE.MeshBasicMaterial({ color: cyan, wireframe: true, transparent: true, opacity: 0.85 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), bodyMat);
  head.position.y = 1.85;
  // Nota: usiamo CylinderGeometry (non CapsuleGeometry, non disponibile in three r128)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.35, 1.4, 10), bodyMat);
  torso.position.y = 1.0;
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 8), bodyMat);
  armL.position.set(-0.6, 1.0, 0);
  armL.rotation.z = 0.15;
  const armR = armL.clone();
  armR.position.x = 0.6;
  armR.rotation.z = -0.15;
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 1.3, 8), bodyMat);
  legL.position.set(-0.2, -0.4, 0);
  const legR = legL.clone();
  legR.position.x = 0.2;

  group.add(head, torso, armL, armR, legL, legR);
  group.position.y = -1.1;
  scene.add(group);

  function animate() {
    requestAnimationFrame(animate);
    group.rotation.y += 0.012;
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
}

// ---------- Terminale di stato ----------

function terminalLog(text) {
  const el = document.getElementById("terminal-lines");
  const line = document.createElement("div");
  line.className = "terminal-line";
  const time = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.textContent = `[${time}] ${text}`;
  el.appendChild(line);
  while (el.children.length > 6) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ---------- Notifiche generate da Jarvis ----------

function pushNotification(text) {
  const el = document.getElementById("notif-list");
  const item = document.createElement("div");
  item.className = "notif-item";
  item.textContent = text;
  el.prepend(item);
  while (el.children.length > 5) el.removeChild(el.lastChild);
}

// Esempio: promemoria generato in locale (in futuro collegabile a logica
// piu' ricca: obiettivi, promemoria salvati, alert di sistema, ecc.)
function scheduleDemoReminder() {
  setTimeout(() => pushNotification("Promemoria: nessun promemoria attivo."), 4000);
}

// ---------- Riconoscimento vocale (tap-to-talk) ----------

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    terminalLog("Riconoscimento vocale non supportato su questo browser.");
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = "it-IT";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isListening = true;
    document.getElementById("btn-talk").classList.add("listening");
    terminalLog("In ascolto...");
  };
  recognition.onerror = (e) => {
    terminalLog("Errore ascolto: " + e.error);
    stopListeningUI();
  };
  recognition.onend = () => {
    stopListeningUI();
  };
  recognition.onresult = (event) => {
    const testo = event.results[0][0].transcript;
    handleVoiceCommand(testo);
  };
}

function stopListeningUI() {
  isListening = false;
  document.getElementById("btn-talk").classList.remove("listening");
}

document.getElementById("btn-talk").addEventListener("click", () => {
  unlockSpeech();
  if (compareState.waiting) {
    try {
      const secondImage = captureFrameAsDataUrl();
      processComparison(secondImage);
    } catch (err) {
      setResponseBox(err.message);
      terminalLog("Errore cattura frame: " + err.message);
    }
    return;
  }
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    recognition.start();
  }
});

// ---------- Riconoscimento intento (comandi naturali della specifica) ----------

const INTENT_PATTERNS = [
  { intent: "memoria", re: /dove ho lasciato|hai gi. visto|dov'era|dove ho messo|quando ho visto|dov e |dove e /i },
  { intent: "scheda", re: /cos'? ?e questo|che oggetto e|dimmi di pi.|analizza questo/i },
  { intent: "prezzo", re: /quanto costa/i },
  { intent: "misura", re: /quanto misura|che dimensioni ha|quanto pesa/i },
  { intent: "funzionamento", re: /come funziona/i },
  { intent: "riparazione", re: /come si smonta|come si ripara|come lo riparo|come lo smonto/i },
  { intent: "confronto", re: /confrontalo con questo|confronta questi|paragonalo/i },
  { intent: "arte", re: /chi l'? ?ha fatto|raccontami la storia|che opera e|chi e l'? ?autore/i },
  { intent: "specie", re: /che specie e|che pianta e|che animale e/i },
  { intent: "interno", re: /fammi vedere dentro|mostrami l'? ?interno|guarda dentro/i },
  { intent: "documento", re: /spiegamelo|leggimi questo|traducimi questo|riassumimelo/i },
];

function classifyIntent(testo) {
  const norm = testo.toLowerCase();
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(norm)) return intent;
  }
  return "generico";
}

// ---------- Stato modalita' confronto ----------
const compareState = { waiting: false, firstImage: null };

// ---------- Router comandi vocali ----------

async function handleVoiceCommand(testo) {
  terminalLog(`> ${testo}`);
  document.getElementById("reticle-target-label").textContent = "";

  const intent = classifyIntent(testo);
  let frameDataUrl;
  try {
    frameDataUrl = captureFrameAsDataUrl();
  } catch (err) {
    setResponseBox(err.message);
    terminalLog("Errore cattura frame: " + err.message);
    return;
  }

  if (intent === "confronto") {
    compareState.waiting = true;
    compareState.firstImage = frameDataUrl;
    document.getElementById("compare-indicator").classList.remove("hidden");
    setResponseBox("Primo oggetto memorizzato. Inquadra il secondo e tocca di nuovo il microfono.");
    terminalLog("Modalita' confronto: in attesa del secondo oggetto.");
    return;
  }

  setResponseBox("Sto pensando...");
  terminalLog("Sto pensando...");

  try {
    switch (intent) {
      case "memoria":
        await handleMemoryQuery(testo);
        break;
      case "scheda":
        await handleSchedaCompleta(frameDataUrl);
        break;
      case "prezzo":
        await handleTestoRapido(frameDataUrl,
          "Stima il prezzo medio indicativo di questo oggetto e, se puoi, un paio di alternative simili. Rispondi in italiano in massimo 3 frasi.",
          "NOTA: prezzo stimato dalla conoscenza generale dell'IA, non un dato di mercato in tempo reale.");
        break;
      case "misura":
        await handleTestoRapido(frameDataUrl,
          "Stima dimensioni (altezza, larghezza, profondita') e peso approssimativi di questo oggetto in base al contesto visivo. Rispondi in italiano in massimo 3 frasi.",
          "NOTA: stima visiva approssimata, non una misurazione reale (richiederebbe sensori LiDAR/ARKit non disponibili in questa PWA).");
        break;
      case "funzionamento":
        await handleTestoRapido(frameDataUrl,
          "Spiega in modo semplice e chiaro come funziona questo oggetto/dispositivo. Rispondi in italiano in massimo 4 frasi.");
        break;
      case "riparazione":
        await handleTestoRapido(frameDataUrl,
          "Spiega come si smonta o ripara questo oggetto: ordine dei passaggi principali, parti delicate a cui fare attenzione, eventuali rischi. Rispondi in italiano in modo conciso ma utile.",
          "NOTA: indicazioni generali dell'IA, verifica sempre un manuale ufficiale prima di intervenire.");
        break;
      case "arte":
        await handleTestoRapido(frameDataUrl,
          "Se riconosci quest'opera/monumento, racconta autore, periodo storico, stile e un aneddoto interessante. Se non lo riconosci con certezza, dillo chiaramente. Rispondi in italiano in massimo 4 frasi.");
        break;
      case "specie":
        await handleTestoRapido(frameDataUrl,
          "Identifica la specie di questa pianta o animale e dai le info principali (habitat, caratteristiche). Se non sei sicuro, dillo chiaramente. Rispondi in italiano in massimo 3 frasi.");
        break;
      case "interno":
        await handleGuardaDentro(frameDataUrl);
        break;
      case "documento":
        await handleDocumento(frameDataUrl);
        break;
      default:
        await handleGenerico(testo, frameDataUrl);
    }
  } catch (err) {
    setResponseBox("Errore di connessione al sistema.");
    terminalLog("Errore: " + err.message);
  }
}

// ---------- Gestori per singolo intento ----------

async function handleGenerico(testo, frameDataUrl) {
  const risposta = await askJarvisVision(
    `Sei Jarvis, un assistente stile Iron Man. Rispondi in italiano, in modo conciso (max 3 frasi), a questa domanda sull'immagine: ${testo}`,
    [frameDataUrl]
  );
  setResponseBox(risposta);
  terminalLog("Risposta pronta.");
  speak(risposta);
  logCurrentSighting(risposta, frameDataUrl);
}

async function handleTestoRapido(frameDataUrl, promptBase, notaSuffisso) {
  const risposta = await askJarvisVision(
    `Sei Jarvis, un assistente stile Iron Man. ${promptBase}`,
    [frameDataUrl]
  );
  const finale = notaSuffisso ? `${risposta}\n\n${notaSuffisso}` : risposta;
  setResponseBox(risposta);
  terminalLog("Risposta pronta.");
  speak(risposta);
  logCurrentSighting(risposta, frameDataUrl);
}

async function handleMemoryQuery(testo) {
  // Estrae una possibile parola chiave dalla domanda (molto semplice: usa le
  // parole piu' lunghe della frase, escludendo le parole di comando).
  const stopwords = ["dove", "ho", "lasciato", "hai", "gia", "già", "visto", "dov'era", "dov era", "quando", "questo", "questa", "il", "lo", "la", "i", "gli", "le", "un", "una"];
  const parole = testo.toLowerCase().replace(/[?.,!]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stopwords.includes(w));
  const chiave = parole[parole.length - 1] || "";

  if (!chiave) {
    setResponseBox("Non ho capito quale oggetto cercare. Prova a ripetere con il nome dell'oggetto.");
    terminalLog("Query memoria: nessuna parola chiave estratta.");
    return;
  }

  const risultati = await JarvisMemory.findSightingsByName(chiave);
  if (!risultati.length) {
    const risposta = `Non ho ancora registrato osservazioni di "${chiave}" nella mia memoria visiva.`;
    setResponseBox(risposta);
    speak(risposta);
    terminalLog("Nessun risultato in memoria per: " + chiave);
    return;
  }

  const ultimo = risultati[0];
  const quando = new Date(ultimo.timestamp).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const posInfo = (ultimo.lat && ultimo.lon) ? ` (posizione: ${ultimo.lat.toFixed(4)}, ${ultimo.lon.toFixed(4)})` : "";
  const risposta = `Ultima volta che ho visto "${ultimo.nome}": ${quando}${posInfo}. ${ultimo.descrizione || ""}`.trim();
  setResponseBox(risposta);
  speak(`Ultima volta che ho visto ${ultimo.nome}: ${quando}.`);
  terminalLog(`Trovati ${risultati.length} avvistamenti per: ${chiave}`);

  if (ultimo.imageDataUrl) {
    openCard(`MEMORIA: ${ultimo.nome.toUpperCase()}`, ultimo.imageDataUrl, {
      "ULTIMO AVVISTAMENTO": quando,
      "DESCRIZIONE": ultimo.descrizione || "-",
      "POSIZIONE": posInfo || "non disponibile",
      "AVVISTAMENTI TOTALI": String(risultati.length),
    });
  }
}

async function handleSchedaCompleta(frameDataUrl) {
  const promptJson = `Sei Jarvis. Analizza l'oggetto principale nell'immagine e rispondi SOLO con un oggetto JSON valido (nessun testo fuori dal JSON), con queste chiavi in italiano: nome, categoria, marca_modello, anno_stimato, materiali, dimensioni_stimate, prezzo_medio_stimato, come_funziona, curiosita, descrizione. Se un'informazione non e' determinabile con certezza dall'immagine, scrivi "non determinabile".`;
  const raw = await askJarvisVision(promptJson, [frameDataUrl], true);
  const dati = parseJsonLoose(raw);

  if (!dati) {
    setResponseBox("Non sono riuscito a costruire una scheda completa per questo oggetto.");
    terminalLog("Scheda: parsing JSON fallito.");
    return;
  }

  const nome = dati.nome || "Oggetto sconosciuto";
  setResponseBox(`Scheda pronta per: ${nome}`);
  speak(`Ecco la scheda di ${nome}`);
  terminalLog("Scheda oggetto generata: " + nome);

  openCard(nome.toUpperCase(), frameDataUrl, {
    "CATEGORIA": dati.categoria,
    "MARCA / MODELLO": dati.marca_modello,
    "ANNO STIMATO": dati.anno_stimato,
    "MATERIALI": dati.materiali,
    "DIMENSIONI STIMATE": dati.dimensioni_stimate,
    "PREZZO MEDIO STIMATO": dati.prezzo_medio_stimato,
    "COME FUNZIONA": dati.come_funziona,
    "CURIOSITA'": dati.curiosita,
    "DESCRIZIONE": dati.descrizione,
    "NOTA": "Dati generati dall'IA sulla base dell'immagine, non verificati su fonti esterne in tempo reale.",
  });

  logCurrentSighting(dati.descrizione || nome, frameDataUrl, nome);
}

async function handleGuardaDentro(frameDataUrl) {
  const promptJson = `Sei Jarvis. Immagina di dover spiegare i componenti interni visibili o probabili di questo oggetto, come in una vista esplosa. Rispondi SOLO con un oggetto JSON valido con chiave "componenti", che e' una lista di oggetti ciascuno con "nome" e "funzione". Rispondi in italiano.`;
  const raw = await askJarvisVision(promptJson, [frameDataUrl], true);
  const dati = parseJsonLoose(raw);

  if (!dati || !Array.isArray(dati.componenti)) {
    setResponseBox("Non riesco a generare una scomposizione affidabile per questo oggetto.");
    return;
  }

  const corpo = dati.componenti.map((c) => `${c.nome}: ${c.funzione}`).join("\n");
  setResponseBox("Vista esplosa generata (vedi scheda).");
  terminalLog("Guarda dentro: generati " + dati.componenti.length + " componenti.");

  const fields = {};
  dati.componenti.forEach((c, i) => { fields[`${i + 1}. ${c.nome}`] = c.funzione; });
  fields["NOTA"] = "Spiegazione generata dall'IA in base all'aspetto esterno, non un vero modello CAD/esploso.";
  openCard("VISTA ESPLOSA (STIMATA)", frameDataUrl, fields);
}

async function handleDocumento(frameDataUrl) {
  const risposta = await askJarvisVision(
    "Sei Jarvis. Leggi il testo visibile nell'immagine, riassumilo nei punti principali e, se e' in una lingua diversa dall'italiano, traducilo. Rispondi in italiano in modo chiaro e conciso.",
    [frameDataUrl]
  );
  setResponseBox(risposta);
  terminalLog("Documento letto e riassunto.");
  speak("Ecco il riassunto del testo.");
}

// ---------- Modalita' confronto: cattura del secondo oggetto ----------

async function processComparison(secondImage) {
  document.getElementById("compare-indicator").classList.add("hidden");
  setResponseBox("Confronto in corso...");
  terminalLog("Confronto tra i due oggetti in corso...");

  try {
    const promptJson = `Sei Jarvis. Ti mando due immagini di due oggetti diversi. Confrontali e rispondi SOLO con un oggetto JSON valido con chiavi: oggetto_1, oggetto_2, differenze_principali, vantaggi_oggetto_1, vantaggi_oggetto_2, quale_consiglieresti. Rispondi in italiano.`;
    const raw = await askJarvisVision(promptJson, [compareState.firstImage, secondImage], true);
    const dati = parseJsonLoose(raw);

    if (!dati) {
      setResponseBox("Non sono riuscito a confrontare i due oggetti.");
      return;
    }

    setResponseBox(`Confronto pronto: ${dati.oggetto_1} vs ${dati.oggetto_2}`);
    speak("Ho completato il confronto.");
    openCard("CONFRONTO OGGETTI", secondImage, {
      [dati.oggetto_1 || "OGGETTO 1"]: dati.vantaggi_oggetto_1,
      [dati.oggetto_2 || "OGGETTO 2"]: dati.vantaggi_oggetto_2,
      "DIFFERENZE PRINCIPALI": dati.differenze_principali,
      "CONSIGLIO": dati.quale_consiglieresti,
    });
  } catch (err) {
    setResponseBox("Errore durante il confronto.");
    terminalLog("Errore confronto: " + err.message);
  } finally {
    compareState.waiting = false;
    compareState.firstImage = null;
  }
}

// ---------- Scheda oggetto: apertura/chiusura modale ----------

function openCard(title, imageDataUrl, fields) {
  document.getElementById("card-title").textContent = title;
  const img = document.getElementById("card-image");
  if (imageDataUrl) {
    img.src = imageDataUrl;
    document.getElementById("card-image-wrap").style.display = "block";
  } else {
    document.getElementById("card-image-wrap").style.display = "none";
  }
  const body = document.getElementById("card-body");
  body.innerHTML = "";
  Object.entries(fields).forEach(([label, value]) => {
    if (!value) return;
    const labelEl = document.createElement("span");
    labelEl.className = "card-field-label";
    labelEl.textContent = label;
    const valEl = document.createElement("div");
    valEl.textContent = value;
    body.appendChild(labelEl);
    body.appendChild(valEl);
  });
  document.getElementById("card-modal").classList.remove("hidden");
}

document.getElementById("btn-card-close").addEventListener("click", () => {
  document.getElementById("card-modal").classList.add("hidden");
});

// ---------- Utility: parsing JSON permissivo (Groq a volte aggiunge testo attorno) ----------

function parseJsonLoose(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (err2) { return null; }
    }
    return null;
  }
}

// ---------- Memoria visiva: logging + rilevamento cambiamenti ----------

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function logCurrentSighting(descrizione, imageDataUrl, nomeForzato) {
  const nome = nomeForzato || guessNameFromText(descrizione);
  if (!nome) return;

  const pos = leafletMarker ? leafletMarker.getLatLng() : null;
  const lat = pos ? pos.lat : null;
  const lon = pos ? pos.lng : null;

  try {
    const precedenti = await JarvisMemory.findSightingsByName(nome);
    if (precedenti.length && lat != null && precedenti[0].lat != null) {
      const distanza = haversineMeters(lat, lon, precedenti[0].lat, precedenti[0].lon);
      if (distanza > 50) {
        pushNotification(`"${nome}" sembra essersi spostato rispetto all'ultima posizione nota.`);
      }
    }
    await JarvisMemory.logSighting({ nome, descrizione, lat, lon, imageDataUrl });
  } catch (err) {
    terminalLog("Errore salvataggio memoria visiva: " + err.message);
  }
}

function guessNameFromText(testo) {
  if (!testo) return null;
  // Euristica semplice: prende le prime 3-4 parole significative della
  // risposta come "nome" dell'oggetto osservato, in assenza di un campo
  // nome strutturato.
  const parole = testo.split(/\s+/).slice(0, 4).join(" ").replace(/[.,!?]/g, "");
  return parole || null;
}

// ---------- Scansione continua (overlay riquadri) ----------

let scanInterval = null;
let scanActive = false;

document.getElementById("btn-scan-toggle").addEventListener("click", () => {
  scanActive = !scanActive;
  const btn = document.getElementById("btn-scan-toggle");
  if (scanActive) {
    btn.textContent = "SCAN: ON";
    btn.classList.add("active");
    terminalLog("Scansione continua attivata.");
    runContinuousScan();
    scanInterval = setInterval(runContinuousScan, 6000);
  } else {
    btn.textContent = "SCAN: OFF";
    btn.classList.remove("active");
    clearInterval(scanInterval);
    document.getElementById("overlay-boxes").innerHTML = "";
    terminalLog("Scansione continua disattivata.");
  }
});

let scanBusy = false;
async function runContinuousScan() {
  if (scanBusy || isListening) return;
  scanBusy = true;
  try {
    const frameDataUrl = captureFrameAsDataUrl();
    const promptJson = `Individua fino a 3 oggetti principali visibili nell'immagine. Rispondi SOLO con un oggetto JSON valido con chiave "oggetti": lista di elementi con "nome" e "box" (box = {x, y, larghezza, altezza} in percentuale 0-100 rispetto all'immagine, dove x/y sono l'angolo in alto a sinistra). Rispondi in italiano, sii breve.`;
    const raw = await askJarvisVision(promptJson, [frameDataUrl], true);
    const dati = parseJsonLoose(raw);
    if (dati && Array.isArray(dati.oggetti)) {
      renderOverlayBoxes(dati.oggetti);
    }
  } catch (err) {
    // Scansione continua e' best-effort: non interrompe l'app in caso di errore
    terminalLog("Scan: errore temporaneo (" + err.message + ")");
  } finally {
    scanBusy = false;
  }
}

function renderOverlayBoxes(oggetti) {
  const layer = document.getElementById("overlay-boxes");
  layer.innerHTML = "";
  oggetti.forEach((o) => {
    if (!o.box) return;
    const { x, y, larghezza, altezza } = o.box;
    if ([x, y, larghezza, altezza].some((v) => typeof v !== "number")) return;
    const box = document.createElement("div");
    box.className = "obj-box";
    box.style.left = `${x}%`;
    box.style.top = `${y}%`;
    box.style.width = `${larghezza}%`;
    box.style.height = `${altezza}%`;
    const label = document.createElement("div");
    label.className = "obj-box-label";
    label.textContent = o.nome || "?";
    box.appendChild(label);
    layer.appendChild(box);
  });
}

function setResponseBox(text) {
  document.getElementById("response-box").textContent = text;
}

// ---------- Chiamata al Worker (Groq vision) ----------

// promptTesto: istruzione testuale per Jarvis
// immagini: array di data URL (una per la maggior parte dei comandi, due per il confronto)
// jsonMode: se true, chiede a Groq di rispondere in JSON valido (usa response_format)
async function askJarvisVision(promptTesto, immagini, jsonMode) {
  const istruzioneLingua = "IMPORTANTE: rispondi ESCLUSIVAMENTE in lingua italiana, mai in inglese, senza premesse o ragionamenti visibili prima della risposta. ";
  const contenuto = [{ type: "text", text: istruzioneLingua + promptTesto }];
  immagini.forEach((img) => {
    contenuto.push({ type: "image_url", image_url: { url: img } });
  });

  const payload = {
    model: CONFIG.GROQ_VISION_MODEL,
    messages: [{ role: "user", content: contenuto }],
    max_completion_tokens: 600,
    temperature: 0.4,
  };
  if (jsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const res = await fetch(CONFIG.WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let dettaglio = "";
    try {
      const errBody = await res.json();
      dettaglio = errBody?.error?.message || errBody?.error || JSON.stringify(errBody);
    } catch (e) { /* ignora, body non leggibile */ }
    terminalLog(`Errore Groq (${res.status}): ${dettaglio || "nessun dettaglio"}`);
    throw new Error("Worker ha risposto con status " + res.status);
  }
  const data = await res.json();
  let testo = data?.choices?.[0]?.message?.content?.trim() || "Nessuna risposta disponibile.";
  // Rimuove eventuali blocchi di "ragionamento" che alcuni modelli lasciano nell'output
  testo = testo.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return testo;
}

// ---------- Sintesi vocale ----------

let speechUnlocked = false;

function unlockSpeech() {
  if (speechUnlocked || !("speechSynthesis" in window)) return;
  // Su iOS Safari, speechSynthesis.speak() funziona in modo affidabile solo se
  // la prima chiamata avviene direttamente dentro un gesto dell'utente (tap).
  // Qui "sblocchiamo" il motore con un'utterance silenziosa, cosi' le chiamate
  // successive (anche dopo una risposta asincrona di Groq) continuano a funzionare.
  const unlock = new SpeechSynthesisUtterance(" ");
  unlock.volume = 0;
  window.speechSynthesis.speak(unlock);
  speechUnlocked = true;
}

let italianVoice = null;
function pickItalianVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  const italiane = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("it"));
  // Preferisce voci "Migliorate/Premium" (di solito hanno nomi piu' naturali,
  // es. "Alice (Migliorata)"), altrimenti prende la prima italiana disponibile.
  italianVoice = italiane.find((v) => /migliorat|enhanced|premium|neural/i.test(v.name)) || italiane[0] || null;
}
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = pickItalianVoice;
  pickItalianVoice();
}

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel(); // evita accavallamenti tra risposte
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "it-IT";
  if (italianVoice) utter.voice = italianVoice;
  utter.rate = 1.02;
  window.speechSynthesis.speak(utter);
}
