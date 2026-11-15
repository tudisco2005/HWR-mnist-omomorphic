# Decisioni e problemi risolti

[← Indice](../README.md)

Il problema più rilevante è stato un errore sistematico di circa 0,5 sui
punteggi cifrati, causato dal bias di fc1. Le altre scelte servono a rendere la
demo verificabile e leggibile in aula.

| problema o esigenza | decisione | effetto |
|---|---|---|
| Punteggi cifrati fino a 2 punti lontani da quelli in chiaro | confronto strato per strato: conv, fc1 e x² esatti, errore solo in fc2; bias di fc1 inglobato nella matrice con un blocco costante | scarto da 0,43 a 0,001, predizioni identiche |
| Tentativo di azzerare gli slot con una maschera prima di fc2 | scartato: consumava un livello e peggiorava l'errore a 2,4 | – |
| Parametri del tutorial (grado 8192, scala 2²⁶): 5 bit per la parte intera | grado 16384, scala 2⁴⁰, primi esterni da 60 bit | i punteggi fino a ~50 stanno nel modulo |
| Contesto pubblico di 326 MB deserializzato a ogni richiesta | inviato una volta per sessione, il server lo tiene in memoria | da ~6,8 a ~4 s per cifra |
| Client e server nello stesso processo: la "rete" non era verificabile | due processi separati che parlano solo via HTTP, registro dei pacchetti e rilevatore | prova concreta che l'immagine non lascia il client |
| Barra dei passi guidata da timer, che tornava indietro | eventi reali in streaming (NDJSON) dal server al client e dal client al browser | ogni fase e ogni strato si accende quando avviene |
| Eventi del server arrivati tutti insieme a fine calcolo | server Werkzeug in HTTP/1.1 (chunked) e multi-thread | eventi recapitati appena prodotti |
| Conflitto tra runtime OpenMP di PyTorch e TenSEAL su Windows | `torch` importato prima di `tenseal` in `fhe.py` | nessun crash |
| torchvision non installato | lettore MNIST con `numpy` (`dati_mnist.py`) | nessuna dipendenza in più |
| Presentazione su proiettore | una schermata senza scroll, testo in rem che scala, tema scuro, tasti rapidi, pulsante Esempio | leggibile da 1024×768 a 1920×1080 |
| Scelta del modello da salvare | l'ultima epoca (97,77%), non il picco (98,01%) | nessuna scelta fatta guardando il test set |

## Perché il bias rompeva il calcolo

`CKKSVector.mm()` lascia il risultato in una disposizione degli slot che il
`mm()` successivo si aspetta di trovare intatta. Sommare un vettore in chiaro di
64 valori la altera. Lo si è isolato così:

1. decifrando ogni strato e confrontandolo con PyTorch: conv, x² e fc1 erano
   esatti, l'errore compariva solo dopo fc2;
2. ripetendo la catena fc1 → x² → fc2 su vettori casuali **senza bias**: esatta;
3. aggiungendo il bias dopo fc1: errore di nuovo.

La soluzione (blocco costante a 1 e righe b₁/64 nella matrice) è descritta in
[Inferenza cifrata](inferenza-cifrata.md#3-bias-di-fc1-inglobato-nella-matrice).
