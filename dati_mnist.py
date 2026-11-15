"""Scarica e legge il dataset MNIST (formato IDX) senza dipendere da torchvision."""

import gzip
import struct
import urllib.request
from pathlib import Path

import numpy as np

CARTELLA = Path(__file__).parent / "dati"
MIRROR = [
    "https://ossci-datasets.s3.amazonaws.com/mnist/",
    "https://storage.googleapis.com/cvdf-datasets/mnist/",
]
FILE = {
    "train_img": "train-images-idx3-ubyte.gz",
    "train_lbl": "train-labels-idx1-ubyte.gz",
    "test_img": "t10k-images-idx3-ubyte.gz",
    "test_lbl": "t10k-labels-idx1-ubyte.gz",
}

# Media e deviazione standard dei pixel MNIST (valori in [0, 1]).
MEDIA = 0.1307
DEV_STD = 0.3081


def _scarica(nome: str) -> Path:
    CARTELLA.mkdir(exist_ok=True)
    destinazione = CARTELLA / nome
    if destinazione.exists():
        return destinazione
    for base in MIRROR:
        try:
            print(f"Scarico {base + nome} ...")
            urllib.request.urlretrieve(base + nome, destinazione)
            return destinazione
        except Exception as errore:  # prova il mirror successivo
            print(f"  fallito: {errore}")
            destinazione.unlink(missing_ok=True)
    raise RuntimeError(f"Impossibile scaricare {nome}")


def _leggi_immagini(percorso: Path) -> np.ndarray:
    with gzip.open(percorso, "rb") as f:
        magic, n, righe, colonne = struct.unpack(">IIII", f.read(16))
        assert magic == 2051, "file immagini MNIST non valido"
        return np.frombuffer(f.read(), dtype=np.uint8).reshape(n, righe, colonne)


def _leggi_etichette(percorso: Path) -> np.ndarray:
    with gzip.open(percorso, "rb") as f:
        magic, n = struct.unpack(">II", f.read(8))
        assert magic == 2049, "file etichette MNIST non valido"
        return np.frombuffer(f.read(), dtype=np.uint8)


def carica(parte: str = "train"):
    """Restituisce (immagini uint8 Nx28x28, etichette uint8 N)."""
    img = _leggi_immagini(_scarica(FILE[f"{parte}_img"]))
    lbl = _leggi_etichette(_scarica(FILE[f"{parte}_lbl"]))
    return img, lbl


def normalizza(immagini_uint8: np.ndarray) -> np.ndarray:
    """uint8 [0, 255] -> float32 normalizzato come in fase di training."""
    return ((immagini_uint8.astype(np.float32) / 255.0) - MEDIA) / DEV_STD
