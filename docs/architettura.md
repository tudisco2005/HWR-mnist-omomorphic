# Architettura

[← Indice](../README.md)

Il sistema è fatto di **due processi distinti** che comunicano solo via HTTP, più
la pagina web nel browser. Il client tiene la chiave segreta; il server tiene il
modello e calcola senza poter decifrare nulla.

```mermaid
flowchart LR
    subgraph PC["computer dell'utente"]
        B["Browser<br/>pagina web, disegno,<br/>barra dei passi, ispettore<br/><i>nessuna chiave</i>"]
        C["Client · app.py :5000<br/><b>chiave segreta</b><br/>preprocessing<br/>cifra e decifra<br/>registro pacchetti e rilevatore"]
    end
    S["Server · server_fhe.py :5001<br/><b>modello in chiaro</b><br/>contesto pubblico<br/>esegue la rete sul ciphertext<br/><i>nessuna chiave segreta</i>"]
    B -- "disegno (PNG)" --> C
    C -- "fasi in tempo reale e risultato" --> B
    C -. "contesto pubblico (una volta)" .-> S
    C -- "immagine cifrata" --> S
    S -- "eventi e punteggi cifrati (stream)" --> C
```

## I componenti

| componente | file | possiede | fa |
|---|---|---|---|
| Browser | `static/` | niente di segreto | raccoglie il disegno, mostra le fasi e l'ispettore |
| Client | `app.py`, `fhe.Client`, `rete.py` | chiave segreta | prepara e cifra l'immagine, decifra i punteggi, registra e analizza i pacchetti |
| Server | `server_fhe.py`, `fhe.Server` | modello addestrato, contesto pubblico | esegue conv → x² → fc1 → x² → fc2 sul ciphertext |

TenSEAL non funziona nel browser, quindi il client è un processo Python. Il
disegno passa dal browser al client **sullo stesso computer**; al server arrivano
solo il contesto pubblico e i ciphertext. `app.py` avvia `server_fhe.py` da solo
se sulla porta 5001 non risponde già un server.

## Cosa viaggia tra client e server

| messaggio | direzione | dimensione | quando |
|---|---|---|---|
| Contesto pubblico: parametri, chiave pubblica, chiavi di rilinearizzazione e di Galois | client → server | 326 MB | una volta per sessione |
| Immagine cifrata (CKKSVector serializzato) + numero di finestre | client → server | 1,4 MB | a ogni cifra |
| Eventi di avanzamento, ciphertext intermedi, punteggi cifrati | server → client | ~6,7 MB in stream | a ogni cifra |
| Pesi del modello (solo per la vista didattica) | server → client | 358 kB | una volta per sessione |

Il numero di finestre (64) viaggia in chiaro: dipende solo dalla forma 28×28
dell'input, non dal contenuto. I ciphertext intermedi servono solo
all'[ispettore](ispettore.md); in un sistema reale il server restituirebbe solo i
punteggi (262 kB).

## Flusso di una richiesta

```mermaid
sequenceDiagram
    participant B as Browser
    participant C as Client (app.py)
    participant S as Server (server_fhe.py)
    Note over C,S: all'avvio: chiavi CKKS, POST /contesto (326 MB)
    B->>C: POST /api/riconosci (disegno PNG)
    C-->>B: evento "cifra"
    C->>C: preprocessing + cifratura
    C-->>B: evento "invia"
    C->>S: POST /inferenza (ciphertext)
    S-->>C: "ricevuto"
    C-->>B: evento "calcola"
    loop per ogni strato: conv, x², fc1, x², fc2
        S-->>C: "passo" (tempo, livello, ciphertext)
        C-->>B: evento "strato"
    end
    S-->>C: "fine"
    C-->>B: eventi "restituisce", "decifra"
    C->>C: decifratura con la chiave segreta
    C-->>B: evento "risultato" (cifra, punteggi, dati per l'ispettore)
```

Entrambe le risposte sono in streaming (una riga JSON per evento), così la barra
dei passi della demo avanza solo quando una fase avviene davvero. Dettagli in
[API](api.md).
