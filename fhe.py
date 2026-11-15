"""Inferenza cifrata con TenSEAL (schema CKKS).

Due ruoli ben separati, che comunicano SOLO tramite bytes serializzati:

  Client  - genera le chiavi, cifra l'immagine, decifra il risultato.
            È l'unico a possedere la chiave segreta.
  Server  - possiede il modello; riceve il contesto pubblico e il ciphertext,
            esegue la rete e restituisce un ciphertext. Non può decifrare nulla.
"""

import math
import time
import uuid
from dataclasses import dataclass, field

import numpy as np
import torch  # importato prima di tenseal: evita il conflitto tra runtime OpenMP su Windows
import tenseal as ts

from modello import KERNEL, STRIDE, NASCOSTI, ReteCifrabile

# Parametri CKKS: polinomio di grado 16384 (8192 slot), 6 livelli intermedi
# da 40 bit (conv, x², fc1, x², fc2 = 5 moltiplicazioni) e scala 2^40.
# Il primo/ultimo primo da 60 bit lascia 20 bit per la parte intera: i
# punteggi finali (fino a ~50) stanno comodi. L'errore CKKS resta ~1e-3.
# Sicurezza 128 bit: 360 bit di modulo ≤ 438 consentiti per grado 16384.
GRADO_POLINOMIO = 16384
BIT_MODULO = [60, 40, 40, 40, 40, 40, 40, 60]
SCALA = 2**40


# ───────────────────────────── CLIENT ─────────────────────────────


class Client:
    def __init__(self):
        self.contesto = ts.context(
            ts.SCHEME_TYPE.CKKS,
            poly_modulus_degree=GRADO_POLINOMIO,
            coeff_mod_bit_sizes=BIT_MODULO,
        )
        self.contesto.global_scale = SCALA
        self.contesto.generate_galois_keys()  # servono al server per le rotazioni

    def contesto_pubblico(self) -> bytes:
        """Contesto SENZA chiave segreta: è tutto ciò che il server riceve."""
        return self.contesto.serialize(
            save_public_key=True,
            save_secret_key=False,
            save_galois_keys=True,
            save_relin_keys=True,
        )

    def cifra(self, immagine: np.ndarray) -> tuple[bytes, int]:
        """immagine: 28x28 float già normalizzata.

        Usa la codifica im2col: ogni finestra 7x7 della convoluzione diventa
        una colonna, così il server può calcolare la convoluzione con sole
        moltiplicazioni slot-per-slot e rotazioni.
        """
        cifrata, n_finestre = ts.im2col_encoding(
            self.contesto, immagine.tolist(), KERNEL, KERNEL, STRIDE
        )
        return cifrata.serialize(), n_finestre

    def decifra(self, risultato: bytes) -> np.ndarray:
        vettore = ts.ckks_vector_from(self.contesto, risultato)
        return np.array(vettore.decrypt())


# ───────────────────────────── SERVER ─────────────────────────────


@dataclass
class Passo:
    nome: str
    descrizione: str
    millisecondi: float
    byte: int
    livello: int  # primi rimasti nel modulo: ogni moltiplicazione ne consuma uno
    scala_bit: float  # log2 della scala CKKS
    polinomi: int  # numero di polinomi del ciphertext (2 dopo la rilinearizzazione)
    n_valori: int  # valori logici contenuti nel vettore cifrato
    rumore: list  # 4096 byte del ciphertext serializzato, ciò che il server "vede"
    ciphertext: bytes = field(repr=False)  # per la vista didattica del client


def metadati(vettore) -> dict:
    """Informazioni pubbliche su un ciphertext: le conosce anche il server."""
    ct = vettore.ciphertext()[0]
    return dict(
        livello=ct.coeff_modulus_size(),
        scala_bit=round(math.log2(ct.scale), 2),
        polinomi=ct.size(),
        n_valori=vettore.size(),
    )


@dataclass
class EsitoServer:
    risultato: bytes
    passi: list[Passo] = field(default_factory=list)


def rumore(dati: bytes, n: int = 4096) -> list:
    meta = len(dati) // 2  # dal centro: l'intestazione all'inizio è sempre uguale
    return list(dati[meta : meta + n])


