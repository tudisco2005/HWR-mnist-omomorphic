"""Demo web, lato CLIENT: disegna una cifra, guardala riconoscere sui dati cifrati.
Un selettore nella pagina permette di eseguire la stessa inferenza in chiaro,
per confronto (tempi, e cosa vede il server).

Avvio:  python app.py   →   http://127.0.0.1:5000

Due processi distinti:
  app.py         CLIENT: tiene la chiave segreta, prepara e cifra l'immagine,
                 decifra il risultato, serve la pagina web.
  server_fhe.py  SERVER (porta 5001): tiene il modello e calcola sul ciphertext.
                 app.py lo avvia da solo se non è già in esecuzione.

Comunicano solo via HTTP. Ogni pacchetto scambiato viene registrato (rete.py)
e analizzato per verificare che l'immagine non lasci mai il client; la pagina
"Rete" dell'ispettore mostra i pacchetti byte per byte.

La risposta contiene anche una "vista didattica": il client decifra i
ciphertext intermedi prodotti dal server per mostrare cosa contengono. In un
sistema reale il client riceverebbe solo il risultato finale.
"""

import atexit
import base64
import io
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import requests
import tenseal as ts
import torch
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from PIL import Image

from dati_mnist import DEV_STD, MEDIA, carica, normalizza
from fhe import BIT_MODULO, GRADO_POLINOMIO, SCALA, Client, metadati, rumore
from modello import ReteCifrabile
from rete import Registro

QUI = Path(__file__).parent
SERVER = "http://127.0.0.1:5001"
if not (QUI / "modello.pt").exists():
    raise SystemExit("modello.pt non trovato: esegui prima  python addestra.py")

app = Flask(__name__, static_folder=str(QUI / "static"), static_url_path="")
registro = Registro()
http = requests.Session()


def chiama(metodo: str, percorso: str, corpo: bytes = b"", intestazioni: dict | None = None,
           descr_richiesta: str = "", descr_risposta: str = "", nota: str | None = None):
    """Una richiesta HTTP al server, registrata in entrambe le direzioni."""
    richiesta = requests.Request(metodo, SERVER + percorso, data=corpo or None, headers=intestazioni or {})
    preparata = http.prepare_request(richiesta)
    risposta = http.send(preparata)
    risposta.raise_for_status()
    inviato = preparata.body or b""
    p_req = registro.aggiungi(
        corpo=inviato,
        direzione="client → server",
        prima_riga=f"{metodo} {percorso} HTTP/1.1",
        intestazioni={"Host": SERVER.split("//")[1], **dict(preparata.headers)},
        descrizione=descr_richiesta,
        nota=nota,
    )
    p_req["conferma"] = risposta.headers.get("X-SHA256-Ricevuto") == p_req["sha256"]
    registro.aggiungi(
        corpo=risposta.content,
        direzione="server → client",
        prima_riga=f"HTTP/1.1 {risposta.status_code} {risposta.reason}",
        intestazioni=dict(risposta.headers),
        descrizione=descr_risposta,
    )
    return risposta


# ── Avvio del processo server ──
def _server_attivo() -> bool:
    try:
        return requests.get(SERVER + "/info", timeout=1).ok
    except requests.RequestException:
        return False


if not _server_attivo():
    print("Avvio il processo server (server_fhe.py)...")
    _processo = subprocess.Popen([sys.executable, str(QUI / "server_fhe.py")], cwd=QUI)
    atexit.register(_processo.terminate)
    for _ in range(240):
        if _server_attivo():
            break
        if _processo.poll() is not None:
            raise SystemExit("Il processo server si è chiuso durante l'avvio")
        time.sleep(0.5)
    else:
        raise SystemExit("Il server non risponde su " + SERVER)
INFO_SERVER = chiama(
    "GET", "/info",
    descr_richiesta="Il client chiede chi è il server",
    descr_risposta="PID e porta del processo server",
).json()

