const $ = (id) => document.getElementById(id);
const tela = $("tela");
const ctx = tela.getContext("2d");
const dim = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1).replace(".", ",") + " MB" : Math.round(b / 1e3) + " kB");
const tempo = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1).replace(".", ",") + " s" : Math.round(ms) + " ms");

// ───────────── disegno ─────────────
let vuota = true;
let occupato = false;

function pulisciTela() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, tela.width, tela.height);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 20;
  ctx.lineCap = ctx.lineJoin = "round";
  vuota = true;
}

function punto(e) {
  const r = tela.getBoundingClientRect();
  return [(e.clientX - r.left) * (tela.width / r.width), (e.clientY - r.top) * (tela.height / r.height)];
}
let disegnando = false;
tela.addEventListener("pointerdown", (e) => {
  if (occupato) return;
  if (!vuota && $("v-pred").textContent !== "?") { pulisciTela(); azzera(); } // nuovo disegno dopo un risultato
  disegnando = true;
  vuota = false;
  tela.setPointerCapture(e.pointerId);
  const [x, y] = punto(e);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 0.1, y);
  ctx.stroke();
  fase("disegna");
});
tela.addEventListener("pointermove", (e) => {
  if (!disegnando) return;
  const [x, y] = punto(e);
  ctx.lineTo(x, y);
  ctx.stroke();
});
["pointerup", "pointercancel"].forEach((ev) => tela.addEventListener(ev, () => (disegnando = false)));

// ───────────── stato dell'interfaccia ─────────────
const FASI = ["disegna", "cifra", "invia", "calcola", "restituisce", "decifra"];

function fase(nome, inAttesa = false) {
  const k = FASI.indexOf(nome);
  document.querySelectorAll("#stepper li").forEach((li, i) => {
    li.classList.toggle("fatta", i < k);
    li.classList.toggle("attiva", i === k);
    li.classList.toggle("attesa", i === k && inAttesa);
  });
}

function pixel(canvas, valori) {
  const c = canvas.getContext("2d");
  const img = c.createImageData(canvas.width, canvas.height);
  valori.forEach((v, i) => img.data.set([v, v, v, 255], i * 4));
  c.putImageData(img, 0, 0);
}

function barre(punteggi = null, migliore = -1) {
  const min = punteggi ? Math.min(...punteggi) : 0;
  const max = punteggi ? Math.max(...punteggi) : 1;
  $("barre").innerHTML = Array.from({ length: 10 }, (_, i) => {
    const h = punteggi ? 2 + ((punteggi[i] - min) / (max - min || 1)) * 98 : 2;
    const titolo = punteggi ? ` title="punteggio ${punteggi[i].toFixed(2)}"` : "";
    return `<div class="barra${i === migliore ? " max" : ""}"${titolo}><i style="height:${h}%"></i><span>${i}</span></div>`;
  }).join("");
}

let timerStato;
function stato(testo, durata = 0) {
  $("stato").textContent = testo;
  $("stato").classList.toggle("visibile", !!testo);
  clearTimeout(timerStato);
  if (durata) timerStato = setTimeout(() => $("stato").classList.remove("visibile"), durata);
}

function azzera() {
  fase("disegna"); // il primo passo da fare è sempre disegnare
  ["p-ct", "p-ris"].forEach((id) => $(id).classList.remove("visto"));
  $("v-rete").textContent = "";
  $("v-rete").className = "verifica-rete";
  $("v-ct").textContent = $("v-ris").textContent = "–";
  [$("anteprima"), $("rumore"), $("ris-rumore")].forEach((c) => c.getContext("2d").clearRect(0, 0, c.width, c.height));
  document.querySelectorAll("#pipeline li").forEach((li) => {
    li.classList.remove("lavora", "fatto");
    li.querySelector("i").textContent = "";
  });
  $("v-pred").textContent = "?";
  $("v-pred").classList.add("vuoto");
  $("v-verifica").innerHTML = "&nbsp;";
  barre();
}

// ───────────── azioni ─────────────
function cancella() {
  if (occupato) return;
  pulisciTela();
  azzera();
}

async function esempio() {
  if (occupato) return;
  const d = await (await fetch("/api/esempio")).json();
  const piccola = document.createElement("canvas");
  piccola.width = piccola.height = 28;
  pixel(piccola, d.pixel);
  pulisciTela();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(piccola, 0, 0, tela.width, tela.height);
  vuota = false;
  azzera();
  stato(`Immagine del test set MNIST (etichetta: ${d.etichetta})`, 2500);
}

// Il backend risponde in streaming: un evento JSON per riga, nell'ordine in cui
// le fasi avvengono davvero. L'interfaccia avanza solo quando arriva un evento.
async function* eventi(risposta) {
  const lettore = risposta.body.getReader();
  const decodifica = new TextDecoder();
  let resto = "";
  for (;;) {
    const { value, done } = await lettore.read();
    if (done) break;
    resto += decodifica.decode(value, { stream: true });
    const righe = resto.split("\n");
    resto = righe.pop();
    for (const r of righe) if (r.trim()) yield JSON.parse(r);
  }
  if (resto.trim()) yield JSON.parse(resto);
}

