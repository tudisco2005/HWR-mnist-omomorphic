# Verifica di rete

[← Indice](../README.md)

Ogni pacchetto HTTP scambiato tra client e server viene registrato e analizzato.
In tutte le prove l'immagine **non è mai comparsa** nei pacchetti verso il server,
mentre il rilevatore la trova nel pacchetto di controllo. Il codice è in `rete.py`.

## Il registro

Per ogni corpo trasmesso il client registra:

| campo | significato |
|---|---|
| direzione | client → server, server → client, oppure browser → client (locale) |
| prima riga e intestazioni HTTP | come inviate o ricevute |
| dimensione | byte del corpo |
| SHA-256 | impronta dell'intero corpo |
| entropia | bit per byte: 8 = indistinguibile da byte casuali |
| conferma | il server ha ricevuto gli stessi byte? |
| controlli | esito della ricerca dell'immagine |

Si conservano la sessione di avvio e gli ultimi 3 riconoscimenti. I corpi oltre
16 MB (il contesto pubblico) sono conservati solo per l'inizio, ma lo SHA-256
riguarda l'intero corpo.

## Conferma del server

Ogni risposta di `server_fhe.py` contiene l'intestazione `X-SHA256-Ricevuto` con
l'impronta dei byte che il server ha ricevuto davvero. Il client la confronta con
quella registrata: le due parti si confermano a vicenda.

## Il rilevatore

Cerca l'immagine in tutte le forme in cui potrebbe uscire dal client:

| forma cercata | come |
|---|---|
| File PNG | firma `89 50 4E 47 0D 0A 1A 0A` |
| PNG in base64 (data URL del canvas) | testo `iVBORw0KGgo` |
| Immagine 28×28 intera | 784 byte uint8 consecutivi |
| Righe di pixel | 28 byte uint8 per ogni riga con tratti della cifra |
| Righe normalizzate float32 | 112 byte per riga: i valori esatti che il client cifra |
| Righe normalizzate float64 | 224 byte per riga |

### Il pacchetto di controllo

Il passaggio **browser → client** (sullo stesso computer) contiene davvero il
disegno, e lì il rilevatore deve trovarlo ("PNG in base64: trovata, atteso"). Se
lo trova lì e non nei pacchetti verso il server, l'esito "assente" è credibile.

## Esito tipico per una cifra

| pacchetto | dimensione | entropia | immagine |
|---|---:|---:|---|
| browser → client `POST /api/riconosci` | ~25 kB | 5,9 | trovata (atteso) |
| client → server `POST /inferenza` | 1,4 MB | 7,96 | assente, SHA-256 confermato |
| server → client `200 OK` (stream) | ~6,7 MB | 6,0 | assente |

L'entropia di 7,96 bit/byte del ciphertext è praticamente quella di byte casuali.
La risposta ha un valore più basso perché i ciphertext sono in base64 dentro un
testo JSON.

## Nella demo

- Sotto le frecce della vista principale: "✓ immagine assente nei 2 pacchetti
  trasmessi", cliccabile.
- Nell'[ispettore](ispettore.md), pagina **Cosa viaggia in rete**: esito in
  evidenza e tabella di tutti i pacchetti. Un clic su una riga apre un **pop-up**
  con intestazione HTTP, risultati della ricerca, corpo esadecimale navigabile
  (pagine da 512 byte, salto a un offset) e download come `.bin`. Nel pop-up
  ← → passano agli altri pacchetti, `Esc` chiude.

## Verifica indipendente

Con Wireshark sull'interfaccia di loopback (Npcap) e filtro `tcp.port == 5001` si
catturano gli stessi pacchetti: gli SHA-256 dei corpi HTTP devono coincidere con
quelli del registro. Questa verifica non è stata eseguita durante lo sviluppo.
