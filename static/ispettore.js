// Ispettore: una pagina di dettaglio per ogni fase del processo.
// Usa i dati dell'ultimo riconoscimento (window.ultimo) e i pesi del modello (/api/modello).

const FASI_ISP = [
  { id: "prep", gruppo: "client", titolo: "Preprocessing" },
  { id: "norm", gruppo: "client", titolo: "Normalizzazione" },
  { id: "chiavi", gruppo: "client", titolo: "Chiavi e parametri CKKS" },
  { id: "im2col", gruppo: "client", titolo: "Codifica im2col" },
  { id: "cifra", gruppo: "client", titolo: "Cifratura" },
  { id: "rete", gruppo: "rete", titolo: "Cosa viaggia in rete" },
  { id: "conv", gruppo: "server", titolo: "conv", passo: 1 },
  { id: "q1", gruppo: "server", titolo: "x² (prima)", passo: 2 },
  { id: "fc1", gruppo: "server", titolo: "fc1", passo: 3 },
  { id: "q2", gruppo: "server", titolo: "x² (seconda)", passo: 4 },
  { id: "fc2", gruppo: "server", titolo: "fc2", passo: 5 },
  { id: "livelli", gruppo: "server", titolo: "Livelli consumati" },
  { id: "dec", gruppo: "ritorno", titolo: "Decifratura" },
];
const GRUPPI = {
  client: "Client · prima dell'invio",
  rete: "Rete",
  server: "Server · sul ciphertext",
  ritorno: "Client · al ritorno",
};

const ISP = { indice: 0, modello: null };

// ───────────────────────── utilità ─────────────────────────

function h(tag, props = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of figli.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(f));
  return e;
}

const APICI = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const num = (v, cifre = 4) => {
  if (Math.abs(v) > 0 && Math.abs(v) < 1e-3) {
    const [m, e] = v.toExponential(1).split("e");
    return m.replace(".", ",") + "×10" + [...String(+e)].map((c) => APICI[c]).join("");
  }
  return v.toLocaleString("it-IT", { maximumFractionDigits: cifre });
};
const mb = (b) => (b >= 1e6 ? num(b / 1e6, 1) + " MB" : b >= 1e3 ? num(b / 1e3, 0) + " kB" : b + " B");
const ms = (t) => (t >= 1000 ? num(t / 1000, 2) + " s" : num(t, 0) + " ms");
const minimo = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const massimo = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);

const tip = h("div", { id: "tip", hidden: "" });
document.body.append(tip);
function suggerimento(el, testo) {
  el.addEventListener("mousemove", (e) => {
    const t = testo(e);
    if (t == null) return (tip.hidden = true);
    tip.textContent = t;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = e.clientY + 16 + "px";
  });
  el.addEventListener("mouseleave", () => (tip.hidden = true));
}

function colore(v, scala, lo, hi, m) {
  if (scala === "grigio") {
    const t = hi === lo ? 0 : (v - lo) / (hi - lo);
    const g = Math.round(255 * Math.max(0, Math.min(1, t)));
    return [g, g, g, 255];
  }
  // divergente: blu per i negativi, il fondo scuro per lo zero, rosso per i positivi
  const t = Math.max(-1, Math.min(1, v / m));
  const base = [28, 32, 38];
  const fine = t >= 0 ? [239, 143, 143] : [127, 168, 255];
  const a = Math.abs(t);
  return [0, 1, 2].map((k) => Math.round(base[k] + (fine[k] - base[k]) * a)).concat(255);
}

// Mappa di calore ispezionabile: passa sopra una cella per leggerne il valore.
function mappa(valori, righe, colonne, { scala = "div", cella = 8, etichetta, min, max } = {}) {
  const c = h("canvas", { class: "mappa" + (scala === "div" ? " div" : "") });
  c.width = colonne;
  c.height = righe;
  c.style.width = colonne * cella + "px";
  c.style.height = righe * cella + "px";
  const g = c.getContext("2d");
  const img = g.createImageData(colonne, righe);
  const lo = min ?? minimo(valori);
  const hi = max ?? massimo(valori);
  const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
  valori.forEach((v, i) => img.data.set(colore(v, scala, lo, hi, m), i * 4));
  g.putImageData(img, 0, 0);
  suggerimento(c, (e) => {
    const r = c.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * colonne);
    const riga = Math.floor(((e.clientY - r.top) / r.height) * righe);
    if (col < 0 || riga < 0 || col >= colonne || riga >= righe) return null;
    const v = valori[riga * colonne + col];
    return etichetta ? etichetta(riga, col, v) : `[${riga}, ${col}] = ${num(v)}`;
  });
  return c;
}

function legendaDiv(valori) {
  const m = Math.max(Math.abs(minimo(valori)), Math.abs(massimo(valori)));
  return h("div", { class: "legenda" }, h("span", {}, "−" + num(m, 2)), h("i"), h("span", {}, "+" + num(m, 2)));
}

// Vettore come barre (positive verso l'alto, negative verso il basso).
function vettore(valori, { etichette, evidenzia = -1, altezza = 130, testo } = {}) {
  const lo = Math.min(0, minimo(valori));
  const hi = Math.max(0, massimo(valori));
  const ampiezza = hi - lo || 1;
  const zero = (-lo / ampiezza) * 100;
  const box = h("div", { class: "vettore", style: `height:${altezza}px` });
  valori.forEach((v, i) => {
    const alto = (Math.abs(v) / ampiezza) * 100;
    const barra = h("i", {
      class: (v < 0 ? "neg" : "pos") + (i === evidenzia ? " evid" : ""),
      style: `bottom:${v >= 0 ? zero : zero - alto}%;height:${Math.max(alto, 0.6)}%`,
    });
    const col = h("div", { class: "col" }, barra);
    suggerimento(col, () => (testo ? testo(i, v) : `[${i}] = ${num(v)}`));
    box.append(col);
  });
  box.append(h("div", { class: "zero", style: `bottom:${zero}%` }));
  const out = h("div", { class: "vettore-box" }, box);
  if (etichette) out.append(h("div", { class: "etichette-v" }, etichette.map((t, i) => h("span", { class: i === evidenzia ? "evid" : "" }, t))));
  return out;
}

