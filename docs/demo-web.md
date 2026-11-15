# Demo web

[← Indice](../README.md)

La demo è pensata per una presentazione: la vista principale sta in una sola
schermata 16:9 senza scroll (verificata a 1024×768, 1366×768 e 1920×1080), con
tema scuro e testo che scala con la larghezza dello schermo.

Avvio: `python app.py`, poi http://127.0.0.1:5000.

## La vista principale

| zona | cosa mostra |
|---|---|
| **Client** (sinistra) | area di disegno; pulsanti Riconosci, Esempio, Cancella, Ispeziona; l'immagine 28×28 "come la vede il client"; la cifra riconosciuta con le barre dei 10 punteggi; una riga di verifica (stessa cifra del modello in chiaro, scarto massimo, tempo del calcolo cifrato) |
| **Rete** (centro) | le frecce con le dimensioni reali dei messaggi; a fine riconoscimento l'esito della verifica dei pacchetti ("immagine assente nei 2 pacchetti trasmessi") |
| **Server** (destra) | i byte del ciphertext ricevuto disegnati come pixel ("solo rumore"); la pipeline conv → x² → fc1 → x² → fc2 con il tempo di ogni strato; i 10 punteggi restituiti come li vede il server, con un "?" |

## La barra dei passi

Disegna → Cifra → Invia → Calcolo cifrato → Restituisce → Decifra.

La barra **avanza solo con gli eventi reali**: il backend risponde in streaming,
una riga JSON per fase, e ogni strato della pipeline si illumina quando il server
lo finisce davvero. Non ci sono timer né animazioni ripetute. Esempio misurato:

| momento | passo attivo | cosa è successo |
|---|---|---|
| 0 s | Disegna | pagina aperta |
| +0,03 s | Cifra | il client prepara e cifra l'immagine |
| +0,13 s | Invia | il ciphertext parte verso il server |
| +0,17 s | Calcolo cifrato | il server ha ricevuto tutti i byte |
| +0,95 s | conv ✓ | |
| +4,2 s | fc1 ✓ | lo strato più lento, ~3,2 s |
| +4,5 s | fc2 ✓ | |
| +4,55 s | Restituisce → Decifra | punteggi tornati e decifrati |

All'apertura e dopo Cancella è attivo **Disegna**.

## Preprocessing come MNIST

Il disegno viene trasformato nello stesso formato delle immagini di training:
ritaglio dei pixel accesi, riduzione a 20 px sul lato lungo, inserimento in una
griglia 28×28 e centratura sul baricentro. Senza questo passaggio la rete
vedrebbe cifre con proporzioni e posizioni diverse da quelle che ha imparato.

## Tasti e interazioni

| tasto | azione |
|---|---|
| `Invio` | riconosci |
| `E` | carica una cifra a caso dal test set MNIST (utile se il disegno dal vivo non viene bene) |
| `I` | apri l'[ispettore](ispettore.md) |
| `Canc`, `Backspace`, `Esc` | cancella |

Dopo un riconoscimento ogni elemento della pagina è cliccabile e apre la fase
corrispondente dell'ispettore (stepper, immagini, pacchetti, strati, risultato).

## File

| file | contenuto |
|---|---|
| `static/index.html` | struttura della pagina e dell'ispettore |
| `static/style.css` | tema scuro della vista principale |
| `static/app.js` | disegno, lettura dello stream di eventi, barra dei passi |
| `static/ispettore.js`, `static/ispettore.css` | l'ispettore e il pop-up dei pacchetti |

I font (Inter, JetBrains Mono) vengono da Google Fonts; senza connessione la
pagina usa Segoe UI e resta leggibile.