async function riconosci() {
  if (occupato) return;
  if (vuota) return stato("Disegna prima una cifra", 2000);
  occupato = true;
  document.querySelectorAll("main button").forEach((b) => (b.disabled = true));
  azzera();
  const voci = [...document.querySelectorAll("#pipeline li")];

  try {
    const r = await fetch("/api/riconosci", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ immagine: (window.ultimoDisegno = tela.toDataURL("image/png")) }),
    });
    if (!r.ok) throw new Error(r.statusText);

    let d = null;
    for await (const ev of eventi(r)) {
      switch (ev.evento) {
        case "cifra": // il client prepara l'immagine e la cifra
          fase("cifra", true);
          stato("Il client prepara e cifra l'immagine…");
          break;
        case "cifrato":
          pixel($("anteprima"), ev.pixel);
          break;
        case "invia": // il ciphertext parte verso il server
          fase("invia", true);
          stato("Invio dell'immagine cifrata al server…");
          $("v-ct").textContent = dim(ev.byte);
          $("p-ct").classList.add("visto");
          break;
        case "calcola": // il server ha ricevuto tutto il corpo e inizia a calcolare
          fase("calcola", true);
          stato("Il server calcola sul ciphertext…");
          pixel($("rumore"), ultimoRumore);
          voci[0].classList.add("lavora");
          break;
        case "strato": // il server ha finito uno strato
          voci[ev.indice].classList.replace("lavora", "fatto");
          voci[ev.indice].querySelector("i").textContent = tempo(ev.millisecondi);
          if (voci[ev.indice + 1]) voci[ev.indice + 1].classList.add("lavora");
          break;
        case "restituisce": // i punteggi cifrati tornano al client
          fase("restituisce", true);
          stato("I punteggi cifrati tornano al client…");
          $("v-ris").textContent = dim(ev.byte);
          $("p-ris").classList.add("visto");
          pixel($("ris-rumore"), ev.rumore);
          break;
        case "decifra": // il client decifra con la chiave segreta
          fase("decifra", true);
          stato("Il client decifra i punteggi…");
          break;
        case "risultato":
          d = ev.dati;
          break;
        case "errore":
          throw new Error(ev.messaggio);
      }
      if (ev.evento === "cifrato") ultimoRumore = ev.rumore;
    }
    if (!d) throw new Error("risposta incompleta");

    fase("decifra");
    stato("");
    window.ultimo = d;
    mostraRisultato(d);
    await verificaPacchetti(d);
    $("ispeziona").disabled = false;
    document.body.classList.add("ispezionabile");
  } catch (err) {
    azzera();
    stato("Errore: " + err.message, 4000);
  } finally {
    occupato = false;
    document.querySelectorAll("main button").forEach((b) => (b.disabled = false));
    $("ispeziona").disabled = !window.ultimo;
  }
}
let ultimoRumore = [];

// Risultato finale, sul client: cifra riconosciuta, punteggi e verifica.
function mostraRisultato(d) {
  barre(d.client.punteggi, d.client.predizione);
  $("v-pred").textContent = d.client.predizione;
  $("v-pred").classList.remove("vuoto");
  const v = d.verifica;
  $("v-verifica").textContent =
    `Modello in chiaro: ${v.predizione_chiaro}` +
    (v.predizione_chiaro === d.client.predizione ? " (stessa cifra)" : " (cifra diversa)") +
    ` · scarto massimo ${v.errore_max.toFixed(4).replace(".", ",")}` +
    ` · calcolo cifrato ${tempo(d.server.ms_totale)}`;
}

// Esito della verifica dei pacchetti, sotto le frecce della rete.
async function verificaPacchetti(d) {
  const el = $("v-rete");
  try {
    const R = await (await fetch("/api/rete")).json();
    const v = window.verificaRete(R, d.canale.giro);
    el.className = "verifica-rete " + (v.ok ? "ok" : "ko");
    el.textContent = v.ok
      ? `✓ immagine assente nei ${v.rete.length} pacchetti trasmessi`
      : "! verifica dei pacchetti non superata";
  } catch {
    el.textContent = "";
  }
}

// ───────────── ispezione: ogni elemento apre la fase corrispondente ─────────────
function ispeziona(fase) {
  if (!window.ultimo || occupato) return;
  window.apriIspettore(fase);
}
const COLLEGAMENTI = [
  ["#stepper li[data-fase=disegna]", "prep"],
  ["#stepper li[data-fase=cifra]", "im2col"],
  ["#stepper li[data-fase=invia]", "rete"],
  ["#stepper li[data-fase=calcola]", "conv"],
  ["#stepper li[data-fase=restituisce]", "rete"],
  ["#stepper li[data-fase=decifra]", "dec"],
  ["#anteprima", "prep"],
  ["#rumore", "cifra"],
  ["#p-ct", "rete"],
  ["#p-ris", "rete"],
  ["#v-rete", "rete"],
  ["#esito", "dec"],
  ["#ris-rumore", "fc2"],
];
COLLEGAMENTI.forEach(([sel, fase]) => document.querySelectorAll(sel).forEach((el) => {
  el.classList.add("cliccabile");
  el.addEventListener("click", () => ispeziona(fase));
}));
["conv", "q1", "fc1", "q2", "fc2"].forEach((fase, i) => {
  const li = document.querySelectorAll("#pipeline li")[i];
  li.classList.add("cliccabile");
  li.addEventListener("click", () => ispeziona(fase));
});
$("ispeziona").onclick = () => ispeziona("prep");
$("riconosci").onclick = riconosci;
$("esempio").onclick = esempio;
$("cancella").onclick = cancella;
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || document.body.classList.contains("ispeziona")) return;
  if (e.key.toLowerCase() === "i") return ispeziona("prep");
  if (e.key === "Enter") { e.preventDefault(); riconosci(); }
  else if (e.key.toLowerCase() === "e") esempio();
  else if (["Delete", "Backspace", "Escape"].includes(e.key)) cancella();
});

pulisciTela();
azzera();