// Dispersione: valori in chiaro (x) contro valori decifrati (y). Sulla diagonale = identici.
function dispersione(x, y, lato = 230) {
  const lo = Math.min(minimo(x), minimo(y));
  const hi = Math.max(massimo(x), massimo(y));
  const P = (v) => 24 + ((v - lo) / (hi - lo || 1)) * (lato - 36);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${lato} ${lato}`);
  svg.setAttribute("class", "dispersione");
  const el = (t, a) => {
    const n = document.createElementNS(ns, t);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
    svg.append(n);
    return n;
  };
  el("rect", { x: 24, y: 12, width: lato - 36, height: lato - 36, class: "cornice" });
  el("line", { x1: P(lo), y1: lato - P(lo), x2: P(hi), y2: lato - P(hi), class: "diagonale" });
  x.forEach((v, i) => {
    const p = el("circle", { cx: P(v), cy: lato - P(y[i]), r: 2.6, class: "punto" });
    suggerimento(p, () => `[${i}] PyTorch ${num(v, 5)} · decifrato ${num(y[i], 5)}`);
  });
  const t1 = el("text", { x: lato / 2, y: lato - 2, class: "asse" });
  t1.textContent = "PyTorch in chiaro";
  const t2 = el("text", { x: 10, y: lato / 2, class: "asse", transform: `rotate(-90 10 ${lato / 2})` });
  t2.textContent = "decifrato";
  return svg;
}

function metro(livello, totale = 7) {
  return h(
    "div",
    { class: "metro", title: `${livello} primi su ${totale}` },
    Array.from({ length: totale }, (_, i) => h("i", { class: i < livello ? "pieno" : "" })),
    h("span", {}, `${livello} / ${totale}`)
  );
}

const ETICHETTE_SCHEDA = { client: "Client", server: "Server", didattica: "Vista didattica", rete: "Rete", neutro: "" };
function scheda(tipo, titolo, ...contenuto) {
  return h(
    "section",
    { class: `scheda-i ${tipo}` },
    h("header", {}, ETICHETTE_SCHEDA[tipo] ? h("span", { class: "badge" }, ETICHETTE_SCHEDA[tipo]) : null, h("h4", {}, titolo)),
    ...contenuto
  );
}
const p = (testo) => h("p", { class: "spiega", html: testo });
const tabella = (righe, intestazione) =>
  h(
    "table",
    { class: "dati" },
    intestazione ? h("thead", {}, h("tr", {}, intestazione.map((t) => h("th", {}, t)))) : null,
    h("tbody", {}, righe.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))
  );
const griglia = (...figli) => h("div", { class: "griglia-i" }, ...figli);
const fila = (...figli) => h("div", { class: "fila" }, ...figli);
const figura = (el, titolo, nota) => h("figure", { class: "fig" }, el, h("figcaption", {}, h("b", {}, titolo), nota ? h("span", {}, nota) : null));
const freccia = () => h("div", { class: "freccia-i" }, "→");

const immagine = (o, lato, etichetta) =>
  mappa(o.pixel, o.h, o.w, { scala: "grigio", min: 0, max: 255, cella: lato / Math.max(o.w, o.h), etichetta });

// ───────────────────────── rete: verifica e pacchetti ─────────────────────────

// Riassume il registro: l'immagine compare in qualche pacchetto client ↔ server?
function verificaRete(R, giro) {
  const delGiro = R.pacchetti.filter((x) => x.giro === giro);
  const rete = delGiro.filter((x) => x.zona === "rete");
  const controllo = delGiro.find((x) => x.zona === "locale");
  const trovatoIn = rete.filter((x) => x.controlli && x.controlli.some((c) => c.trovato));
  const trovatiControllo = controllo?.controlli ? controllo.controlli.filter((c) => c.trovato).map((c) => c.nome) : [];
  const inviati = R.pacchetti.filter((x) => x.direzione === "client → server" && (x.giro === 0 || x.giro === giro));
  const confermati = inviati.filter((x) => x.conferma).length;
  const analizzati = rete.every((x) => x.controlli);
  return {
    rete, controllo, trovatoIn, trovatiControllo, confermati, inviati: inviati.length,
    ok: rete.length > 0 && analizzati && trovatoIn.length === 0 && trovatiControllo.length > 0 && confermati === inviati.length,
  };
}
window.verificaRete = verificaRete;

function apriPacchetto(x, dove) {
  const intestazioni = [x.prima_riga, ...Object.entries(x.intestazioni).map(([k, v]) => `${k}: ${v}`)].join("\n");
  const hexBox = h("pre", { class: "hexdump" });
  const posizione = h("span", { class: "pos-hex" });
  const vai = h("input", { type: "text", class: "vai-hex", placeholder: "offset (es. 4096 o 0x1000)" });
  const PAGINA = 512;
  let offset = 0;
  const totale = x.conservati;

  async function carica(da) {
    if (!totale) return hexBox.replaceChildren("(corpo vuoto)");
    da = Math.max(0, Math.min(da, Math.max(0, totale - 1)));
    const r = await (await fetch(`/api/rete/${x.id}/hex?da=${da}&n=${PAGINA}`)).json();
    if (r.errore) return hexBox.replaceChildren(r.errore);
    offset = r.da;
    hexBox.replaceChildren(
      ...r.righe.map((rr) =>
        h("div", {}, h("span", { class: "off" }, rr.off.toString(16).padStart(8, "0")), h("span", { class: "hx" }, rr.hex.padEnd(47, " ")), h("span", { class: "asc" }, rr.ascii))
      )
    );
    posizione.textContent = `byte ${num(offset, 0)}–${num(Math.min(offset + PAGINA, totale) - 1, 0)} di ${num(totale, 0)}`;
  }
  vai.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = vai.value.trim().toLowerCase();
    const n = v.startsWith("0x") ? parseInt(v, 16) : parseInt(v, 10);
    if (!Number.isNaN(n)) carica(n);
  });
  const btn = (testo, fn, titolo) => h("button", { onclick: fn, title: titolo }, testo);

  const controlli = x.controlli
    ? tabella(
        x.controlli.map((c) => [c.nome, c.dettaglio, h("span", { class: "pill " + (c.trovato ? (x.zona === "locale" ? "attesa" : "ko") : "ok") }, c.trovato ? "trovata" : "assente")]),
        ["forma cercata", "dettaglio", "esito"]
      )
    : p(x.nota || "Nessuna analisi: pacchetto inviato prima del disegno.");

  dove.replaceChildren(
    h(
      "div",
      { class: "contenuto-pacchetto" },
      p(x.descrizione + (x.nota ? ` <i>${x.nota}</i>` : "")),
      h("div", { class: "riepilogo interno" },
        h("div", {}, h("span", {}, "dimensione"), h("b", {}, `${num(x.byte, 0)} byte`)),
        h("div", {}, h("span", {}, "entropia"), h("b", {}, `${num(x.entropia, 3)} bit/byte`)),
        h("div", {}, h("span", {}, "SHA-256"), h("b", { class: "mono piccolo" }, x.sha256)),
        x.direzione === "client → server" ? h("div", {}, h("span", {}, "il server conferma"), h("b", {}, x.conferma ? "✓ stesso SHA-256" : "✗ diverso")) : null
      ),
      griglia(
        h("div", {}, h("div", { class: "etichetta-catena" }, "Intestazione HTTP"), h("pre", { class: "http" }, intestazioni)),
        h("div", {}, h("div", { class: "etichetta-catena" }, "Ricerca dell'immagine nel corpo"), controlli)
      ),
      h("div", { class: "etichetta-catena" }, "Corpo, byte per byte"),
      h(
        "div",
        { class: "barra-hex" },
        btn("⏮", () => carica(0), "inizio"),
        btn("←", () => carica(offset - PAGINA), "pagina precedente"),
        btn("→", () => carica(offset + PAGINA), "pagina successiva"),
        btn("centro", () => carica(Math.floor(totale / 2)), "metà del corpo"),
        btn("⏭", () => carica(totale - PAGINA), "fine"),
        vai,
        posizione,
        h("span", { class: "spazio" }),
        h("a", { class: "scarica", href: `/api/rete/${x.id}/scarica`, download: `pacchetto_${x.id}.bin` }, "Scarica .bin")
      ),
      x.conservati < x.byte ? p(`Corpo di ${mb(x.byte)}: per le dimensioni si conservano solo i primi ${mb(x.conservati)}.`) : null,
      hexBox
    )
  );
  carica(0);
}

// Finestra pop-up con il dettaglio di un pacchetto; ← → passano agli altri pacchetti.
const MODALE = { lista: [], indice: -1, el: null };

function apriModale(lista, indice) {
  if (!MODALE.el) {
    MODALE.el = h(
      "div",
      { class: "modale", hidden: "", onclick: (e) => { if (e.target === MODALE.el) chiudiModale(); } },
      h(
        "div",
        { class: "modale-finestra", role: "dialog", "aria-modal": "true" },
        h("header", { class: "modale-testata" }),
        h("div", { class: "modale-corpo" })
      )
    );
    document.getElementById("ispettore").append(MODALE.el);
  }
  MODALE.lista = lista;
  MODALE.indice = (indice + lista.length) % lista.length;
  const x = lista[MODALE.indice];

  document.querySelectorAll("table.pacchetti .riga-p").forEach((r) => r.classList.toggle("sel", +r.dataset.id === x.id));
  MODALE.el.querySelector(".modale-testata").replaceChildren(
    h("span", { class: "tratta tratta-" + x.zona }, x.zona === "locale" ? "locale" : "rete"),
    h("div", { class: "modale-titolo" },
      h("b", {}, `Pacchetto #${x.id} · ${x.direzione}`),
      h("span", { class: "mono" }, `${x.prima_riga} · ${mb(x.byte)} · ${x.ora}`)),
    h("span", { class: "spazio" }),
    h("span", { class: "pos-i" }, `${MODALE.indice + 1} / ${lista.length}`),
    h("button", { title: "pacchetto precedente (←)", onclick: () => apriModale(MODALE.lista, MODALE.indice - 1) }, "←"),
    h("button", { title: "pacchetto successivo (→)", onclick: () => apriModale(MODALE.lista, MODALE.indice + 1) }, "→"),
    h("button", { class: "chiudi-modale", title: "chiudi (Esc)", onclick: chiudiModale }, "✕")
  );
  const corpo = MODALE.el.querySelector(".modale-corpo");
  apriPacchetto(x, corpo);
  corpo.scrollTop = 0;
  MODALE.el.hidden = false;
}

