"""Training IN CHIARO della rete con PyTorch. Salva i pesi in modello.pt."""

from pathlib import Path

import numpy as np
import torch
from torch import nn

from dati_mnist import carica, normalizza
from modello import ReteCifrabile

PESI = Path(__file__).parent / "modello.pt"
EPOCHE = 10
BATCH = 64


def tensori(parte):
    img, lbl = carica(parte)
    x = torch.from_numpy(normalizza(img)).unsqueeze(1)  # N x 1 x 28 x 28
    y = torch.from_numpy(lbl.astype(np.int64))
    return x, y


@torch.no_grad()
def accuratezza(modello, x, y):
    modello.eval()
    pred = torch.cat([modello(x[i : i + 1000]).argmax(1) for i in range(0, len(x), 1000)])
    return (pred == y).float().mean().item()


def main():
    torch.manual_seed(73)
    x_train, y_train = tensori("train")
    x_test, y_test = tensori("test")

    modello = ReteCifrabile()
    ottimizzatore = torch.optim.Adam(modello.parameters(), lr=1e-3)
    perdita = nn.CrossEntropyLoss()

    for epoca in range(1, EPOCHE + 1):
        modello.train()
        ordine = torch.randperm(len(x_train))
        totale = 0.0
        for i in range(0, len(ordine), BATCH):
            idx = ordine[i : i + BATCH]
            ottimizzatore.zero_grad()
            loss = perdita(modello(x_train[idx]), y_train[idx])
            loss.backward()
            ottimizzatore.step()
            totale += loss.item() * len(idx)
        acc = accuratezza(modello, x_test, y_test)
        print(f"epoca {epoca:2d}  loss {totale / len(x_train):.4f}  accuratezza test {acc:.2%}")

    torch.save(modello.state_dict(), PESI)
    print(f"Pesi salvati in {PESI}")


if __name__ == "__main__":
    main()
