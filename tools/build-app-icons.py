#!/usr/bin/env python3
"""Genera los iconos estáticos de la app instalada (icons/).

Estos son los de respaldo: los que ve Android antes de que el juego haya
arrancado, y los que quedan si el navegador no acepta el manifiesto dinámico.
El icono de verdad -el del Pokémon que estás criando ahora mismo- lo dibuja
js/pwa.js en un canvas con esta misma receta, para que ambos se vean igual.

Uso: python tools/build-app-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'
SOURCE = ROOT / 'sprites' / 'pokemon-icons' / 'pokemon' / 'icons' / 'egg.png'

# El azul del juego (--accent de css/base.css) degradado hacia el celeste de la
# barra de experiencia: el icono se reconoce en cualquier fondo de escritorio,
# que es justo lo que no consigue el gris claro de la pantalla.
TOP = (127, 208, 255)
BOTTOM = (42, 117, 187)

# Cuánto del lado ocupa el sprite. En los iconos "maskable" Android puede
# recortar hasta un 20% por cada borde, así que el dibujo se queda dentro del
# círculo seguro; en los normales puede respirar más.
FILL_ANY = 0.68
FILL_MASKABLE = 0.52


def gradient(size):
    img = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        draw.line(
            [(0, y), (size, y)],
            fill=tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)),
        )
    return img


def render(size, fill):
    canvas = gradient(size).convert('RGBA')
    sprite = Image.open(SOURCE).convert('RGBA')

    # Los iconos del pack son lienzos de 40x30 con el dibujo suelto dentro y
    # mucho transparente alrededor. Sin recortarlo, el bicho sale diminuto en
    # medio del icono.
    bbox = sprite.getbbox()
    if bbox:
        sprite = sprite.crop(bbox)

    # Escala entera y sin interpolar: es pixel art, y cualquier suavizado le
    # emborrona el contorno.
    scale = max(1, int(min(size * fill / sprite.width, size * fill / sprite.height)))
    big = sprite.resize((sprite.width * scale, sprite.height * scale), Image.NEAREST)

    canvas.alpha_composite(big, ((size - big.width) // 2, (size - big.height) // 2))
    return canvas.convert('RGB')


def main():
    OUT.mkdir(exist_ok=True)
    targets = [
        ('icon-192.png', 192, FILL_ANY),
        ('icon-512.png', 512, FILL_ANY),
        ('maskable-512.png', 512, FILL_MASKABLE),
    ]
    for name, size, fill in targets:
        path = OUT / name
        render(size, fill).save(path, optimize=True)
        print(f'{path.relative_to(ROOT)}: {size}x{size}, {path.stat().st_size} B')


if __name__ == '__main__':
    main()