function chiudiModale() {
  if (!MODALE.el || MODALE.el.hidden) return false;
  MODALE.el.hidden = true;
  tip.hidden = true;
  return true;
}

// ───────────────────────── pagine ─────────────────────────

const PAGINE = {
  prep(d) {
    const P = d.preprocessing;
    const [H, W] = P.originale;
    const [x0, y0, x1, y1] = P.riquadro;
    const disegno = h(
      "div",
      { class: "sovrapposto", style: "width:150px;height:150px" },
      h("img", { src: window.ultimoDisegno, class: "piena" }),
      h("div", {
        class: "riquadro",
        style: `left:${(x0 / W) * 100}%;top:${(y0 / H) * 100}%;width:${((x1 - x0 + 1) / W) * 100}%;height:${((y1 - y0 + 1) / H) * 100}%`,
      })
    );
    const finale = h(
      "div",
      { class: "sovrapposto" },
      immagine({ w: 28, h: 28, pixel: P.finale }, 150, (r, c, v) => `pixel (${r}, ${c}) = ${v}`),
      h("div", { class: "mirino" })
    );
    return [
      p("Il disegno viene trasformato nello stesso formato delle immagini MNIST usate in training. Senza questo passaggio la rete vedrebbe cifre con proporzioni e posizione diverse da quelle che ha imparato."),
      scheda(
        "client",
        "Dal disegno a 28×28 pixel",
        fila(
          figura(disegno, "1. Disegno", `${W}×${H} px; riquadro della cifra ${x1 - x0 + 1}×${y1 - y0 + 1}`),
          freccia(),
          figura(immagine(P.ritaglio, 150), "2. Ritaglio", "solo la zona con pixel > 30"),
          freccia(),
          figura(immagine(P.ridotta, 150 * (Math.max(P.ridotta.w, P.ridotta.h) / 28), (r, c, v) => `(${r}, ${c}) = ${Math.round(v)}`), "3. Riduzione", `lato lungo a 20 px (×${num(P.fattore, 3)}): ${P.ridotta.w}×${P.ridotta.h}`),
          freccia(),
          figura(immagine(P.incollata, 150, (r, c, v) => `(${r}, ${c}) = ${Math.round(v)}`), "4. Griglia 28×28", "incollata al centro geometrico"),
          freccia(),
          figura(finale, "5. Centratura", `baricentro (${num(P.baricentro[0], 1)}; ${num(P.baricentro[1], 1)}) → spostata di (${P.spostamento[0]}, ${P.spostamento[1]}) verso (14; 14)`)
        )
      ),
    ];
  },

  norm(d) {
    const P = d.preprocessing;
    const n = d.normalizzata;
    return [
      p(`I pixel (0–255) vengono portati in [0, 1] e poi standardizzati con media e deviazione standard di MNIST. Il nero diventa ${num((0 - P.media) / P.dev_std, 4)}, il bianco ${num((1 - P.media) / P.dev_std, 4)}.`),
      griglia(
        scheda("client", "Pixel 0–255", mappa(P.finale, 28, 28, { scala: "grigio", min: 0, max: 255, cella: 9, etichetta: (r, c, v) => `(${r}, ${c}): ${v} → ${num(n[r * 28 + c])}` })),
        scheda(
          "client",
          "Valori normalizzati (ciò che verrà cifrato)",
          mappa(n, 28, 28, { cella: 9, etichetta: (r, c, v) => `(${r}, ${c}) = ${num(v)}` }),
          legendaDiv(n)
        ),
        scheda(
          "neutro",
          "Formula",
          h("div", { class: "formula" }, `x' = (x / 255 − ${num(P.media)}) / ${num(P.dev_std)}`),
          tabella([
            ["minimo", num(minimo(n))],
            ["massimo", num(massimo(n))],
            ["media", num(n.reduce((s, v) => s + v, 0) / n.length)],
            ["pixel accesi (> 0)", P.finale.filter((v) => v > 0).length + " su 784"],
          ])
        )
      ),
    ];
  },

  chiavi(d) {
    const S = d.sessione;
    const K = S.chiavi;
    const P = S.parametri;
    const catena = h(
      "div",
      { class: "catena" },
      P.modulo_bit.map((b, i) =>
        h(
          "div",
          {
            class: i === 0 ? "base" : i === P.modulo_bit.length - 1 ? "speciale" : "livello",
            style: `flex:${b}`,
            title: i === 0 ? "primo base" : i === P.modulo_bit.length - 1 ? "primo speciale" : `livello ${i}`,
          },
          b
        )
      ),
      h("div", { class: "margine", style: `flex:${P.modulo_massimo - P.modulo_totale}` }, "margine")
    );
    const totaleK = K.segreta + K.pubblica + K.rilinearizzazione + K.galois;
    const riga = (nome, byte, dove, uso) => [
      h("b", {}, nome),
      h("div", { class: "barretta" }, h("i", { style: `width:${Math.max(0.5, (byte / totaleK) * 100)}%` }), h("span", {}, mb(byte))),
      dove,
      uso,
    ];
    return [
      p(`Il client genera le chiavi una volta per sessione (${ms(S.ms_chiavi)}). La chiave segreta non lascia mai il client; tutto il resto forma il contesto pubblico di ${mb(S.byte_contesto_pubblico)}, che il server ha caricato in ${ms(S.ms_registrazione)}.`),
      scheda(
        "neutro",
        "Parametri dello schema",
        tabella([
          ["Grado del polinomio N", num(P.grado), "ogni ciphertext è fatto di polinomi con N coefficienti"],
          ["Slot", num(P.slot), "N/2 numeri reali per ciphertext"],
          ["Scala", `2^${P.scala_bit}`, "i reali vengono moltiplicati per 2^40 e arrotondati: fissa la precisione"],
          ["Modulo dei coefficienti", `${P.modulo_totale} bit`, `limite per ${P.sicurezza} bit di sicurezza: ${P.modulo_massimo} bit`],
        ]),
        h("div", { class: "etichetta-catena" }, "Catena del modulo (bit per primo)"),
        catena,
        p("Il primo base (60 bit) tiene il risultato finale, i sei da 40 bit sono i <b>livelli</b>: ogni moltiplicazione seguita da rescale ne consuma uno. Il primo speciale serve solo allo scambio di chiavi (rilinearizzazione e rotazioni).")
      ),
      scheda(
        "neutro",
        "Le chiavi",
        tabella(
          [
            riga("Segreta", K.segreta, "solo client", "decifrare"),
            riga("Pubblica", K.pubblica, "client e server", "cifrare (il server potrebbe cifrare, non decifrare)"),
            riga("Rilinearizzazione", K.rilinearizzazione, "server", "dopo x · x riporta il ciphertext da 3 a 2 polinomi"),
            riga("Galois", K.galois, "server", "ruotare gli slot: servono per le somme in conv, fc1 e fc2"),
          ],
          ["chiave", "dimensione", "dove sta", "a cosa serve"]
        ),
        p("Le chiavi di Galois sono il 96% del contesto: TenSEAL ne genera una per ogni rotazione possibile.")
      ),
    ];
  },

  im2col(d) {
    const C = d.cifratura;
    const slot = C.slot;
    const n = d.normalizzata;
    const cellaImg = 10;
    const cellaSlot = 5;
    const img = mappa(n, 28, 28, { scala: "grigio", cella: cellaImg });
    const finestra = h("div", { class: "finestra" });
    const boxImg = h("div", { class: "sovrapposto puntatore" }, img, finestra);
    const mat = mappa(slot, 64, 64, {
      scala: "grigio",
      cella: cellaSlot,
      etichetta: (r, c, v) => (r < 49 ? `slot ${r * 64 + c}: pixel ${r} della finestra ${c} = ${num(v)}` : `slot ${r * 64 + c}: riempimento (0)`),
    });
    const colonna = h("div", { class: "colonna" });
    const boxMat = h("div", { class: "sovrapposto puntatore" }, mat, colonna, h("div", { class: "taglio", style: `top:${49 * cellaSlot}px` }));
    const patch = h("div", { class: "patch" });
    const info = h("p", { class: "spiega" });

    function seleziona(k) {
      const r = Math.floor(k / 8);
      const c = k % 8;
      Object.assign(finestra.style, { left: c * 3 * cellaImg + "px", top: r * 3 * cellaImg + "px", width: 7 * cellaImg + "px", height: 7 * cellaImg + "px" });
      Object.assign(colonna.style, { left: k * cellaSlot + "px", width: cellaSlot + "px" });
      const valori = Array.from({ length: 49 }, (_, i) => slot[i * 64 + k]);
      patch.replaceChildren(mappa(valori, 7, 7, { scala: "grigio", min: minimo(n), max: massimo(n), cella: 18, etichetta: (rr, cc, v) => `pixel (${3 * r + rr}, ${3 * c + cc}) → slot ${(rr * 7 + cc) * 64 + k} = ${num(v)}` }));
      info.innerHTML = `<b>Finestra ${k}</b> (riga ${r}, colonna ${c}): pixel da (${3 * r}, ${3 * c}) a (${3 * r + 6}, ${3 * c + 6}). I suoi 49 pixel finiscono nella <b>colonna ${k}</b> degli slot, uno per riga.`;
    }
    boxImg.addEventListener("mousemove", (e) => {
      const b = img.getBoundingClientRect();
      const x = (e.clientX - b.left) / cellaImg;
      const y = (e.clientY - b.top) / cellaImg;
      const cl = (v) => Math.max(0, Math.min(7, Math.round((v - 3.5) / 3)));
      seleziona(cl(y) * 8 + cl(x));
    });
    boxMat.addEventListener("mousemove", (e) => {
      const b = mat.getBoundingClientRect();
      const k = Math.floor((e.clientX - b.left) / cellaSlot);
      if (k >= 0 && k < 64) seleziona(k);
    });
    seleziona(27);

    return [
      p(`La convoluzione 7×7 con passo 3 guarda ${C.n_finestre} finestre dell'immagine. Il client le dispone negli slot in modo che il server possa fare la convoluzione con sole moltiplicazioni e rotazioni: ${C.n_finestre} finestre × 49 pixel = 3136 valori, in una matrice 64×64 (4096 slot su ${num(d.sessione.parametri.slot)}).`),
      scheda(
        "client",
        "Passa sopra l'immagine o sulla matrice",
        fila(
          figura(boxImg, "Immagine normalizzata", "le 8×8 finestre si sovrappongono di 4 pixel"),
          freccia(),
          figura(patch, "La finestra scelta", "7×7 pixel"),
          freccia(),
          figura(boxMat, "Slot (64×64)", "riga = pixel della finestra, colonna = finestra; righe 49–63 a zero")
        ),
        info
      ),
    ];
  },

  cifra(d) {
    const C = d.cifratura;
    const grezzo = C.polinomi * d.sessione.parametri.grado * C.livello * 8;
    return [
      p("Il client codifica i 4096 valori in un polinomio e lo cifra con la chiave pubblica. Il risultato sono due polinomi con coefficienti che, senza chiave segreta, sono indistinguibili da numeri casuali (problema Ring-LWE)."),
      griglia(
        scheda(
          "client",
          "Il client conosce",
          mappa(C.slot, 64, 64, { scala: "grigio", cella: 3.5, etichetta: (r, c, v) => `slot ${r * 64 + c} = ${num(v)}` }),
          p("4096 numeri reali: l'immagine organizzata per finestre.")
        ),
        scheda(
          "server",
          "Il server riceve",
          mappa(C.rumore, 64, 64, { scala: "grigio", min: 0, max: 255, cella: 3.5, etichetta: (r, c, v) => `byte ${r * 64 + c}: 0x${v.toString(16).padStart(2, "0")}` }),
          p("4096 byte presi dal centro del ciphertext serializzato. Le righe verticali vengono dal formato (coefficienti da 40–60 bit salvati in parole da 64 bit, quindi alcuni byte sono sempre bassi), non dal contenuto: dell'immagine non resta traccia.")
        ),
        scheda(
          "neutro",
          "Anatomia del ciphertext",
          tabella([
            ["Polinomi", C.polinomi],
            ["Coefficienti per polinomio", num(d.sessione.parametri.grado)],
            ["Primi del modulo (livello)", h("span", {}, metro(C.livello))],
            ["Scala", `2^${num(C.scala_bit, 0)}`],
            ["Valori logici", num(C.n_valori)],
            ["Dimensione grezza", `${C.polinomi} × ${num(d.sessione.parametri.grado)} × ${C.livello} × 8 byte = ${mb(grezzo)}`],
            ["Dimensione serializzata", mb(C.byte) + " (compressa)"],
            ["Tempo di cifratura", ms(d.client.ms_cifratura)],
          ])
        )
      ),
    ];
  },

  async rete(d) {
    const R = await (await fetch("/api/rete")).json();
    const giro = d.canale.giro;
    const pacchetti = R.pacchetti.filter((x) => x.giro === 0 || x.giro === giro);
    if (!pacchetti.some((x) => x.giro === giro)) {
      return [p("I pacchetti di questa cifra non sono più nel registro (si conservano gli ultimi 3 riconoscimenti). Esegui un nuovo riconoscimento.")];
    }
    const stato = verificaRete(R, giro);

    const verdetto = h(
      "section",
      { class: "verdetto " + (stato.ok ? "ok" : "ko") },
      h("div", { class: "icona" }, stato.ok ? "✓" : "!"),
      h(
        "div",
        {},
        h("h3", {}, stato.ok ? "L'immagine non ha mai lasciato il client" : "Attenzione: controllo non superato"),
        h(
          "ul",
          {},
          h("li", {}, `${stato.rete.length} pacchetti client ↔ server per questa cifra: immagine trovata in ${stato.trovatoIn.length}.`),
          h("li", {}, stato.controllo
            ? `Il rilevatore funziona: nel pacchetto di controllo browser → client (#${stato.controllo.id}) trova ${stato.trovatiControllo.join(", ") || "nulla"}.`
            : "Pacchetto di controllo non disponibile."),
          h("li", {}, `Il server conferma lo SHA-256 di ${stato.confermati} corpi ricevuti su ${stato.inviati}.`),
          h("li", {}, `Il server è un processo separato: PID ${R.server.pid}, ${R.indirizzo}.`)
        )
      )
    );

    // ── tabella dei pacchetti ──
    const corpoTab = h("tbody");
    const esitoImg = (x) => {
      if (!x.controlli) return h("span", { class: "pill neutra" }, x.giro === 0 ? "prima del disegno" : "–");
      const t = x.controlli.filter((c) => c.trovato).length;
      if (x.zona === "locale") return h("span", { class: "pill attesa" }, t ? "trovata (atteso)" : "non trovata");
      return h("span", { class: "pill " + (t ? "ko" : "ok") }, t ? "TROVATA" : "assente");
    };
    let gruppo = null;
    pacchetti.forEach((x, i) => {
      if (x.giro !== gruppo) {
        gruppo = x.giro;
        corpoTab.append(h("tr", { class: "gruppo-riga" }, h("td", { colspan: 9 }, gruppo === 0 ? "Avvio della sessione" : "Riconoscimento di questa cifra")));
      }
      const riga = h(
        "tr",
        { class: "riga-p", "data-id": x.id, title: "apri il pacchetto", onclick: () => apriModale(pacchetti, i) },
        h("td", {}, `#${x.id}`),
        h("td", { class: "mono", title: x.ora }, x.ora.slice(0, 8)),
        h("td", {}, h("span", { class: "tratta tratta-" + x.zona }, x.zona === "locale" ? "locale" : "rete"), " ", x.direzione),
        h("td", { class: "mono" }, x.prima_riga.replace(" HTTP/1.1", "").replace("HTTP/1.1 ", "")),
        h("td", { class: "num" }, mb(x.byte)),
        h("td", { class: "num" }, num(x.entropia, 2)),
        h("td", { class: "mono", title: x.sha256 }, x.sha256.slice(0, 8) + "…"),
        h("td", {}, x.direzione === "client → server" ? (x.conferma ? "✓" : "✗") : "–"),
        h("td", {}, esitoImg(x))
      );
      corpoTab.append(riga);
    });
    const tab = h(
      "table",
      { class: "dati pacchetti" },
      h("thead", {}, h("tr", {}, ["#", "ora", "tratta", "richiesta / risposta", "dimensione", "entropia", "SHA-256", "conferma", "immagine"].map((t) => h("th", {}, t)))),
      corpoTab
    );

    return [
      p(`Client e server sono due processi distinti che comunicano solo via HTTP. Qui sotto ci sono <b>tutti i pacchetti realmente trasmessi</b>, registrati dal client e confermati dal server con lo SHA-256. Su ognuno gira un rilevatore che cerca l'immagine in ogni forma: PNG, base64, pixel uint8, valori normalizzati float32/float64.`),
      verdetto,
      scheda("rete", "Pacchetti trasmessi (clic su una riga per aprirlo)", tab,
        p("Entropia in bit per byte: 8 significa indistinguibile da byte casuali. Il ciphertext arriva a circa 7,96; la risposta JSON ha valori più bassi perché i ciphertext sono in base64 dentro un testo.")),
      p(`Verifica indipendente: cattura il traffico con Wireshark sull'interfaccia di loopback (Npcap) con il filtro <b>tcp.port == ${R.server.porta}</b>. Gli SHA-256 dei corpi HTTP corrispondono a quelli della tabella.`),
    ];
  },

  strato(d, fase) {
    const passo = d.server.passi[fase.passo];
    const prec = d.server.passi[fase.passo - 1];
    const M = ISP.modello;
    const info = STRATI[fase.id];
    const dec = passo.decifrato;
    const chiaro = passo.chiaro;

    let pesi;
    if (fase.id === "conv") {
      pesi = scheda(
        "server",
        "Pesi in chiaro: 4 kernel 7×7 + bias",
        fila(M.conv_w.map((k, i) => figura(mappa(k, 7, 7, { cella: 14, etichetta: (r, c, v) => `canale ${i}, w[${r}, ${c}] = ${num(v)}` }), `canale ${i}`, `bias ${num(M.conv_b[i], 3)}`))),
        legendaDiv(M.conv_w.flat())
      );
    } else if (fase.id === "fc1") {
      pesi = scheda(
        "server",
        "Pesi in chiaro: W₁ (64 × 256) e b₁",
        mappa(M.fc1_w.flat(), 64, 256, { cella: 2, etichetta: (r, c, v) => `W₁[${r}, ${c}] = ${num(v)}: neurone ${r} ← canale ${Math.floor(c / 64)}, finestra ${c % 64}` }),
        legendaDiv(M.fc1_w.flat()),
        h("div", { class: "etichetta-catena" }, "b₁ (64 valori)"),
        vettore(M.fc1_b, { altezza: 60, testo: (i, v) => `b₁[${i}] = ${num(v)}` }),
        p("Il server aggiunge 64 righe uguali a b₁/64 in fondo alla matrice: moltiplicate per il blocco di slot costanti a 1, sommano esattamente b₁.")
      );
    } else if (fase.id === "fc2") {
      pesi = scheda(
        "server",
        "Pesi in chiaro: W₂ (10 × 64) e b₂",
        mappa(M.fc2_w.flat(), 10, 64, { cella: 7, etichetta: (r, c, v) => `W₂[${r}, ${c}] = ${num(v)}: cifra ${r} ← neurone ${c}` }),
        legendaDiv(M.fc2_w.flat()),
        h("div", { class: "etichetta-catena" }, "b₂ (uno per cifra)"),
        vettore(M.fc2_b, { altezza: 60, etichette: [..."0123456789"], testo: (i, v) => `b₂[${i}] = ${num(v)}` })
      );
    } else {
      pesi = scheda(
        "server",
        "Nessun peso",
        p("Il ciphertext viene moltiplicato per sé stesso. Il prodotto ha 3 polinomi: la chiave di rilinearizzazione lo riporta a 2, poi il rescale divide per un primo da 40 bit e riporta la scala a 2^40.")
      );
    }

    let contenuto;
    if (fase.id === "conv" || fase.id === "q1") {
      contenuto = [
        fila(
          [0, 1, 2, 3].map((ch) =>
            figura(mappa(dec.slice(ch * 64, ch * 64 + 64), 8, 8, { cella: 14, etichetta: (r, c, v) => `canale ${ch}, posizione (${r}, ${c}) = ${num(v)}` }), `canale ${ch}`, "8×8")
          )
        ),
        legendaDiv(dec.slice(0, 256)),
        h("div", { class: "etichetta-catena" }, `slot 256–319: blocco costante (valori ${num(minimo(dec.slice(256)), 4)} – ${num(massimo(dec.slice(256)), 4)})`),
        mappa(dec.slice(256), 1, 64, { scala: "grigio", min: 0, max: 1, cella: 6, etichetta: (r, c, v) => `slot ${256 + c} = ${num(v, 6)}` }),
      ];
    } else if (fase.id === "fc2") {
      const best = dec.indexOf(massimo(dec));
      contenuto = [vettore(dec, { etichette: [..."0123456789"], evidenzia: best, testo: (i, v) => `cifra ${i}: ${num(v, 4)}` })];
    } else {
      contenuto = [vettore(dec, { testo: (i, v) => `neurone ${i} = ${num(v)}` })];
    }

    const livelloUsato = prec.livello - passo.livello;
    return [
      p(info.come),
      h(
        "div",
        { class: "riepilogo" },
        h("div", {}, h("span", {}, "operazione"), h("b", { class: "formula" }, info.formula)),
        h("div", {}, h("span", {}, "forma"), h("b", {}, info.forma)),
        h("div", {}, h("span", {}, "tempo"), h("b", {}, ms(passo.millisecondi))),
        h("div", {}, h("span", {}, "livelli consumati"), h("b", {}, String(livelloUsato)))
      ),
      griglia(
        scheda(
          "server",
          "Il server vede",
          mappa(passo.rumore, 64, 64, { scala: "grigio", min: 0, max: 255, cella: 3, etichetta: (r, c, v) => `byte 0x${v.toString(16).padStart(2, "0")}` }),
          tabella([
            ["Livello", h("span", {}, metro(passo.livello))],
            ["Scala", `2^${num(passo.scala_bit, 0)}`],
            ["Polinomi", passo.polinomi],
            ["Valori logici", num(passo.n_valori)],
            ["Dimensione", mb(passo.byte)],
          ]),
          fase.id === "conv" ? p("La convoluzione consuma due livelli: uno per il prodotto con il kernel, uno per creare il blocco costante (canale × 0 + 1). Poi tutti i vettori vengono allineati al livello più basso.") : null
        ),
        pesi,
        scheda(
          "didattica",
          "Contenuto, decifrato con la chiave del client",
          p("Il server non può vedere questi valori: li decifra il client solo per questa demo."),
          ...contenuto
        ),
        scheda(
          "neutro",
          "Confronto con PyTorch in chiaro",
          dispersione(chiaro, dec.slice(0, chiaro.length)),
          p(`Scarto massimo: <b>${num(passo.scarto, 6)}</b> su ${chiaro.length} valori. Ogni punto sulla diagonale è un valore identico; l'errore viene dall'arrotondamento CKKS alla scala 2^40.`)
        )
      ),
    ];
  },

  livelli(d) {
    const passi = d.server.passi;
    const nomi = ["ingresso", "conv", "x²", "fc1", "x²", "fc2"];
    return [
      p("Ogni moltiplicazione seguita da rescale toglie un primo dal modulo: il ciphertext si accorcia e resta meno margine per altre moltiplicazioni. Questa rete arriva a un solo primo: uno strato in più richiederebbe parametri più grandi."),
      scheda(
        "server",
        "Il budget dei livelli, passo per passo",
        tabella(
          passi.map((s, i) => [h("b", {}, nomi[i]), h("span", {}, metro(s.livello)), mb(s.byte), num(s.n_valori), ms(s.millisecondi)]),
          ["passo", "primi rimasti", "dimensione", "valori", "tempo"]
        )
      ),
    ];
  },

  dec(d) {
    const pr = d.client.probabilita;
    const raw = d.client.punteggi_grezzi;
    const chiaro = d.verifica.punteggi_chiaro;
    const best = d.client.predizione;
    return [
      p(`Il client decifra con la chiave segreta i 10 punteggi (${ms(d.client.ms_decifratura)}). La softmax e la scelta della cifra avvengono in chiaro, sul client: il server non le vede.`),
      griglia(
        scheda(
          "client",
          "Punteggi decifrati",
          vettore(raw, { etichette: [..."0123456789"], evidenzia: best, altezza: 170, testo: (i, v) => `cifra ${i}: punteggio ${num(v, 4)}, probabilità ${num(pr[i] * 100, 2)}%` }),
          p(`La cifra scelta è quella con il punteggio più alto: <b>${best}</b>. Le probabilità si ottengono con la softmax; con punteggi così distanziati quella della cifra scelta è quasi il 100%.`),
          h("div", { class: "formula" }, "p(i) = e^(s_i) / Σ e^(s_j)")
        ),
        scheda(
          "client",
          "I numeri decifrati",
          tabella(
            raw.map((v, i) => [
              h(i === best ? "b" : "span", {}, String(i)),
              num(v, 6),
              num(chiaro[i], 4),
              num(v - chiaro[i], 6),
              num(pr[i] * 100, 2) + "%",
            ]),
            ["cifra", "decifrato", "PyTorch", "differenza", "probabilità"]
          )
        )
      ),
    ];
  },
};

