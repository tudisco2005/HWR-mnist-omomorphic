# Modello e training

[← Indice](../README.md)

La rete è piccola e usa solo somme e moltiplicazioni, perché è tutto ciò che CKKS
sa calcolare. È addestrata in chiaro con PyTorch e raggiunge il **97,77%** sul
test set.

## Architettura della rete

Definita in `modello.py` (`ReteCifrabile`), sul modello del tutorial MNIST di
TenSEAL e di CryptoNets.

| strato | uscita | parametri | nota |
|---|---|---|---|
| Input | 1 × 28 × 28 | – | immagine normalizzata |
| Convoluzione 7×7, passo 3, 4 canali | 4 × 8 × 8 = 256 | 200 | il passo 3 riduce a 64 finestre e sostituisce il pooling |
| x² | 256 | – | attivazione polinomiale al posto della ReLU |
| Densa fc1 | 64 | 16.448 | |
| x² | 64 | – | |
| Densa fc2 | 10 | 650 | un punteggio per cifra |
| **Totale** | | **17.298** | |

Perché è fatta così:

- **x² invece della ReLU.** La ReLU non è un polinomio e non si può calcolare su
  CKKS; x² è il polinomio non lineare più economico (una moltiplicazione).
- **Niente max-pooling.** Il massimo richiede confronti, impossibili sul ciphertext.
- **Poca profondità.** Ogni moltiplicazione consuma un livello del modulo: la
  rete ne usa 5 in sequenza (conv, x², fc1, x², fc2). Uno strato in più
  richiederebbe parametri CKKS più grandi e un'inferenza più lenta.
- **Addestrata già con x².** Non serve approssimare a posteriori una rete con ReLU.

## Dati

- **MNIST**: 60.000 immagini di training e 10.000 di test, 28×28 in scala di grigi.
- `dati_mnist.py` scarica i file IDX da un mirror pubblico (con un secondo di
  riserva) e li legge con `numpy`, senza torchvision. I file restano in `dati/`.
- **Normalizzazione**: pixel portati in [0, 1], poi `(x − 0,1307) / 0,3081`. La
  stessa funzione `normalizza()` è usata in training, nella valutazione cifrata e
  nella demo.

## Training

`python addestra.py` (circa un minuto su CPU).

| iperparametro | valore | motivo |
|---|---|---|
| Ottimizzatore | Adam, learning rate 0,001 | converge in poche epoche senza tuning |
| Perdita | cross-entropy | classificazione a 10 classi |
| Batch | 64 | come il tutorial TenSEAL di riferimento |
| Epoche | 10 | oltre la terza il guadagno è minimo |
| Seed | 73 | risultati riproducibili |

| epoca | loss di training | accuratezza di test |
|---:|---:|---:|
| 1 | 0,2822 | 96,18% |
| 2 | 0,1122 | 97,15% |
| 3 | 0,0842 | 97,56% |
| 4 | 0,0681 | 97,67% |
| 5 | 0,0570 | 97,66% |
| 6 | 0,0505 | 97,58% |
| 7 | 0,0445 | 98,01% |
| 8 | 0,0419 | 98,01% |
| 9 | 0,0412 | 97,79% |
| 10 | 0,0331 | **97,77%** |

Il modello salvato in `modello.pt` è quello **finale**, non il picco del 98,01%:
non c'è un validation set separato, e scegliere l'epoca guardando il test set
gonfierebbe il risultato.

## Valutazione cifrata

`python valuta_cifrato.py 100` cifra le prime 100 immagini di test, le fa
classificare al server sul ciphertext e confronta con lo stesso modello in chiaro:

| misura | valore |
|---|---|
| Accuratezza cifrata | 100% |
| Predizioni identiche al modello in chiaro | 100% |
| Scarto massimo sui punteggi | 2,3 × 10⁻³ |
| Tempo medio per immagine | ~3,5 s |
