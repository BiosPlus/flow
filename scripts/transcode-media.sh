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

# Resolve images directory: check working directory (if invoked from site root) or project root
if [ -d "${PWD}/assets/images" ]; then
  IMAGES_DIR="${PWD}/assets/images"
elif [ -d "${PROJECT_ROOT}/assets/images" ]; then
  IMAGES_DIR="${PROJECT_ROOT}/assets/images"
else
  IMAGES_DIR="${PROJECT_ROOT}/assets/images"
fi

# Ensure image directory exists before proceeding
if [ ! -d "${IMAGES_DIR}" ]; then
  echo "Images directory not found at: ${IMAGES_DIR}"
  exit 0
fi

# Prepend user toolchain paths if available
if [ -d "${HOME}/bin" ]; then
  export PATH="${HOME}/bin:${PATH}"
fi
if [ -d "${HOME}/.local/bin" ]; then
  export PATH="${HOME}/.local/bin:${PATH}"
fi
if [ -d "${HOME}/libjxl/usr/bin" ]; then
  export PATH="${HOME}/libjxl/usr/bin:${PATH}"
  export LD_LIBRARY_PATH="${HOME}/libjxl/usr/lib/x86_64-linux-gnu:${HOME}/libjxl/usr/lib:${LD_LIBRARY_PATH:-}"
fi

# ------------------------------------------------------------------------------
# Environment Detection Helpers (Cloudflare Pages, Render, CI)
# ------------------------------------------------------------------------------
is_cloudflare() {
  [ -n "${CF_PAGES:-}" ] || \
  [ -n "${CLOUDFLARE_PAGES:-}" ] || \
  [ -n "${CF_PAGES_COMMIT_SHA:-}" ] || \
  [ -n "${CF_PAGES_BRANCH:-}" ] || \
  [ -n "${CF_PAGES_URL:-}" ] || \
  [[ "${PWD}" == /opt/buildhome* ]] || \
  [[ "${HOME:-}" == /opt/buildhome* ]] || \
  [ -d "/opt/buildhome" ]
}

is_ci() {
  is_cloudflare || \
  [ "${CI:-}" = "true" ] || \
  [ "${CI:-}" = "1" ] || \
  [ -n "${RENDER:-}" ] || \
  [ -n "${GITHUB_ACTIONS:-}" ] || \
  [ "${AUTO_INSTALL_DEPS:-0}" = "1" ]
}

# ------------------------------------------------------------------------------
# Toolchain Auto-Installers for CI / Non-Root Environments
# ------------------------------------------------------------------------------
install_cjxl() {
  local runner="CI runner"
  if is_cloudflare; then runner="Cloudflare Pages runner"; fi
  echo "==> ${runner} detected. Auto-provisioning cjxl (libjxl)..."
  JXL_VERSION="0.12.0"
  mkdir -p "${HOME}/libjxl"
  mkdir -p /tmp/jxl
  local dl_dir="/tmp/jxl"
  
  if command -v wget >/dev/null 2>&1; then
    wget -q "https://github.com/libjxl/libjxl/releases/download/v${JXL_VERSION}/jxl-debs-amd64-ubuntu-22.04.tar" -O "${dl_dir}/jxl-debs.tar" || true
  elif command -v curl >/dev/null 2>&1; then
    curl -sSL "https://github.com/libjxl/libjxl/releases/download/v${JXL_VERSION}/jxl-debs-amd64-ubuntu-22.04.tar" -o "${dl_dir}/jxl-debs.tar" || true
  fi

  if [ -f "${dl_dir}/jxl-debs.tar" ]; then
    tar -xf "${dl_dir}/jxl-debs.tar" -C "${dl_dir}"
    for deb in "${dl_dir}"/*.deb; do
      if [ -f "$deb" ] && command -v dpkg >/dev/null 2>&1; then
        dpkg -x "$deb" "${HOME}/libjxl"
      fi
    done
    export PATH="${HOME}/libjxl/usr/bin:${PATH}"
    export LD_LIBRARY_PATH="${HOME}/libjxl/usr/lib/x86_64-linux-gnu:${HOME}/libjxl/usr/lib:${LD_LIBRARY_PATH:-}"
  fi
}

install_ffmpeg() {
  local runner="CI runner"
  if is_cloudflare; then runner="Cloudflare Pages runner"; fi
  echo "==> ${runner} detected. Auto-provisioning ffmpeg static binary..."
  mkdir -p "${HOME}/bin"
  mkdir -p /tmp/ffmpeg
  local dl_dir="/tmp/ffmpeg"

  if command -v wget >/dev/null 2>&1; then
    wget -q "https://github.com/vot/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip" -O "${dl_dir}/ffmpeg.zip" 2>/dev/null || true
  elif command -v curl >/dev/null 2>&1; then
    curl -sSL "https://github.com/vot/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip" -o "${dl_dir}/ffmpeg.zip" 2>/dev/null || true
  fi

  if [ -f "${dl_dir}/ffmpeg.zip" ]; then
    if command -v unzip >/dev/null 2>&1; then
      unzip -q -o "${dl_dir}/ffmpeg.zip" -d "${HOME}/bin"
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c "import zipfile; zipfile.ZipFile('${dl_dir}/ffmpeg.zip').extractall('${HOME}/bin')" 2>/dev/null || true
    fi
  fi

  # Fallback to John Van Sickle static tarball if ffmpeg is still not extracted
  if [ ! -f "${HOME}/bin/ffmpeg" ]; then
    if command -v wget >/dev/null 2>&1; then
      wget -q "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -O "${dl_dir}/ffmpeg.tar.xz" 2>/dev/null || true
    elif command -v curl >/dev/null 2>&1; then
      curl -sSL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -o "${dl_dir}/ffmpeg.tar.xz" 2>/dev/null || true
    fi
    if [ -f "${dl_dir}/ffmpeg.tar.xz" ]; then
      tar -xJf "${dl_dir}/ffmpeg.tar.xz" --wildcards '*/ffmpeg' --strip-components=1 -C "${HOME}/bin" 2>/dev/null || true
    fi
  fi

  if [ -f "${HOME}/bin/ffmpeg" ]; then
    chmod +x "${HOME}/bin/ffmpeg" || true
    export PATH="${HOME}/bin:${PATH}"
  fi
}

