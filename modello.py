"""Rete neurale compatibile con la crittografia omomorfica.

CKKS sa fare solo somme e moltiplicazioni, quindi:
  - niente ReLU, niente max-pooling: l'attivazione è x² (un polinomio);
  - la rete è poco profonda, perché ogni moltiplicazione consuma un livello
    del modulo del ciphertext.

Architettura:  conv(1→4, 7x7, stride 3) → x² → fc(256→64) → x² → fc(64→10)
"""

import torch
from torch import nn

KERNEL = 7
STRIDE = 3
CANALI = 4
LATO_USCITA_CONV = (28 - KERNEL) // STRIDE + 1  # 8
NASCOSTI = 64


class ReteCifrabile(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, CANALI, kernel_size=KERNEL, stride=STRIDE)
        self.fc1 = nn.Linear(CANALI * LATO_USCITA_CONV**2, NASCOSTI)
        self.fc2 = nn.Linear(NASCOSTI, 10)

    def forward(self, x):
        x = self.conv1(x)
        x = x * x
        x = x.view(x.shape[0], -1)
        x = self.fc1(x)
        x = x * x
        return self.fc2(x)
