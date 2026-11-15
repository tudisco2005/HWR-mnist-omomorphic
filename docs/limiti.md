# Limiti e sviluppi possibili

[← Indice](../README.md)

Il limite principale è che il client non gira nel browser: il disegno passa dal
browser al processo client sullo stesso computer prima di essere cifrato.

| limite | dettaglio | possibile sviluppo |
|---|---|---|
| Client in Python | TenSEAL non funziona nel browser; la demo lo dichiara e usa quel passaggio come controllo del rilevatore | cifratura nel browser con una libreria in WebAssembly |
| Vista didattica | il server restituisce anche i ciphertext intermedi e i pesi del modello, solo per l'ispettore: la risposta pesa ~6,7 MB invece di 262 kB | modalità "produzione" che restituisce solo i punteggi |
| Modello visibile al server | la cifratura protegge immagine e risultato, non il modello | – (è il modello del server) |
| Contesto pesante | 326 MB, quasi tutti chiavi di Galois per ogni rotazione | generare solo le rotazioni effettivamente usate |
| Una cifra per ciphertext | si è preferita la chiarezza | impacchettare molte immagini negli slot, come CryptoNets |
| Verifica cifrata parziale | provata su 100 immagini (~3,5 s l'una); il test set completo richiederebbe ~10 ore | esecuzione in background sull'intero test set |
| Cifre disegnate a mano | tratto e proporzioni diversi da MNIST possono abbassare l'accuratezza | data augmentation in training |
| Server riusato all'avvio | se `app.py` si chiude bruscamente, il server resta sulla porta 5001 e viene riusato | dopo una modifica a `server_fhe.py` chiuderlo a mano |
| Verifica con Wireshark | descritta ma non eseguita durante lo sviluppo | eseguirla e allegare la cattura |
