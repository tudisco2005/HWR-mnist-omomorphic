"""Confronta inferenza cifrata e in chiaro su un campione del test set.

Uso:  python valuta_cifrato.py [numero_immagini]
"""

import sys
import time
from pathlib import Path

import numpy as np
from tqdm import tqdm

from dati_mnist import carica, normalizza
from fhe import Client, Server

N = int(sys.argv[1]) if len(sys.argv) > 1 else 100


def main():
    immagini, etichette = carica("test")
    immagini = normalizza(immagini[:N])
    etichette = etichette[:N]

    client = Client()
    server = Server(Path(__file__).parent / "modello.pt")
    id_client = server.registra_client(client.contesto_pubblico())

    giuste_cifrate = giuste_chiaro = concordi = 0
    errore_max = 0.0
    inizio = time.perf_counter()
    barra = tqdm(zip(immagini, etichette), total=N, desc="Inferenza cifrata", unit="img")
    for i, (img, y) in enumerate(barra, 1):
        ct, n_finestre = client.cifra(img)
        punteggi = client.decifra(server.inferenza(id_client, ct, n_finestre).risultato)
        chiaro = server.inferenza_in_chiaro(img)

        giuste_cifrate += int(punteggi.argmax() == y)
        giuste_chiaro += int(chiaro.argmax() == y)
        concordi += int(punteggi.argmax() == chiaro.argmax())
        errore_max = max(errore_max, float(np.abs(punteggi - chiaro).max()))
        barra.set_postfix(acc_cifrata=f"{giuste_cifrate / i:.1%}", concordi=f"{concordi / i:.1%}")

    durata = time.perf_counter() - inizio
    print(f"\nImmagini:                 {N}")
    print(f"Accuratezza cifrata:      {giuste_cifrate / N:.2%}")
    print(f"Accuratezza in chiaro:    {giuste_chiaro / N:.2%}")
    print(f"Predizioni coincidenti:   {concordi / N:.2%}")
    print(f"Errore CKKS massimo:      {errore_max:.2e}")
    print(f"Tempo medio per immagine: {durata / N:.2f} s")


if __name__ == "__main__":
    main()
