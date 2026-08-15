#!/usr/bin/env bash
# scripts/transcode-media.sh
#
# Automatically and incrementally transcodes:
#   - Static raster images (.png, .jpg, .jpeg, .tif, .tiff) -> .jxl (JPEG XL) via cjxl
#   - Animated images (.gif) -> .webm video via ffmpeg
#
# Only files that are missing or newer than their transcoded counterparts are processed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGES_DIR="${PROJECT_ROOT}/assets/images"

if [ ! -d "${IMAGES_DIR}" ]; then
  echo "Images directory not found at: ${IMAGES_DIR}"
  exit 0
fi

echo "==> Checking for media assets in ${IMAGES_DIR}..."

# Check if cjxl is available
HAS_CJXL=false
if command -v cjxl >/dev/null 2>&1; then
  HAS_CJXL=true
else
  echo "WARNING: 'cjxl' not found on PATH. Static images will not be transcoded to JXL."
fi

# Check if ffmpeg is available
HAS_FFMPEG=false
if command -v ffmpeg >/dev/null 2>&1; then
  HAS_FFMPEG=true
else
  echo "WARNING: 'ffmpeg' not found on PATH. GIFs will not be transcoded to WebM."
fi

# 1. Transcode PNG / JPG / JPEG / TIFF to JXL
if [ "$HAS_CJXL" = true ]; then
  find "${IMAGES_DIR}" -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.tif" -o -iname "*.tiff" \) -print0 | while IFS= read -r -d '' src; do
    dir="$(dirname "$src")"
    filename="$(basename "$src")"
    base="${filename%.*}"
    dst="${dir}/${base}.jxl"

    # Only transcode if destination doesn't exist or source is newer
    if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ]; then
      echo "  [JXL] Transcoding ${filename} -> ${base}.jxl..."
      cjxl "$src" "$dst" -d 1.0 -e 7 --quiet
    fi
  done
fi

# 2. Transcode GIF to WebM
if [ "$HAS_FFMPEG" = true ]; then
  find "${IMAGES_DIR}" -type f -iname "*.gif" -print0 | while IFS= read -r -d '' src; do
    dir="$(dirname "$src")"
    filename="$(basename "$src")"
    base="${filename%.*}"
    dst="${dir}/${base}.webm"

    # Only transcode if destination doesn't exist or source is newer
    if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ]; then
      echo "  [WebM] Transcoding ${filename} -> ${base}.webm..."
      ffmpeg -y -i "$src" -c:v libvpx-vp9 -b:v 0 -crf 32 -pix_fmt yuv420p -an "$dst" -loglevel error
    fi
  done
fi

echo "==> Media transcoding complete."
