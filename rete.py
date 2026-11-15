"""Registro dei pacchetti scambiati tra client e server, con un rilevatore che
cerca l'immagine in ogni corpo trasmesso.

Il rilevatore cerca l'immagine in tutte le forme in cui potrebbe "scappare":
  - un file PNG (firma binaria) o un PNG in base64 (data URL del canvas);
  - l'immagine 28x28 in byte (uint8), intera o riga per riga;
  - le righe dell'immagine normalizzata come float32 o float64 (little endian),
    cioè i valori esatti che il client cifra.
Lo stesso rilevatore, applicato al passaggio locale browser → client che contiene
davvero il disegno, deve trovarlo: è il controllo che il rilevatore funziona.
"""

import hashlib
import itertools
import time

import numpy as np

CONSERVA_MAX = 16_000_000  # oltre questa dimensione si conserva solo l'inizio del corpo
GIRI_CONSERVATI = 3


def entropia(dati: bytes) -> float:
    """Entropia di Shannon in bit per byte: 8 = indistinguibile da byte casuali."""
    if not dati:
        return 0.0
    conteggi = np.bincount(np.frombuffer(dati, dtype=np.uint8), minlength=256)
    p = conteggi[conteggi > 0] / len(dati)
    return float(-(p * np.log2(p)).sum())


def cerca_immagine(corpo: bytes, img_uint8: np.ndarray, img_norm: np.ndarray) -> list[dict]:
    righe = [r for r in range(28) if np.count_nonzero(img_uint8[r]) >= 4]  # righe con tratti della cifra

    def righe_trovate(converti) -> int:
        return sum(1 for r in righe if converti(r) in corpo)

    controlli = [
        ("File PNG", "firma 89 50 4E 47 0D 0A 1A 0A", b"\x89PNG\r\n\x1a\n" in corpo),
        ("PNG in base64 (data URL)", "testo iVBORw0KGgo", b"iVBORw0KGgo" in corpo),
        ("Immagine 28×28 intera (uint8)", "784 byte consecutivi", img_uint8.tobytes() in corpo),
    ]
    for nome, descr, conv in [
        ("Righe di pixel (uint8)", "28 byte per riga", lambda r: img_uint8[r].tobytes()),
        ("Righe normalizzate (float32)", "112 byte per riga", lambda r: img_norm[r].astype("<f4").tobytes()),
        ("Righe normalizzate (float64)", "224 byte per riga", lambda r: img_norm[r].astype("<f8").tobytes()),
    ]:
        n = righe_trovate(conv)
        controlli.append((nome, f"{descr}; {n} righe su {len(righe)} trovate", n > 0))
    return [dict(nome=n, dettaglio=d, trovato=bool(t)) for n, d, t in controlli]


class Registro:
    def __init__(self):
        self.pacchetti: list[dict] = []
        self.corpi: dict[int, bytes] = {}
        self._id = itertools.count(1)
        self.giro = 0  # 0 = avvio della sessione, poi uno per ogni cifra riconosciuta

    def aggiungi(self, *, corpo: bytes, direzione: str, prima_riga: str, intestazioni: dict,
                 descrizione: str, zona: str = "rete", nota: str | None = None) -> dict:
        pid = next(self._id)
        conservato = corpo[:CONSERVA_MAX] if len(corpo) > CONSERVA_MAX else corpo
        self.corpi[pid] = conservato
        p = dict(
            id=pid,
            giro=self.giro,
            ora=time.strftime("%H:%M:%S") + f".{int(time.time() * 1000) % 1000:03d}",
            zona=zona,
            direzione=direzione,
            prima_riga=prima_riga,
            intestazioni=intestazioni,
            descrizione=descrizione,
            byte=len(corpo),
            conservati=len(conservato),
            sha256=hashlib.sha256(corpo).hexdigest(),
            entropia=round(entropia(corpo), 3),
            conferma=None,  # True se il server conferma lo SHA-256 dei byte ricevuti
            controlli=None,
            nota=nota,
        )
        self.pacchetti.append(p)
        self._sfoltisci()
        return p

    def analizza_giro(self, img_uint8: np.ndarray, img_norm: np.ndarray):
        for p in self.pacchetti:
            if p["giro"] == self.giro and p["id"] in self.corpi:
                p["controlli"] = cerca_immagine(self.corpi[p["id"]], img_uint8, img_norm)

    def _sfoltisci(self):
        giri = sorted({p["giro"] for p in self.pacchetti if p["giro"] > 0})
        vecchi = set(giri[:-GIRI_CONSERVATI])
        for p in [p for p in self.pacchetti if p["giro"] in vecchi]:
            self.corpi.pop(p["id"], None)
        self.pacchetti = [p for p in self.pacchetti if p["giro"] not in vecchi]