echo "==> Checking for media assets in ${IMAGES_DIR}..."

# Check toolchain availability: cjxl (JPEG XL encoder)
HAS_CJXL=false
if command -v cjxl >/dev/null 2>&1; then
  HAS_CJXL=true
elif is_ci; then
  install_cjxl
  if command -v cjxl >/dev/null 2>&1; then
    HAS_CJXL=true
  fi
fi

if [ "$HAS_CJXL" = false ]; then
  echo "WARNING: 'cjxl' not found on PATH. Static images will not be transcoded to JXL."
  echo "  (Install via 'sudo apt install libjxl-tools' or set AUTO_INSTALL_DEPS=1)"
fi

# Check toolchain availability: ffmpeg (Video encoder)
HAS_FFMPEG=false
if command -v ffmpeg >/dev/null 2>&1; then
  HAS_FFMPEG=true
elif is_ci; then
  install_ffmpeg
  if command -v ffmpeg >/dev/null 2>&1; then
    HAS_FFMPEG=true
  fi
fi

if [ "$HAS_FFMPEG" = false ]; then
  echo "WARNING: 'ffmpeg' not found on PATH. GIFs will not be transcoded to WebM."
  echo "  (Install via 'sudo apt install ffmpeg' or set AUTO_INSTALL_DEPS=1)"
fi

# ------------------------------------------------------------------------------
# 1. Transcode PNG / JPG / JPEG / TIFF / WebP to JPEG XL (.jxl)
# ------------------------------------------------------------------------------
if [ "$HAS_CJXL" = true ]; then
  find "${IMAGES_DIR}" -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.webp" \) -print0 | while IFS= read -r -d '' src; do
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
      TRANSCODE_SUCCESS=false
      if cjxl "$src" "$dst" -d 1.0 -e 7 --quiet 2>/dev/null; then
        if [ -s "$dst" ]; then
          TRANSCODE_SUCCESS=true
        fi
      fi

      # If cjxl failed (e.g. format mismatch like WebP/JPEG disguised as .png), try normalizing through ffmpeg
      if [ "$TRANSCODE_SUCCESS" = false ] && [ "$HAS_FFMPEG" = true ]; then
        rm -f "$dst"
        tmp_png="$(mktemp /tmp/flow_transcode_XXXXXX.png 2>/dev/null || echo "/tmp/norm_${base}_$$.png")"
        if ffmpeg -y -v error -i "$src" "$tmp_png" 2>/dev/null; then
          if cjxl "$tmp_png" "$dst" -d 1.0 -e 7 --quiet 2>/dev/null; then
            if [ -s "$dst" ]; then
              TRANSCODE_SUCCESS=true
            fi
          fi
          rm -f "$tmp_png"
        fi
      fi

      if [ "$TRANSCODE_SUCCESS" = false ]; then
        echo "  [JXL] WARNING: Transcoding failed for '${filename}'. Skipping (original format preserved)."
        rm -f "$dst"
      fi
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
      if ! ffmpeg -y -i "$src" -c:v libvpx-vp9 -b:v 0 -crf 32 -pix_fmt yuv420p -an "$dst" -loglevel error 2>/dev/null; then
        echo "  [WebM] WARNING: Transcoding failed for '${filename}'. Skipping (original GIF preserved)."
        rm -f "$dst"
      fi
    fi
  done
fi

echo "==> Media transcoding complete."