# ── Sessione: il client genera le chiavi e invia il contesto pubblico UNA volta ──
print("Il client genera le chiavi CKKS...")
_t0 = time.perf_counter()
client = Client()
_contesto_pubblico = client.contesto_pubblico()
_t_chiavi = time.perf_counter() - _t0
print(f"Invio il contesto pubblico ({len(_contesto_pubblico) / 1e6:.0f} MB) al server...")
_t0 = time.perf_counter()
id_client = chiama(
    "POST", "/contesto", _contesto_pubblico, {"Content-Type": "application/octet-stream"},
    descr_richiesta="Contesto pubblico: parametri CKKS, chiave pubblica, chiavi di rilinearizzazione e di Galois. Nessuna chiave segreta.",
    descr_risposta="Identificativo assegnato al client",
    nota="Inviato all'avvio, prima di qualunque disegno: non può contenere l'immagine. Per le dimensioni si conserva solo l'inizio del corpo.",
).json()["id_client"]
_t_registrazione = time.perf_counter() - _t0


def _dimensione(**opzioni) -> int:
    base = dict(save_public_key=False, save_secret_key=False, save_galois_keys=False, save_relin_keys=False)
    return len(client.contesto.serialize(**{**base, **opzioni}))


_vuoto = _dimensione()
_pubblica = _dimensione(save_public_key=True)
_relin = _dimensione(save_public_key=True, save_relin_keys=True)
SESSIONE = dict(
    ms_chiavi=round(_t_chiavi * 1000),
    ms_registrazione=round(_t_registrazione * 1000),
    byte_contesto_pubblico=len(_contesto_pubblico),
    pid_server=INFO_SERVER["pid"],
    chiavi=dict(
        segreta=_dimensione(save_secret_key=True) - _vuoto,
        pubblica=_pubblica - _vuoto,
        rilinearizzazione=_relin - _pubblica,
        galois=len(_contesto_pubblico) - _relin,
    ),
    parametri=dict(
        grado=GRADO_POLINOMIO,
        slot=GRADO_POLINOMIO // 2,
        modulo_bit=BIT_MODULO,
        modulo_totale=sum(BIT_MODULO),
        modulo_massimo=438,  # limite per 128 bit di sicurezza con grado 16384 (standard HE)
        scala_bit=int(np.log2(SCALA)),
        sicurezza=128,
    ),
)
del _contesto_pubblico

# Pesi del modello: li possiede il server; il client li scarica solo per la vista
# didattica (confronto strato per strato con PyTorch in chiaro).
_pesi = chiama(
    "GET", "/modello",
    descr_richiesta="Richiesta dei pesi del modello",
    descr_risposta="Pesi in chiaro: servono al client solo per il confronto didattico con PyTorch",
).json()
riferimento = ReteCifrabile()
riferimento.load_state_dict({k: torch.tensor(v) for k, v in _pesi.items()})
riferimento.eval()
print(f"Pronto: server PID {INFO_SERVER['pid']}, contesto pubblico registrato.")


def _riduci(a: np.ndarray, lato: int = 96) -> dict:
    """Immagine di dimensione qualsiasi → al massimo lato x lato, per mostrarla."""
    h, w = a.shape
    f = min(1.0, lato / max(h, w))
    if f < 1:
        a = np.array(Image.fromarray(a.astype(np.uint8)).resize((max(1, round(w * f)), max(1, round(h * f)))))
    return dict(w=a.shape[1], h=a.shape[0], pixel=np.clip(a, 0, 255).astype(np.uint8).flatten().tolist())


