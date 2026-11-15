"""SERVER: processo separato che possiede il modello e calcola sul ciphertext.

Avvio:  python server_fhe.py      (lo avvia anche app.py in automatico)
Ascolta su http://127.0.0.1:5001 e riceve solo bytes:

  POST /contesto    corpo = contesto pubblico serializzato (senza chiave segreta)
  POST /inferenza   corpo = immagine cifrata; intestazioni X-Client-Id, X-Finestre
  GET  /modello     pesi in chiaro (servono al client solo per la vista didattica)
  GET  /info        PID e stato del processo

Ogni risposta riporta in X-SHA256-Ricevuto l'impronta del corpo ricevuto, così il
client può verificare che il server abbia visto esattamente i byte registrati.
"""

import base64
import hashlib
import json
import os
import time
from pathlib import Path

from flask import Flask, Response, jsonify, request

from fhe import Server

PORTA = 5001
QUI = Path(__file__).parent

app = Flask(__name__)
server = Server(QUI / "modello.pt")


def _con_impronta(risposta: Response) -> Response:
    risposta.headers["X-SHA256-Ricevuto"] = hashlib.sha256(request.get_data()).hexdigest()
    risposta.headers["X-Byte-Ricevuti"] = str(len(request.get_data()))
    return risposta


@app.get("/info")
def info():
    return _con_impronta(jsonify(pid=os.getpid(), porta=PORTA, client_registrati=len(server.contesti)))


@app.post("/contesto")
def contesto():
    t0 = time.perf_counter()
    id_client = server.registra_client(request.get_data())
    return _con_impronta(jsonify(id_client=id_client, ms=round((time.perf_counter() - t0) * 1000)))


@app.post("/inferenza")
def inferenza():
    """Risposta in streaming (una riga JSON per evento), così il client vede
    l'avanzamento reale: corpo ricevuto, poi la fine di ogni strato."""
    ciphertext = request.get_data()  # il corpo è letto tutto prima di rispondere
    id_client = request.headers["X-Client-Id"]
    n_finestre = int(request.headers["X-Finestre"])

    def eventi():
        t0 = time.perf_counter()
        yield json.dumps(dict(evento="ricevuto", byte=len(ciphertext))) + "\n"
        for p in server.inferenza_a_passi(id_client, ciphertext, n_finestre):
            # ciphertext intermedi: ancora cifrati, servono al client solo per la vista didattica
            yield json.dumps(dict(
                evento="passo",
                nome=p.nome,
                descrizione=p.descrizione,
                millisecondi=round(p.millisecondi, 1),
                byte=p.byte,
                livello=p.livello,
                scala_bit=p.scala_bit,
                polinomi=p.polinomi,
                n_valori=p.n_valori,
                ciphertext=base64.b64encode(p.ciphertext).decode(),
            )) + "\n"
        yield json.dumps(dict(evento="fine", ms_totale=round((time.perf_counter() - t0) * 1000, 1))) + "\n"

    return _con_impronta(Response(eventi(), mimetype="application/x-ndjson"))


@app.get("/modello")
def modello():
    return _con_impronta(jsonify({k: v.tolist() for k, v in server.modello.state_dict().items()}))


if __name__ == "__main__":
    from werkzeug.serving import WSGIRequestHandler

    # HTTP/1.1: le risposte in streaming usano il chunked encoding, quindi ogni
    # evento arriva al client appena prodotto (con HTTP/1.0 il client lo
    # leggerebbe solo a risposta completa).
    WSGIRequestHandler.protocol_version = "HTTP/1.1"
    print(f"Server FHE in ascolto su http://127.0.0.1:{PORTA} (PID {os.getpid()})")
    app.run(host="127.0.0.1", port=PORTA, debug=False, threaded=True)
