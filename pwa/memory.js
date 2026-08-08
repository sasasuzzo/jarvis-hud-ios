// ------------------------------------------------------------------
// Memoria locale della PWA, tramite IndexedDB.
// - vitals: dati inseriti manualmente (sonno/battiti/energia/stato)
// - sightings: log della memoria visiva (oggetti/persone osservati)
// ------------------------------------------------------------------

const DB_NAME = "jarvis_hud_db";
const DB_VERSION = 1;
const STORE_VITALS = "vitals";
const STORE_SIGHTINGS = "sightings"; // pronto per la fase memoria visiva

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_VITALS)) {
        db.createObjectStore(STORE_VITALS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_SIGHTINGS)) {
        const store = db.createObjectStore(STORE_SIGHTINGS, { keyPath: "id", autoIncrement: true });
        store.createIndex("nome", "nome", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const JarvisMemory = {
  async saveVitals(vitals) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VITALS, "readwrite");
      tx.objectStore(STORE_VITALS).put({ id: "current", ...vitals, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getVitals() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VITALS, "readonly");
      const req = tx.objectStore(STORE_VITALS).get("current");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  // Predisposto per la fase 2 (memoria visiva): salva un avvistamento
  async logSighting({ nome, descrizione, lat, lon, imageDataUrl }) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SIGHTINGS, "readwrite");
      tx.objectStore(STORE_SIGHTINGS).add({
        nome, descrizione, lat, lon, imageDataUrl,
        timestamp: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  // Ritorna tutti gli avvistamenti il cui nome contiene la stringa data
  // (case-insensitive). Usato per rispondere a "dove ho lasciato X".
  async findSightingsByName(query) {
    const db = await openDB();
    const q = query.trim().toLowerCase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SIGHTINGS, "readonly");
      const results = [];
      const req = tx.objectStore(STORE_SIGHTINGS).openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.nome && cursor.value.nome.toLowerCase().includes(q)) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          results.sort((a, b) => b.timestamp - a.timestamp);
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getRecentSightings(limit = 20) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SIGHTINGS, "readonly");
      const results = [];
      const req = tx.objectStore(STORE_SIGHTINGS).index("timestamp").openCursor(null, "prev");
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  },
};