def prepara_come_mnist(data_url: str):
    """Disegno del canvas → immagine 28x28 uint8 con lo stile di MNIST:
    cifra bianca su nero, ridimensionata in un riquadro 20x20 e centrata
    sul baricentro dei pixel. Restituisce anche le fasi intermedie."""
    grezzo = base64.b64decode(data_url.split(",", 1)[1])
    img = Image.open(io.BytesIO(grezzo)).convert("RGBA")
    sfondo = Image.new("RGBA", img.size, (0, 0, 0, 255))
    a = np.array(Image.alpha_composite(sfondo, img).convert("L"), dtype=np.float32)
    originale = a.shape

    righe, colonne = np.nonzero(a > 30)
    if len(righe) == 0:
        return None, None
    riquadro = [int(colonne.min()), int(righe.min()), int(colonne.max()), int(righe.max())]
    a = a[righe.min() : righe.max() + 1, colonne.min() : colonne.max() + 1]
    ritaglio = a.copy()

    h, w = a.shape
    fattore = 20.0 / max(h, w)
    nuova = (max(1, round(w * fattore)), max(1, round(h * fattore)))
    piccola = np.array(Image.fromarray(a.astype(np.uint8)).resize(nuova, Image.LANCZOS), dtype=np.float32)

    tela = np.zeros((28, 28), dtype=np.float32)
    y0, x0 = (28 - piccola.shape[0]) // 2, (28 - piccola.shape[1]) // 2
    tela[y0 : y0 + piccola.shape[0], x0 : x0 + piccola.shape[1]] = piccola
    incollata = tela.copy()

    # sposta il baricentro al centro (14, 14), come nel dataset originale
    massa = tela.sum()
    yy, xx = np.indices(tela.shape)
    by, bx = (yy * tela).sum() / massa, (xx * tela).sum() / massa
    dy, dx = int(round(14 - by)), int(round(14 - bx))
    tela = np.roll(np.roll(tela, dy, axis=0), dx, axis=1)
    finale = np.clip(tela, 0, 255).astype(np.uint8)

    fasi = dict(
        originale=list(originale),
        riquadro=riquadro,
        ritaglio=_riduci(ritaglio),
        ridotta=_riduci(piccola),
        fattore=round(fattore, 4),
        incollata=_riduci(incollata),
        baricentro=[round(float(bx), 2), round(float(by), 2)],
        spostamento=[dx, dy],
        finale=finale.flatten().tolist(),
        media=MEDIA,
        dev_std=DEV_STD,
    )
    return finale, fasi


def ms(t0):
    return round((time.perf_counter() - t0) * 1000, 1)


def arrotonda(a, cifre=5):
    return np.round(np.asarray(a, dtype=np.float64), cifre).tolist()


@torch.no_grad()
def strati_in_chiaro(img: np.ndarray) -> dict:
    """Le stesse operazioni in PyTorch, strato per strato: il riferimento."""
    m = riferimento
    x = torch.tensor(img, dtype=torch.float32).view(1, 1, 28, 28)
    conv = m.conv1(x).view(-1)
    q1 = conv * conv
    fc1 = m.fc1(q1.view(1, -1))[0]
    q2 = fc1 * fc1
    fc2 = m.fc2(q2.view(1, -1))[0]
    return {"conv": conv.numpy(), "x²#1": q1.numpy(), "fc1": fc1.numpy(), "x²#2": q2.numpy(), "fc2": fc2.numpy()}


@app.get("/")
def indice():
    return send_from_directory(app.static_folder, "index.html")


_test_img, _test_lbl = carica("test")


@app.get("/api/esempio")
def esempio():
    """Un'immagine a caso del test set: utile come riserva durante una demo dal vivo."""
    i = int(np.random.randint(len(_test_img)))
    return jsonify(pixel=_test_img[i].flatten().tolist(), etichetta=int(_test_lbl[i]))


@app.get("/api/modello")
def modello():
    """I pesi in chiaro, scaricati dal server per la vista didattica."""
    m = riferimento
    return jsonify(
        conv_w=arrotonda(m.conv1.weight.data.view(4, 49), 4),
        conv_b=arrotonda(m.conv1.bias.data, 4),
        fc1_w=arrotonda(m.fc1.weight.data, 4),  # 64 x 256
        fc1_b=arrotonda(m.fc1.bias.data, 4),
        fc2_w=arrotonda(m.fc2.weight.data, 4),  # 10 x 64
        fc2_b=arrotonda(m.fc2.bias.data, 4),
    )


def _evento(tipo: str, **dati) -> str:
    return json.dumps(dict(evento=tipo, **dati)) + "\n"