const STRATI = {
  conv: {
    formula: "y[c] = Σ w[c] · finestra + b[c]",
    forma: "4096 slot → 4 × 64 = 256 valori (+64 costanti)",
    come: "Per ogni canale il server moltiplica gli slot per il kernel 7×7 (in chiaro) e somma le 49 righe con rotazioni: ogni colonna diventa un valore della mappa 8×8. Poi impacchetta i 4 canali e il blocco costante in un solo ciphertext.",
  },
  q1: {
    formula: "y = x · x",
    forma: "320 → 320 valori",
    come: "L'attivazione quadratica sostituisce la ReLU, che non è un polinomio e quindi non si può calcolare in CKKS. È una moltiplicazione tra ciphertext.",
  },
  fc1: {
    formula: "y = W₁ · x + b₁",
    forma: "256 (+64 costanti) → 64",
    come: "Prodotto matrice-vettore con il metodo diagonale (Halevi e Shoup): il server moltiplica il vettore cifrato per le diagonali della matrice in chiaro e somma le versioni ruotate.",
  },
  q2: {
    formula: "y = x · x",
    forma: "64 → 64 valori",
    come: "Seconda attivazione quadratica: stessa operazione della prima, su 64 valori.",
  },
  fc2: {
    formula: "y = W₂ · x + b₂",
    forma: "64 → 10 punteggi",
    come: "Ultimo prodotto matrice-vettore. Qui il bias si somma direttamente, perché non segue un altro prodotto matrice-vettore. Il risultato sono i 10 punteggi, ancora cifrati.",
  },
};

