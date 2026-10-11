#!/usr/bin/env python3
"""Turn two generated surface photographs into game-usable tiling maps.

    /usr/bin/python3 -I mktex.py <tex-in dir> <tex-out dir>

A diffusion model gives you a PHOTOGRAPH: it has the lighting baked in, it has
a brightness gradient across the frame, and its edges do not meet. None of that
is usable as a texture. Three things have to happen first.

1. HIGH PASS. Subtracting a heavily blurred copy throws away everything
   low-frequency -- which is exactly the baked lighting and the gradient -- and
   keeps only the surface detail. What is left is centred on zero and can be
   applied as a modulation on top of whatever colour the game already paints,
   instead of replacing it.

2. SEAMLESS. Blend the image against a half-width/half-height rolled copy of
   itself, weighted by a raised cosine that falls to zero exactly at the seam.
   At x=0 and x=w the output equals the same sample from the middle of the
   original, so the edges match by construction rather than by eye. Costs some
   ghosting in the blend band, which is invisible in a detail map.

3. NORMALS from the height, by Sobel, computed AFTER the tiling step so the
   normals tile too. This is the one that actually buys realism: the deferred
   pass already consumes a normal buffer, so real surface relief means the
   moon and the street lamps rake across the stone instead of lighting a flat
   plane.
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]


def load_gray(name):
    im = Image.open(os.path.join(SRC, name)).convert('L')
    return np.asarray(im, dtype=np.float64) / 255.0


def highpass(a, sigma):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    lo = np.asarray(im.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float64) / 255.0
    return a - lo


def seamless(a):
    """Cross-fade against a half-rolled copy; edges match by construction."""
    h, w = a.shape
    x = np.arange(w)[None, :]
    y = np.arange(h)[:, None]
    # 0 at the seam, 1 at the centre
    wx = 0.5 - 0.5 * np.cos(2 * np.pi * x / w)
    wy = 0.5 - 0.5 * np.cos(2 * np.pi * y / h)
    a = a * wx + np.roll(a, w // 2, axis=1) * (1 - wx)
    a = a * wy + np.roll(a, h // 2, axis=0) * (1 - wy)
    return a


def resize(a, n):
    im = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    return np.asarray(im.resize((n, n), Image.LANCZOS), dtype=np.float64) / 255.0


def norm_contrast(d, target):
    """Rescale a zero-centred field so its standard deviation is `target`."""
    s = d.std()
    return d * (target / s) if s > 1e-6 else d


def check_seam(a, label):
    """Assert the tiling actually worked instead of trusting the maths."""
    h, w = a.shape
    dx = np.abs(a[:, 0] - a[:, -1]).mean()
    dy = np.abs(a[0, :] - a[-1, :]).mean()
    inx = np.abs(a[:, w // 2] - a[:, w // 2 - 1]).mean()
    iny = np.abs(a[h // 2, :] - a[h // 2 - 1, :]).mean()
    print('  %-8s costura x=%.4f y=%.4f   (interior x=%.4f y=%.4f)'
          % (label, dx, dy, inx, iny))
    return dx, dy, inx, iny


N = 256

# ---- detail / height, from the concrete -----------------------------------
c = load_gray('concreto.webp')
d = highpass(c, 26)                 # drop the lit gradient, keep the aggregate
d = seamless(d)
d = resize(d + 0.5, N) - 0.5        # back to zero-centred after the resample
height = norm_contrast(d, 0.085)
detail = norm_contrast(d, 0.095)

check_seam(height + 0.5, 'altura')

Image.fromarray(np.clip(detail * 255 + 128, 0, 255).astype(np.uint8), 'L') \
     .save(os.path.join(OUT, 'detalle.png'), optimize=True)

# ---- normals from that height ---------------------------------------------
# np.roll wraps, so the gradients are computed across the tile boundary too
STRENGTH = 1.1
gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
nx, ny, nz = -gx * STRENGTH * N / 32.0, -gy * STRENGTH * N / 32.0, np.ones_like(gx)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nrm = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
Image.fromarray(np.clip(nrm * 127.5 + 127.5, 0, 255).astype(np.uint8), 'RGB') \
     .save(os.path.join(OUT, 'normal.png'), optimize=True)
print('  normal   nz medio=%.3f  (1.0 = plano)' % nrm[:, :, 2].mean())

# ---- grime, from the dirty stone ------------------------------------------
# A much gentler high pass: the vertical runoff streaks ARE the point here, and
# they are exactly the low-frequency structure the aggressive pass throws away.
g = load_gray('mugre.webp')
g = highpass(g, 90)
g = seamless(g)
g = resize(g + 0.5, N) - 0.5
g = norm_contrast(g, 0.150)
check_seam(g + 0.5, 'mugre')
Image.fromarray(np.clip(g * 255 + 128, 0, 255).astype(np.uint8), 'L') \
     .save(os.path.join(OUT, 'mugre.png'), optimize=True)

for f in sorted(os.listdir(OUT)):
    print('  %-12s %6.1f KB' % (f, os.path.getsize(os.path.join(OUT, f)) / 1024))
