# Ispettore

[← Indice](../README.md)

L'ispettore apre ogni fase del processo con i **dati reali dell'ultima cifra
riconosciuta**: 13 pagine raggiungibili dalla barra laterale, con le frecce ← →
o cliccando gli elementi della vista principale. Passando il mouse su mappe e
barre si legge ogni singolo valore. `Esc` chiude.

## Le pagine

| gruppo | pagina | cosa mostra |
|---|---|---|
| Client, prima dell'invio | **Preprocessing** | le 5 fasi dal disegno alla 28×28: riquadro della cifra, ritaglio, riduzione a 20 px, griglia, centratura sul baricentro |
| | **Normalizzazione** | pixel 0–255 accanto ai valori normalizzati, formula, minimo, massimo e media |
| | **Chiavi e parametri CKKS** | parametri dello schema, catena del modulo, le 4 chiavi con dimensione, dove stanno e a cosa servono |
| | **Codifica im2col** | passando il mouse su una finestra dell'immagine si illumina la colonna corrispondente negli slot 64×64, e viceversa; la finestra scelta ingrandita |
| | **Cifratura** | cosa conosce il client (4096 valori) e cosa riceve il server (byte); anatomia del ciphertext: polinomi, coefficienti, livello, scala, dimensione grezza e compressa |
| Rete | **Cosa viaggia in rete** | esito della verifica, tabella dei pacchetti, pop-up byte per byte: vedi [Verifica di rete](verifica-di-rete.md) |
| Server, sul ciphertext | **conv, x², fc1, x², fc2** | una pagina per strato (dettagli sotto) |
| | **Livelli consumati** | i primi del modulo rimasti dopo ogni passo, da 7 a 1, con dimensioni e tempi |
| Client, al ritorno | **Decifratura** | punteggi decifrati, valori PyTorch, differenze e probabilità softmax |

## Le pagine degli strati

Ogni pagina di strato ha:

- **riepilogo**: operazione, forma (es. 256 → 64), tempo, livelli consumati;
- **il server vede**: i byte del ciphertext come immagine, livello, scala,
  polinomi, valori, dimensione;
- **pesi in chiaro**: i 4 kernel 7×7 della convoluzione, le matrici W₁ (64 × 256)
  e W₂ (10 × 64) con i bias; per x² nessun peso;
- **vista didattica**: il contenuto del ciphertext decifrato con la chiave del
  client (le 4 mappe 8×8 dei canali e il blocco costante, i 64 neuroni, i 10
  punteggi);
- **confronto con PyTorch**: grafico di dispersione tra valori decifrati e valori
  dello stesso modello in chiaro, con lo scarto massimo (da ~10⁻⁵ dopo conv a
  ~10⁻³ alla fine).

## La vista didattica

Per costruire queste pagine il server restituisce anche i ciphertext intermedi
(ancora cifrati) e il client li decifra. È marcata in viola come **vista
didattica**: il server non può vedere quei valori. In un sistema reale il client
riceverebbe solo il risultato finale.
