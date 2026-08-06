#!/usr/bin/env python3
"""Convierte los GIF animados de Emerald en spritesheets.

Un GIF lo anima el navegador y no se puede parar: por eso el Pokemon seguia
moviendose mientras dormia. Volcando sus frames a una rejilla PNG la animacion
la lleva el juego, que puede pausarla, congelarla o cambiarle la velocidad.

Se usa rejilla y no una tira porque hay animaciones de hasta 85 frames y 85
frames de 96px seguidos son 8160px de ancho: algunos moviles no admiten
texturas de mas de 4096.

Salida:
  sprites/generated/emerald/<id>.png      la rejilla
  sprites/generated/emerald/manifest.json  frames, columnas y duraciones

Uso: tools/build-spritesheets.py
"""

import json
import os
import re
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'sprites/generation-3/pokemon/main-sprites/emerald/animated')
OUT = os.path.join(ROOT, 'sprites/generated/emerald')
COLS = 8

# Unown solo esta como formas (201-a, 201-b...), asi que para el 201 se usa la
# primera. El resto son ficheros con el numero de la Pokedex a secas.
ALIASES = {201: '201-a.gif'}


def frames_of(path):
    """Frames ya compuestos (los GIF pueden traer frames parciales) y su duracion."""
    im = Image.open(path)
    out = []
    for i in range(getattr(im, 'n_frames', 1)):
        im.seek(i)
        out.append((im.convert('RGBA'), max(20, int(im.info.get('duration') or 100))))
    return out


def build(species_id, path):
    frames = frames_of(path)
    w, h = frames[0][0].size
    n = len(frames)
    cols = min(COLS, n)
    rows = (n + cols - 1) // cols

    sheet = Image.new('RGBA', (cols * w, rows * h), (0, 0, 0, 0))
    for i, (frame, _) in enumerate(frames):
        # algun gif suelto trae un frame de otro tamano; se encaja arriba a la izquierda
        sheet.paste(frame.crop((0, 0, w, h)), ((i % cols) * w, (i // cols) * h))

    sheet.save(os.path.join(OUT, f'{species_id}.png'), optimize=True)
    return {'n': n, 'c': cols, 'w': w, 'h': h, 'd': [d for _, d in frames]}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}

    for name in sorted(os.listdir(SRC)):
        m = re.fullmatch(r'(\d+)\.gif', name)
        if not m:
            continue
        species_id = int(m.group(1))
        manifest[species_id] = build(species_id, os.path.join(SRC, name))

    for species_id, name in ALIASES.items():
        if species_id in manifest:
            continue
        path = os.path.join(SRC, name)
        if os.path.exists(path):
            manifest[species_id] = build(species_id, path)

    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump({str(k): manifest[k] for k in sorted(manifest)}, f, separators=(',', ':'))

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    frames = sum(v['n'] for v in manifest.values())
    print(f'{len(manifest)} spritesheets, {frames} frames, {total / 1048576:.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