// ───────────────────────── navigazione ─────────────────────────

const ov = document.getElementById("ispettore");
const nav = ov.querySelector("nav");
const corpo = ov.querySelector(".corpo-i");

function costruisciNav() {
  nav.replaceChildren(h("div", { class: "marchio" }, h("i"), "Ispettore", h("span", {}, `${FASI_ISP.length} fasi`)));
  let gruppo = null;
  FASI_ISP.forEach((f, i) => {
    if (f.gruppo !== gruppo) {
      gruppo = f.gruppo;
      nav.append(h("div", { class: `gruppo ${gruppo}` }, GRUPPI[gruppo]));
    }
    nav.append(h("button", { class: "voce", "data-i": i, onclick: () => mostra(i) }, f.titolo));
  });
}

async function mostra(i) {
  chiudiModale();
  ISP.indice = (i + FASI_ISP.length) % FASI_ISP.length;
  const f = FASI_ISP[ISP.indice];
  nav.querySelectorAll(".voce").forEach((b) => b.classList.toggle("attiva", +b.dataset.i === ISP.indice));
  ov.querySelector(".titolo-i").textContent = f.passo ? `Server · ${f.titolo}` : f.titolo;
  ov.querySelector(".pos-i").textContent = `${ISP.indice + 1} / ${FASI_ISP.length}`;
  const d = window.ultimo;
  if (!d) {
    corpo.replaceChildren(p("Esegui prima un riconoscimento: l'ispettore mostra i dati dell'ultima cifra."));
    return;
  }
  if (f.passo && !ISP.modello) {
    corpo.replaceChildren(p("Carico i pesi del modello…"));
    ISP.modello = await (await fetch("/api/modello")).json();
  }
  const contenuto = await (f.passo ? PAGINE.strato(d, f) : PAGINE[f.id](d));
  if (FASI_ISP[ISP.indice] !== f) return; // nel frattempo l'utente ha cambiato pagina
  const testata = h(
    "div",
    { class: "testata-i" },
    h("div", { class: "occhiello" }, GRUPPI[f.gruppo]),
    h("h1", {}, f.passo ? `Strato ${f.titolo}` : f.titolo)
  );
  corpo.replaceChildren(testata, ...contenuto);
  corpo.scrollTop = 0;
}

