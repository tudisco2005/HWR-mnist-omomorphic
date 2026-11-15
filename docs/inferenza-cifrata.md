# Inferenza cifrata

[← Indice](../README.md)

Il server esegue tutti e cinque gli strati sul ciphertext con parametri CKKS a
**128 bit di sicurezza**. L'errore introdotto dalla cifratura resta intorno a
10⁻³ sui punteggi. Il codice è in `fhe.py`.

## Parametri CKKS

| parametro | valore | motivo |
|---|---|---|
| Grado del polinomio N | 16384 (8192 slot) | abbastanza bit di modulo a 128 bit di sicurezza |
| Catena del modulo | `[60, 40, 40, 40, 40, 40, 40, 60]` = 360 bit | limite 438 bit per N = 16384 |
| Scala | 2⁴⁰ | precisione di circa 10⁻³ sui punteggi |
| Primi esterni da 60 bit | 20 bit per la parte intera | i punteggi finali arrivano a circa 50 |
| Chiavi di Galois | tutte le rotazioni | servono alle somme in conv, fc1 e fc2 |

Il primo da 60 bit tiene il risultato finale, i sei da 40 bit sono i **livelli**
(ogni moltiplicazione seguita da rescale ne consuma uno), l'ultimo da 60 bit è il
primo speciale usato solo per lo scambio di chiavi.

## Le chiavi

| chiave | dimensione | dove sta | a cosa serve |
|---|---:|---|---|
| Segreta | 0,85 MB | solo client | decifrare |
| Pubblica | 1,7 MB | client e server | cifrare (il server potrebbe cifrare, non decifrare) |
| Rilinearizzazione | 12 MB | server | dopo x · x riporta il ciphertext da 3 a 2 polinomi |
| Galois | 312 MB | server | ruotare gli slot per le somme |

Il contesto pubblico (tutto tranne la chiave segreta) pesa 326 MB, al 96% chiavi
di Galois. Si invia una volta per sessione e il server lo tiene in memoria.

## Le tre tecniche usate

### 1. Codifica im2col (sul client)

La convoluzione 7×7 con passo 3 guarda 64 finestre dell'immagine. Il client le
dispone negli slot come una matrice 64×64:

- **colonna** = finestra (64 finestre su una griglia 8×8);
- **riga** = pixel della finestra (49 righe usate, 49–63 a zero);
- 64 × 64 = 4096 slot su 8192 disponibili.

Così il server calcola ogni canale moltiplicando gli slot per il kernel replicato
e sommando le righe con rotazioni: ogni colonna diventa un valore della mappa 8×8.

### 2. Prodotto matrice-vettore con il metodo diagonale

Gli strati densi usano `CKKSVector.mm()` di TenSEAL, che implementa il metodo
diagonale di Halevi e Shoup: il vettore cifrato viene moltiplicato per le
diagonali della matrice in chiaro e le versioni ruotate vengono sommate.

### 3. Bias di fc1 inglobato nella matrice

Sommare un vettore in chiaro all'uscita di `mm()` altera la disposizione degli
slot che il `mm()` successivo si aspetta, e produce un errore di circa 0,5 sui
punteggi. Il server quindi:

1. aggiunge al vettore della convoluzione un blocco di 64 slot costanti a 1
   (`canale × 0 + 1`); dopo il quadrato restano 1, perché 1² = 1;
2. aggiunge alla matrice di fc1 64 righe uguali a b₁/64.

Il prodotto matrice-vettore somma così esattamente b₁, senza addizioni separate.
Il bias di fc2 si somma direttamente, perché dopo fc2 non c'è un altro prodotto.

## Il budget dei livelli

| passo | primi rimasti | dimensione del ciphertext | valori |
|---|---:|---:|---:|
| ingresso | 7 | 1,45 MB | 4096 |
| conv | 5 | 1,05 MB | 320 |
| x² | 4 | 0,86 MB | 320 |
| fc1 | 3 | 0,66 MB | 64 |
| x² | 2 | 0,46 MB | 64 |
| fc2 | 1 | 0,26 MB | 10 |

La convoluzione consuma due livelli: uno per il prodotto con il kernel, uno per il
blocco costante; poi tutti i vettori sono allineati al livello più basso. La rete
arriva a un solo primo: uno strato in più richiederebbe parametri più grandi.

## Separazione tra client e server

- `fhe.Client` genera le chiavi, cifra (`cifra()`) e decifra (`decifra()`).
- `fhe.Server` riceve il contesto pubblico come bytes (`registra_client()`) e
  verifica con `is_private()` di non avere la chiave segreta.
- `Server.inferenza_a_passi()` è un generatore che produce un risultato appena
  finisce ogni strato, con tempo, livello, scala e ciphertext; la demo lo usa per
  mostrare l'avanzamento reale.
- I due oggetti vivono in processi diversi (`app.py` e `server_fhe.py`) e si
  scambiano solo bytes via HTTP: vedi [Architettura](architettura.md).
