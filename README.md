# J.A.R.V.I.S. HUD (iOS PWA, indipendente)

HUD stile Iron Man che gira interamente sul telefono (Safari, come app installata
in stile PWA), senza dipendere dal PC. La chiave Groq resta nascosta in un
Worker Cloudflare che fa da proxy.

## Struttura

```
worker/            -> Cloudflare Worker: proxy verso Groq (nasconde la chiave)
  index.js
  wrangler.toml

pwa/                -> l'app vera e propria, va pubblicata su GitHub Pages
  index.html
  style.css
  app.js
  config.js         -> qui metti l'URL del tuo Worker (nessun segreto)
  memory.js         -> IndexedDB locale (vitali + base per memoria visiva futura)
  manifest.json
  sw.js
  icons/
```

## 1. Pubblica il repo su GitHub

Metti tutta questa cartella nel tuo repo GitHub (root del repo, oppure una
sottocartella: adatta i path se scegli una sottocartella).

## 2. Collega il Worker Cloudflare

1. Su [dash.cloudflare.com](https://dash.cloudflare.com) crea un Worker (es. nome
   `jarvis-hud-proxy`).
2. In *Settings -> Variables and Secrets* aggiungi il secret `GROQ_API_KEY`
   con la tua chiave Groq.
3. (Consigliato) aggiungi anche `ALLOWED_ORIGIN` con l'URL esatto della tua
   PWA una volta pubblicata (es. `https://tuonome.github.io`), cosi solo la
   tua PWA puo' usare il proxy.
4. Puoi collegare il Worker al repo GitHub (*Settings -> Build*) per il deploy
   automatico del contenuto di `worker/`, oppure pubblicarlo manualmente con
   `wrangler deploy` da dentro la cartella `worker/`.
5. Copia l'URL finale del Worker (tipo
   `https://jarvis-hud-proxy.tuoaccount.workers.dev`).

## 3. Configura la PWA

Apri `pwa/config.js` e sostituisci `WORKER_URL` con l'URL copiato al punto
precedente. Controlla anche i nomi dei modelli Groq (`GROQ_VISION_MODEL`,
`GROQ_TEXT_MODEL`): i nomi modello di Groq cambiano nel tempo, verificali
sulla dashboard Groq (console.groq.com) prima del primo test, potrebbero
essere stati rinominati o deprecati.

## 4. Pubblica la PWA su GitHub Pages

Nel repo: *Settings -> Pages -> Deploy from a branch* -> scegli il branch e
la cartella `/pwa` (o `/` se hai messo i file di `pwa/` nella root).
Dopo qualche minuto la PWA sara' raggiungibile su un URL tipo
`https://tuonome.github.io/nome-repo/`.

**Importante**: la fotocamera e il microfono funzionano solo su **HTTPS**
(GitHub Pages lo fornisce automaticamente) o su `localhost` in locale.

## 5. Installa sull'iPhone

1. Apri l'URL della PWA in Safari (non Chrome: su iOS serve Safari per
   installare le PWA).
2. Tocca l'icona di condivisione -> **Aggiungi a Home**.
3. Apri l'app dall'icona in home: partira' a schermo intero come un'app
   nativa.

## Cosa fa questa versione (tutte le fasi, con limiti dichiarati)

**Base HUD**
- Fotocamera fullscreen, mirino animato, mappa GPS, meteo, orologio, avatar
  3D stilizzato + vitali manuali, terminale di stato, notifiche

**Comandi vocali naturali (nessun pulsante "attiva modalita'")**
Basta parlare dopo aver toccato il microfono. Frasi riconosciute:
- "Dove ho lasciato / hai gia' visto / dov'era [oggetto]" -> cerca nella
  memoria visiva locale (IndexedDB) e mostra ultima posizione/orario/foto
- "Cos'e' questo / dimmi di piu' / analizza questo" -> scheda oggetto
  completa (categoria, marca/modello, anno, materiali, dimensioni, prezzo,
  come funziona, curiosita')
- "Quanto costa" -> stima prezzo (IA, non dato di mercato live)
- "Quanto misura" -> stima dimensioni/peso (visiva, non misurazione reale)
- "Come funziona" -> spiegazione tecnica
- "Come si smonta / ripara" -> guida generale ai passaggi e rischi
- "Confrontalo con questo" -> modalita' confronto: memorizza il primo
  oggetto, poi tocca di nuovo il microfono inquadrando il secondo oggetto
  (non serve parlare la seconda volta)
- "Chi l'ha fatto / raccontami la storia" -> opere d'arte/monumenti
- "Che specie e'" -> piante/animali
- "Fammi vedere dentro / mostrami l'interno" -> scomposizione a componenti
  generata dall'IA (vedi limiti sotto)
- "Spiegamelo / leggimi questo / traducimi questo" -> lettura, riassunto e
  traduzione del testo inquadrato
- qualunque altra domanda -> risposta generica sull'immagine

**Memoria visiva persistente**
Ogni identificazione viene salvata in IndexedDB con nome, descrizione,
timestamp, posizione GPS e foto. Se un oggetto ricompare in una posizione
molto diversa dall'ultima nota (>50 metri), Jarvis genera una notifica di
possibile spostamento.

**Scansione continua (pulsante SCAN in basso a destra)**
Quando attiva, ogni ~6 secondi cattura un fotogramma e chiede a Groq vision
fino a 3 oggetti con posizione approssimata, disegnando riquadri overlay sul
feed. E' utile per "sentire" l'ambiente in automatico, ma consuma chiamate
API continuamente: usala quando serve, non lasciarla sempre accesa se vuoi
contenere i costi/la latenza.

## Limiti onesti di questa versione

- **Prezzi, misure, "guarda dentro"**: sono stime generate dal modello IA
  guardando l'immagine, non dati verificati su fonti esterne in tempo reale
  (niente vero scraping prezzi, niente vero CAD/esploso, niente sensori di
  profondita'). Ogni risposta di questo tipo include una nota che lo chiarisce.
- **Bounding box della scansione continua**: i modelli vision non sono
  addestrati per l'object detection pixel-precisa, quindi i riquadri sono
  indicativi, non millimetrici.
- **Riconoscimento del "nome" per la memoria visiva**: senza un modello di
  object detection dedicato, il nome salvato e' un'euristica (prime parole
  della risposta), quindi le query "dove ho lasciato X" funzionano meglio
  se X e' una parola che il modello userebbe naturalmente per descriverlo.
- **Vitali (sonno/battiti/energia)**: restano manuali, richiedono un'app
  nativa con HealthKit per essere automatici.
- **Notifiche/chiamate di sistema**: non leggibili da nessuna app su iOS
  (limite Apple), il pannello mostra solo notifiche generate da Jarvis
  stesso (es. avvisi di spostamento oggetti).
- **Costi/latenza**: ogni comando vocale e ogni ciclo di scansione continua
  e' una chiamata API a pagamento (secondo il tuo piano Groq) con qualche
  secondo di attesa; non e' un'analisi istantanea "ogni fotogramma" come
  descritto nell'ispirazione cinematografica originale.

## Prossimi miglioramenti possibili (se vuoi spingere oltre)

- Sostituire l'euristica del "nome" con un vero modello di object detection
  locale (es. un modello leggero via TensorFlow.js) per riconoscimento piu'
  stabile e riquadri piu' precisi, senza usare Groq per ogni frame
  della scansione continua
- Timeline visiva scorribile della memoria (oggi solo query testuale)
- Collegare il pannello notifiche a promemoria/obiettivi reali che imposti tu
- Cache locale delle schede oggetto gia' generate, per non richiederle di nuovo
