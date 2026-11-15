# Riconoscere cifre scritte a mano senza guardarle

Progetto didattico: una rete neurale riconosce le cifre del dataset **MNIST**
lavorando su immagini **cifrate con crittografia omomorfica** (schema CKKS,
libreria [TenSEAL](https://github.com/OpenMined/TenSEAL)).

Il server esegue tutta la rete neurale sull'immagine cifrata e restituisce un
risultato cifrato. Solo il client, che ha la chiave segreta, può leggere quale
cifra è stata riconosciuta.

```
  CLIENT (ha la chiave segreta)                     SERVER (ha il modello)
  ─────────────────────────────                     ──────────────────────
  genera le chiavi CKKS
  invia il contesto PUBBLICO   ───────────────────▶ chiave pubblica + chiavi di valutazione
  cifra l'immagine 28x28       ───── ciphertext ──▶ conv → x² → fc → x² → fc
                                                     (calcola sul ciphertext, non vede la cifra)
  decifra i 10 punteggi        ◀──── ciphertext ─── restituisce i punteggi cifrati
  → predizione
```

## Approccio

| fase | dove avviene | perché |
|---|---|---|
| Training | in chiaro, con PyTorch | veloce, ~97,8% di accuratezza sul test set |
| Inferenza | sui dati cifrati, con TenSEAL | il server non vede né l'immagine né il risultato |

Il training cifrato di reti neurali è ancora materia di ricerca: le librerie
pronte supportano solo modelli semplici come la regressione logistica. Per questo
il progetto addestra in chiaro e cifra solo l'inferenza, lo scenario più comune
nella pratica (*Machine Learning as a Service* che rispetta la privacy).

## Demo web grafica

- Canvas dove disegnare la cifra.
- schema dei vari passaggi mostrati in modo chiaro
- quello che vede il server e quello che vede il client
- **ispettore** (pulsante *Ispeziona*, tasto `I`, o clic su qualsiasi elemento): una
  pagina per ogni fase. Mostra il preprocessing passo per passo, i parametri CKKS e le
  chiavi, la codifica im2col (finestre e slot collegati al passaggio del mouse) e
  l'anatomia del ciphertext. Per ogni strato del server: livello e scala del
  ciphertext, pesi in chiaro, contenuto decifrato (vista didattica) e confronto con
  PyTorch. Chiude con il budget dei livelli e la decifratura finale.

## Documentazione

Nella cartella `documentazione/`:

- `Report e documentazione del progetto.pdf`: architettura, modello, inferenza cifrata, demo, ispettore, verifica di rete, installazione e API, decisioni e limiti.
- `Report training e decisioni.pdf`: come è stato addestrato il modello e le scelte fatte.

## Come eseguire

```bash
pip install -r requirements.txt
python addestra.py          # scarica MNIST, addestra in chiaro, salva modello.pt (~1 min)
python valuta_cifrato.py 100  # confronta inferenza cifrata e in chiaro su 100 immagini
python app.py               # demo su http://127.0.0.1:5000 (avvia da solo server_fhe.py sulla porta 5001)
```

All'avvio `app.py` genera le chiavi e registra il contesto pubblico sul server
(~15 s, una volta sola); poi ogni cifra richiede ~4 s.

| file | contenuto |
|---|---|
| `dati_mnist.py` | download e lettura di MNIST (senza torchvision) |
| `modello.py` | la rete: conv 7×7 → x² → fc 256→64 → x² → fc 64→10 |
| `addestra.py` | training in chiaro con PyTorch |
| `fhe.py` | classi `Client` (chiavi, cifra, decifra) e `Server` (rete sul ciphertext) |
| `valuta_cifrato.py` | accuratezza cifrata vs in chiaro |
| `server_fhe.py` | processo SERVER (porta 5001): modello + calcolo sul ciphertext, riceve solo bytes via HTTP |
| `app.py`, `static/` | processo CLIENT + demo web (Flask): chiavi, cifratura, decifratura |
| `rete.py` | registro dei pacchetti HTTP e rilevatore che cerca l'immagine in ogni corpo trasmesso |

### Dettagli tecnici

- **Parametri CKKS**: grado 16384, modulo `[60, 40×6, 60]` (360 bit, 128 bit di
  sicurezza), scala 2⁴⁰. Cinque moltiplicazioni in profondità: conv, x², fc1, x², fc2.
- **Convoluzione**: codifica *im2col* lato client, così il server la calcola
  con prodotti slot per slot.
- **Bias di fc1 dentro la matrice**: sommare un vettore in chiaro dopo `mm()`
  rompe la disposizione degli slot che il `mm()` successivo si aspetta (errore
  ~0,5 sui punteggi). Il server aggiunge un blocco di slot costanti a 1 e
  righe extra `b1/64` nella matrice: l'errore scende a ~10⁻³.
- **Contesto pubblico**: ~326 MB (soprattutto chiavi di Galois per le
  rotazioni). Si invia una volta per sessione, poi viaggiano solo ciphertext
  da ~1,4 MB (andata) e ~260 kB (ritorno).
- Client e server sono **due processi distinti** che comunicano via HTTP. Il
  client vive in Python (TenSEAL non funziona nel browser), quindi il disegno va
  dal browser al processo client sullo stesso computer; al server arrivano solo
  il contesto pubblico e i ciphertext.
- **Verifica dei pacchetti**: ogni corpo HTTP scambiato viene registrato con
  SHA-256 (confermato dal server) ed entropia, e analizzato da un rilevatore che
  cerca l'immagine come PNG, base64, pixel uint8 e valori float32/float64. Il
  pacchetto browser → client fa da controllo: lì il rilevatore deve trovarla.
  Nell'ispettore, pagina *Rete*, si apre ogni pacchetto byte per byte e lo si
  scarica come `.bin`. Per una verifica indipendente: Wireshark sull'interfaccia
  di loopback con filtro `tcp.port == 5001`.

## Riferimenti

- Benaissa et al., *TenSEAL: A Library for Encrypted Tensor Operations Using
  Homomorphic Encryption*, ICLR 2021 Workshop.
  [arXiv:2104.03152](https://arxiv.org/abs/2104.03152)
- Cheon, Kim, Kim, Song, *Homomorphic Encryption for Arithmetic of Approximate
  Numbers* (CKKS), ASIACRYPT 2017.
- Gilad-Bachrach et al., *CryptoNets: Applying Neural Networks to Encrypted Data
  with High Throughput and Accuracy*, ICML 2016.
- Halevi, Shoup, *Algorithms in HElib*, CRYPTO 2014: è il metodo diagonale usato
  per il prodotto matrice-vettore.