window.apriIspettore = (id = "prep") => {
  costruisciNav();
  ov.hidden = false;
  document.body.classList.add("ispeziona");
  mostra(Math.max(0, FASI_ISP.findIndex((f) => f.id === id)));
};
function chiudi() {
  chiudiModale();
  ov.hidden = true;
  tip.hidden = true;
  document.body.classList.remove("ispeziona");
}
ov.querySelector(".chiudi").onclick = chiudi;
ov.querySelector(".prec").onclick = () => mostra(ISP.indice - 1);
ov.querySelector(".succ").onclick = () => mostra(ISP.indice + 1);
document.addEventListener("keydown", (e) => {
  if (ov.hidden) return;
  // con il pop-up aperto: Esc lo chiude, ← → scorrono i pacchetti
  if (MODALE.el && !MODALE.el.hidden) {
    if (e.key === "Escape") chiudiModale();
    else if (e.target.tagName === "INPUT") return;
    else if (e.key === "ArrowRight") { e.preventDefault(); apriModale(MODALE.lista, MODALE.indice + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); apriModale(MODALE.lista, MODALE.indice - 1); }
    return;
  }
  if (e.target.tagName === "INPUT") return;
  if (e.key === "Escape") chiudi();
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); mostra(ISP.indice + 1); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); mostra(ISP.indice - 1); }
});
