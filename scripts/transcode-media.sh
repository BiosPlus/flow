#!/usr/bin/env bash
# ==============================================================================
# scripts/transcode-media.sh
#
# Automated Incremental Media Transcoder
#
# Purpose:
#   Optimizes site media located in `assets/images/`:
#   1. Static raster images (.png, .jpg, .jpeg, .tif, .tiff) -> .jxl (JPEG XL)
#      via `cjxl` with visually lossless quality (-d 1.0, effort 7).
#   2. Animated GIF images (.gif) -> .webm video
#      via `ffmpeg` using VP9 codec for massive bandwidth savings.
#
# Incremental Execution:
#   Only files that do not have a corresponding transcoded file or where
#   the source file is newer than the target (`-nt`) are processed.
# ==============================================================================

# Exit immediately if a command exits with a non-zero status, treat unset variables as error, fail on pipeline error
set -euo pipefail

# Resolve paths dynamically relative to script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGES_DIR="${PROJECT_ROOT}/assets/images"

# Ensure image directory exists before proceeding
if [ ! -d "${IMAGES_DIR}" ]; then
  echo "Images directory not found at: ${IMAGES_DIR}"
  exit 0
fi

echo "==> Checking for media assets in ${IMAGES_DIR}..."

# Check toolchain availability: cjxl (JPEG XL encoder)
HAS_CJXL=false
if command -v cjxl >/dev/null 2>&1; then
  HAS_CJXL=true
else
  echo "WARNING: 'cjxl' not found on PATH. Static images will not be transcoded to JXL."
fi

# Check toolchain availability: ffmpeg (Video encoder)
HAS_FFMPEG=false
if command -v ffmpeg >/dev/null 2>&1; then
  HAS_FFMPEG=true
else
  echo "WARNING: 'ffmpeg' not found on PATH. GIFs will not be transcoded to WebM."
fi

# ------------------------------------------------------------------------------
# 1. Transcode PNG / JPG / JPEG / TIFF to JPEG XL (.jxl)
# ------------------------------------------------------------------------------
if [ "$HAS_CJXL" = true ]; then
  find "${IMAGES_DIR}" -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.tif" -o -iname "*.tiff" \) -print0 | while IFS= read -r -d '' src; do
    dir="$(dirname "$src")"
    filename="$(basename "$src")"
    base="${filename%.*}"
    dst="${dir}/${base}.jxl"

    # Incrementally transcode if target is missing or source was modified newer than target
    if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ]; then
      echo "  [JXL] Transcoding ${filename} -> ${base}.jxl..."
      # -d 1.0: Butteraugli distance 1.0 (visually lossless compression)
      # -e 7: Encoder effort 7 (high compression efficiency)
      # --quiet: Suppress progress statistics output
      cjxl "$src" "$dst" -d 1.0 -e 7 --quiet
    fi
  done
fi

# ------------------------------------------------------------------------------
# 2. Transcode Animated GIFs to Modern WebM Video (.webm)
# ------------------------------------------------------------------------------
if [ "$HAS_FFMPEG" = true ]; then
  find "${IMAGES_DIR}" -type f -iname "*.gif" -print0 | while IFS= read -r -d '' src; do
    dir="$(dirname "$src")"
    filename="$(basename "$src")"
    base="${filename%.*}"
    dst="${dir}/${base}.webm"

    # Incrementally transcode if target is missing or source was modified newer than target
    if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ]; then
      echo "  [WebM] Transcoding ${filename} -> ${base}.webm..."
      # -c:v libvpx-vp9: High-efficiency VP9 video codec
      # -b:v 0 -crf 32: Constant quality mode with CRF 32
      # -pix_fmt yuv420p: Wide hardware compatibility
      # -an: Strip any audio tracks
      ffmpeg -y -i "$src" -c:v libvpx-vp9 -b:v 0 -crf 32 -pix_fmt yuv420p -an "$dst" -loglevel error
    fi
  done
fi

echo "==> Media transcoding complete."