def inferenza_in_streaming(ciphertext: bytes, n_finestre: int):
    """Invia il ciphertext al server e produce i suoi eventi man mano che arrivano
    (corpo ricevuto, fine di ogni strato, fine). Registra la richiesta subito e la
    risposta completa quando il flusso è terminato."""
    intestazioni = {"Content-Type": "application/octet-stream", "X-Client-Id": id_client, "X-Finestre": str(n_finestre)}
    preparata = http.prepare_request(requests.Request("POST", SERVER + "/inferenza", data=ciphertext, headers=intestazioni))
    risposta = http.send(preparata, stream=True)
    risposta.raise_for_status()
    p_req = registro.aggiungi(
        corpo=preparata.body,
        direzione="client → server",
        prima_riga="POST /inferenza HTTP/1.1",
        intestazioni={"Host": SERVER.split("//")[1], **dict(preparata.headers)},
        descrizione="Immagine cifrata (CKKSVector serializzato). Il numero di finestre viaggia in chiaro: dipende solo dalla forma 28×28.",
    )
    p_req["conferma"] = risposta.headers.get("X-SHA256-Ricevuto") == p_req["sha256"]

    ricevuti = bytearray()
    riga = bytearray()
    for blocco in risposta.iter_content(chunk_size=None):
        ricevuti += blocco
        while blocco:
            prima, a_capo, blocco = blocco.partition(b"\n")
            riga += prima
            if not a_capo:
                break
            if riga.strip():
                yield json.loads(riga)
            riga = bytearray()
    registro.aggiungi(
        corpo=bytes(ricevuti),
        direzione="server → client",
        prima_riga=f"HTTP/1.1 {risposta.status_code} {risposta.reason}",
        intestazioni=dict(risposta.headers),
        descrizione="Flusso di eventi (una riga JSON per evento): ricezione, fine di ogni strato con il ciphertext intermedio "
                    "(ancora cifrato, solo per la vista didattica), punteggi cifrati e tempi.",
    )


