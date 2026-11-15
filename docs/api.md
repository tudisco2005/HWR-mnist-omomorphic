# API

[← Indice](../README.md)

Due servizi HTTP locali: il **server** (`server_fhe.py`, porta 5001), che riceve
solo bytes, e il **client** (`app.py`, porta 5000), che serve la demo.

## Server · http://127.0.0.1:5001

Ogni risposta contiene `X-SHA256-Ricevuto` e `X-Byte-Ricevuti`: impronta e
dimensione del corpo ricevuto.

| metodo e percorso | richiesta | risposta |
|---|---|---|
| `GET /info` | – | `{"pid", "porta", "client_registrati"}` |
| `POST /contesto` | corpo: contesto pubblico serializzato (senza chiave segreta) | `{"id_client", "ms"}` |
| `POST /inferenza` | corpo: ciphertext; intestazioni `X-Client-Id`, `X-Finestre` | stream NDJSON (sotto) |
| `GET /modello` | – | pesi in chiaro (`state_dict` come liste), solo per la vista didattica |

### Stream di `POST /inferenza`

Una riga JSON per evento, in HTTP/1.1 chunked, inviata appena l'evento avviene:

```json
{"evento": "ricevuto", "byte": 1449320}
{"evento": "passo", "nome": "ricezione", "millisecondi": 8.1, "byte": 1449320, "livello": 7, "scala_bit": 40.0, "polinomi": 2, "n_valori": 4096, "descrizione": "...", "ciphertext": "<base64>"}
{"evento": "passo", "nome": "conv", ...}
{"evento": "passo", "nome": "x²", ...}
{"evento": "passo", "nome": "fc1", ...}
{"evento": "passo", "nome": "x²", ...}
{"evento": "passo", "nome": "fc2", ...}
{"evento": "fine", "ms_totale": 4033.0}
```

Il `ciphertext` dell'ultimo passo (fc2) contiene i punteggi cifrati.

## Client · http://127.0.0.1:5000

| metodo e percorso | risposta |
|---|---|
| `GET /` | la pagina della demo |
| `POST /api/riconosci` | stream NDJSON delle fasi (sotto); corpo `{"immagine": "<data URL PNG>"}` |
| `GET /api/esempio` | `{"pixel": [784 valori], "etichetta"}`: una cifra a caso del test set |
| `GET /api/modello` | pesi arrotondati per l'ispettore |
| `GET /api/rete` | registro dei pacchetti, PID e indirizzo del server |
| `GET /api/rete/<id>/hex?da=<offset>&n=<byte>` | una pagina del corpo: righe con offset, esadecimale e ASCII |
| `GET /api/rete/<id>/scarica` | il corpo del pacchetto come file `.bin` |

### Stream di `POST /api/riconosci`

| evento | quando | dati |
|---|---|---|
| `cifra` | il client inizia preprocessing e cifratura | – |
| `cifrato` | ciphertext pronto | `pixel` (28×28), `byte`, `rumore` |
| `invia` | il ciphertext parte verso il server | `byte` |
| `calcola` | il server ha ricevuto tutto il corpo | – |
| `strato` | il server ha finito uno strato | `indice`, `nome`, `millisecondi` |
| `restituisce` | punteggi cifrati arrivati | `byte`, `rumore` |
| `decifra` | il client decifra | – |
| `risultato` | fine | `dati`: cifra, punteggi, probabilità, preprocessing, slot, passi con vista didattica, verifica |
| `errore` | qualcosa è andato storto | `messaggio` |
