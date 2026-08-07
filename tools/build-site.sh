#!/usr/bin/env bash
#
# Monta en _site/ lo que se publica en GitHub Pages.
#
# El repo trae el pack de sprites entero (42.500 ficheros): publicarlo tal cual
# hace que el despliegue de Pages se pase de los 10 minutos que aguanta la
# accion deploy-pages, y el sitio se queda sin actualizar. Aqui se copia solo lo
# que el juego pide de verdad (~3.500 ficheros), que es lo mismo pero en un
# minuto. Los sprites siguen todos en el repo, solo cambia lo que se sube.
#
# Uso: tools/build-site.sh [destino]   (por defecto _site)

set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-_site}"
S=sprites

rm -rf "$OUT"
mkdir -p "$OUT"

cp index.html manifest.webmanifest sw.js "$OUT/"
cp -r css js icons "$OUT/"

# carpeta entera (con lo que cuelgue de ella)
copy_dir() {
  mkdir -p "$OUT/$1"
  cp -r "$1/." "$OUT/$1/"
}

# solo los ficheros sueltos de la carpeta, sin subcarpetas: en los packs de
# sprites las subcarpetas son back/, shiny/, female/... que no se usan
copy_files() {
  mkdir -p "$OUT/$1"
  find "$1" -maxdepth 1 -type f -exec cp -t "$OUT/$1/" {} +
}

copy_dir "$S/fonts"
copy_dir "$S/chrome/chrome/time-of-day"
copy_dir "$S/items/items/berries"
copy_files "$S/items/items"
copy_files "$S/pokemon-icons/pokemon/icons"

# Los sprites del juego: las rejillas de fotogramas que genera
# tools/build-spritesheets.py a partir de los GIF de Emerald, y el PNG suelto
# de Emerald como respaldo por si alguna rejilla no carga.
copy_dir "$S/generated/emerald"
copy_files "$S/generation-3/pokemon/main-sprites/emerald"

# Del pack de Gen 4 solo se usa el huevo.
mkdir -p "$OUT/$S/generation-4/pokemon/main-sprites/heartgold-soulsilver"
cp "$S/generation-4/pokemon/main-sprites/heartgold-soulsilver/egg.png" \
   "$OUT/$S/generation-4/pokemon/main-sprites/heartgold-soulsilver/"

printf 'sitio: %s ficheros, %s\n' \
  "$(find "$OUT" -type f | wc -l)" \
  "$(du -sh --apparent-size "$OUT" | cut -f1)"