@app.post("/api/riconosci")
def riconosci():
    """Risponde in streaming: un evento per ogni fase reale, nell'ordine in cui avviene."""
    registro.giro += 1
    registro.aggiungi(
        corpo=request.get_data(),
        zona="locale",
        direzione="browser → client",
        prima_riga=f"POST {request.path} HTTP/1.1",
        intestazioni={k: v for k, v in request.headers.items() if k in ("Host", "Content-Type", "Content-Length", "User-Agent")},
        descrizione="Il disegno passa dal browser al processo client, sullo stesso computer. Non va al server.",
        nota="Pacchetto di controllo: contiene davvero il disegno, quindi il rilevatore deve trovarlo.",
    )
    data_url = request.json["immagine"]
    if request.json.get("modalita") == "chiaro":
        return Response(stream_with_context(flusso_in_chiaro(data_url)), mimetype="application/x-ndjson")

    def flusso():
        try:
            # ── CLIENT: preparazione e cifratura ──
            yield _evento("cifra")
            img_uint8, fasi = prepara_come_mnist(data_url)
            if img_uint8 is None:
                yield _evento("errore", messaggio="Il disegno è vuoto")
                return
            img = normalizza(img_uint8)
            t0 = time.perf_counter()
            ciphertext, n_finestre = client.cifra(img)
            t_cifra = ms(t0)
            centro = len(ciphertext) // 2
            yield _evento("cifrato", pixel=img_uint8.flatten().tolist(), byte=len(ciphertext),
                          rumore=list(ciphertext[centro : centro + 784]))

            # ── RETE + SERVER: gli eventi arrivano mentre il server calcola ──
            yield _evento("invia", byte=len(ciphertext))
            t0 = time.perf_counter()
            passi_server, ms_totale = [], None
            for ev in inferenza_in_streaming(ciphertext, n_finestre):
                if ev["evento"] == "ricevuto":
                    yield _evento("calcola")
                elif ev["evento"] == "passo":
                    passi_server.append(ev)
                    if ev["nome"] != "ricezione":
                        yield _evento("strato", indice=len(passi_server) - 2, nome=ev["nome"], millisecondi=ev["millisecondi"])
                elif ev["evento"] == "fine":
                    ms_totale = ev["ms_totale"]
            t_rete = ms(t0)
            byte_risposta = registro.pacchetti[-1]["byte"]
            risultato = base64.b64decode(passi_server[-1]["ciphertext"])
            yield _evento("restituisce", byte=len(risultato), rumore=list(risultato[len(risultato) // 2 :][:60]))

            # ── CLIENT: decifratura ──
            yield _evento("decifra")
            t0 = time.perf_counter()
            punteggi = client.decifra(risultato)
            t_decifra = ms(t0)
            registro.analizza_giro(img_uint8, img)

            # ── VISTA DIDATTICA: il client decifra anche i passaggi intermedi ──
            ingresso = ts.ckks_vector_from(client.contesto, ciphertext)
            slot_ingresso = np.array(ingresso.decrypt())  # 64 x 64: riga = pixel della finestra, colonna = finestra
            rif = strati_in_chiaro(img)
            chiavi = ["conv", "x²#1", "fc1", "x²#2", "fc2"]
            passi = []
            for passo in passi_server:
                ct = base64.b64decode(passo.pop("ciphertext"))
                passo.pop("evento")
                d = dict(passo, rumore=rumore(ct))
                if passo["nome"] != "ricezione":
                    atteso = rif[chiavi[len(passi) - 1]]
                    valori = client.decifra(ct)
                    d.update(
                        decifrato=arrotonda(valori, 5),
                        chiaro=arrotonda(atteso, 5),
                        scarto=float(np.abs(valori[: len(atteso)] - atteso).max()),
                    )
                passi.append(d)

            chiaro = rif["fc2"]
            probabilita = np.exp(punteggi - punteggi.max())
            probabilita /= probabilita.sum()

            yield _evento("risultato", dati=dict(
                pixel=img_uint8.flatten().tolist(),
                sessione=SESSIONE,
                preprocessing=fasi,
                normalizzata=arrotonda(img.flatten(), 4),
                client=dict(
                    ms_cifratura=t_cifra,
                    ms_decifratura=t_decifra,
                    punteggi=punteggi.round(4).tolist(),
                    punteggi_grezzi=[float(v) for v in punteggi],
                    probabilita=[float(v) for v in probabilita],
                    predizione=int(punteggi.argmax()),
                ),
                cifratura=dict(
                    n_finestre=n_finestre,
                    slot=arrotonda(slot_ingresso, 4),
                    **metadati(ingresso),
                    byte=len(ciphertext),
                    rumore=rumore(ciphertext),
                ),
                canale=dict(
                    byte_ciphertext=len(ciphertext),
                    byte_risultato=len(risultato),
                    byte_risposta=byte_risposta,
                    ms_rete=t_rete,
                    n_finestre=n_finestre,
                    giro=registro.giro,
                ),
                server=dict(
                    ms_totale=ms_totale,
                    chiave_segreta=False,
                    rumore=list(ciphertext[centro : centro + 784]),
                    passi=passi,
                    # 60 byte del risultato cifrato: la demo li disegna come 10 colonne di rumore
                    risultato_rumore=list(risultato[len(risultato) // 2 :][:60]),
                ),
                verifica=dict(
                    punteggi_chiaro=arrotonda(chiaro, 4),
                    predizione_chiaro=int(chiaro.argmax()),
                    errore_max=float(np.abs(punteggi - chiaro).max()),
                ),
            ))
        except Exception as errore:  # l'errore arriva al browser come evento
            yield _evento("errore", messaggio=str(errore))

    return Response(stream_with_context(flusso()), mimetype="application/x-ndjson")


def flusso_in_chiaro(data_url: str):
    """Modalità di confronto SENZA cifratura: l'immagine normalizzata viaggia così
    com'è e il server la elabora in chiaro. Gli eventi sono gli stessi della
    modalità cifrata, così l'interfaccia mostra le stesse fasi; il rilevatore
    di rete, questa volta, trova l'immagine nei pacchetti."""
    try:
        yield _evento("cifra")
        img_uint8, fasi = prepara_come_mnist(data_url)
        if img_uint8 is None:
            yield _evento("errore", messaggio="Il disegno è vuoto")
            return
        img = normalizza(img_uint8)
        corpo = img.astype("<f4").tobytes()
        pixel = img_uint8.flatten().tolist()
        yield _evento("cifrato", pixel=pixel, byte=len(corpo), rumore=pixel)

        yield _evento("invia", byte=len(corpo))
        yield _evento("calcola")
        t0 = time.perf_counter()
        r = chiama(
            "POST", "/inferenza_chiaro", corpo, {"Content-Type": "application/octet-stream"},
            descr_richiesta="Immagine normalizzata IN CHIARO (784 float32): nessuna cifratura, il server la vede.",
            descr_risposta="Punteggi in chiaro e tempi dei singoli strati",
        )
        t_rete = ms(t0)
        risposta = r.json()
        for i, strato in enumerate(risposta["strati"]):
            yield _evento("strato", indice=i, nome=strato["nome"], millisecondi=strato["millisecondi"])

        punteggi = np.array(risposta["punteggi"])
        scala = (punteggi - punteggi.min()) / (np.ptp(punteggi) or 1) * 255
        colonne = [int(v) for v in scala] * 6  # canvas 10x6: una colonna di grigio per cifra
        yield _evento("restituisce", byte=len(r.content), rumore=colonne)
        yield _evento("decifra")
        registro.analizza_giro(img_uint8, img)

        # vista didattica: uscita di ogni strato sul server, confrontata con il riferimento locale
        rif = strati_in_chiaro(img)
        passi = [dict(nome="ingresso", millisecondi=0)]
        for strato, chiave in zip(risposta["strati"], ["conv", "x²#1", "fc1", "x²#2", "fc2"]):
            valori, atteso = np.array(strato["valori"]), rif[chiave]
            passi.append(dict(
                nome=strato["nome"],
                millisecondi=strato["millisecondi"],
                n_valori=len(valori),
                decifrato=arrotonda(valori, 5),  # stesso campo della modalità cifrata: qui è già in chiaro
                chiaro=arrotonda(atteso, 5),
                scarto=float(np.abs(valori - atteso).max()),
            ))
        chiaro = rif["fc2"]
        probabilita = np.exp(punteggi - punteggi.max())
        probabilita /= probabilita.sum()
        yield _evento("risultato", dati=dict(
            modalita="chiaro",
            pixel=pixel,
            sessione=SESSIONE,
            preprocessing=fasi,
            normalizzata=arrotonda(img.flatten(), 4),
            client=dict(
                punteggi=punteggi.round(4).tolist(),
                punteggi_grezzi=[float(v) for v in punteggi],
                probabilita=[float(v) for v in probabilita],
                predizione=int(punteggi.argmax()),
            ),
            canale=dict(
                byte_immagine=len(corpo),
                byte_risposta=len(r.content),
                ms_rete=t_rete,
                giro=registro.giro,
            ),
            server=dict(ms_totale=risposta["ms_totale"], passi=passi),
            verifica=dict(
                punteggi_chiaro=arrotonda(chiaro, 6),
                predizione_chiaro=int(chiaro.argmax()),
                errore_max=float(np.abs(punteggi - chiaro).max()),
            ),
        ))
    except Exception as errore:
        yield _evento("errore", messaggio=str(errore))


# ───────────── registro di rete ─────────────

@app.get("/api/rete")
def rete():
    return jsonify(pacchetti=registro.pacchetti, giro=registro.giro, server=INFO_SERVER, indirizzo=SERVER)


@app.get("/api/rete/<int:pid>/hex")
def rete_hex(pid: int):
    """Una pagina del corpo del pacchetto: offset, esadecimale, ASCII."""
    corpo = registro.corpi.get(pid)
    if corpo is None:
        return jsonify(errore="pacchetto non più disponibile"), 404
    da = max(0, min(int(request.args.get("da", 0)), max(0, len(corpo) - 1)))
    da -= da % 16
    n = min(int(request.args.get("n", 512)), 4096)
    righe = []
    for off in range(da, min(da + n, len(corpo)), 16):
        blocco = corpo[off : off + 16]
        righe.append(dict(
            off=off,
            hex=" ".join(f"{b:02x}" for b in blocco),
            ascii="".join(chr(b) if 32 <= b < 127 else "." for b in blocco),
        ))
    return jsonify(da=da, righe=righe, conservati=len(corpo))


@app.get("/api/rete/<int:pid>/scarica")
def rete_scarica(pid: int):
    corpo = registro.corpi.get(pid)
    if corpo is None:
        return jsonify(errore="pacchetto non più disponibile"), 404
    return Response(corpo, mimetype="application/octet-stream",
                    headers={"Content-Disposition": f"attachment; filename=pacchetto_{pid}.bin"})


if __name__ == "__main__":
    app.run(debug=False, port=5000)