class Server:
    def __init__(self, percorso_pesi):
        modello = ReteCifrabile()
        modello.load_state_dict(torch.load(percorso_pesi, map_location="cpu", weights_only=True))
        modello.eval()
        self.modello = modello
        # Pesi in chiaro, nel formato atteso da TenSEAL
        self.kernel = modello.conv1.weight.data.view(-1, KERNEL, KERNEL).tolist()
        self.bias_conv = modello.conv1.bias.data.tolist()
        # Il bias di fc1 viene inglobato nella matrice. Sommare un vettore in
        # chiaro all'uscita di mm() rompe la disposizione degli slot che il
        # mm() successivo si aspetta (errore ~0,5 sui punteggi). Il server
        # aggiunge quindi all'input un blocco di 64 slot costanti a 1
        # (1² = 1, sopravvive al quadrato) e 64 righe extra pari a b1/64.
        w1 = modello.fc1.weight.T.data
        b1 = modello.fc1.bias.data
        self.w1 = torch.cat([w1, (b1 / NASCOSTI).repeat(NASCOSTI, 1)]).tolist()
        self.w2 = modello.fc2.weight.T.data.tolist()
        self.b2 = modello.fc2.bias.data.tolist()
        self.contesti = {}  # id client -> contesto pubblico deserializzato

    def registra_client(self, contesto_pubblico: bytes) -> str:
        """Il contesto pubblico (centinaia di MB per via delle chiavi di
        Galois) si invia una volta sola; poi bastano i ciphertext."""
        contesto = ts.context_from(contesto_pubblico)
        assert not contesto.is_private(), "il server non deve mai avere la chiave segreta"
        id_client = uuid.uuid4().hex
        self.contesti[id_client] = contesto
        return id_client

    def inferenza_a_passi(self, id_client: str, ciphertext: bytes, n_finestre: int):
        """Generatore: produce un Passo appena ogni strato è finito, così chi lo
        usa può mostrare l'avanzamento reale. L'ultimo Passo (fc2) contiene il
        ciphertext dei punteggi finali."""
        contesto = self.contesti[id_client]
        t = time.perf_counter()

        def passo(nome, descrizione, vettore) -> Passo:
            ms = (time.perf_counter() - t) * 1000
            dati = vettore.serialize()
            return Passo(nome, descrizione, ms, len(dati), **metadati(vettore), rumore=rumore(dati), ciphertext=dati)

        x = ts.ckks_vector_from(contesto, ciphertext)
        yield passo("ricezione", "Deserializza il ciphertext ricevuto dal client", x)
        t = time.perf_counter()  # il tempo speso da chi consuma il generatore non conta

        canali = [x.conv2d_im2col(k, n_finestre) + b for k, b in zip(self.kernel, self.bias_conv)]
        uno = canali[0] * 0 + 1  # blocco costante per il bias di fc1 (vedi __init__)
        x = ts.CKKSVector.pack_vectors(canali + [uno])
        yield passo("conv", "Convoluzione 7x7, stride 3, 4 canali → 256 valori", x)
        t = time.perf_counter()

        x.square_()
        yield passo("x²", "Attivazione quadratica (al posto della ReLU)", x)
        t = time.perf_counter()

        x = x.mm(self.w1)
        yield passo("fc1", "Strato denso 256 → 64 (prodotto matrice-vettore)", x)
        t = time.perf_counter()

        x.square_()
        yield passo("x²", "Attivazione quadratica", x)
        t = time.perf_counter()

        x = x.mm(self.w2) + self.b2
        yield passo("fc2", "Strato denso 64 → 10: i punteggi delle 10 cifre", x)

    def inferenza(self, id_client: str, ciphertext: bytes, n_finestre: int) -> EsitoServer:
        esito = EsitoServer(risultato=b"")
        esito.passi = list(self.inferenza_a_passi(id_client, ciphertext, n_finestre))
        esito.risultato = esito.passi[-1].ciphertext
        return esito

    @torch.no_grad()
    def inferenza_in_chiaro(self, immagine: np.ndarray) -> np.ndarray:
        """Solo per verifica didattica: lo stesso modello senza cifratura."""
        x = torch.tensor(immagine, dtype=torch.float32).view(1, 1, 28, 28)
        return self.modello(x)[0].numpy()
