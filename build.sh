#!/usr/bin/env bash

# ==============================================================================
# build.sh - Multi-Platform Production Build Pipeline
#
# Supported Environments:
#   - Cloudflare Pages (v1 / v2 runners)
#   - Render.com CI/CD
#   - GitHub Actions
#   - Linux CI/CD Runners (Ubuntu / Debian x86_64)
#
# Pipeline Steps:
#   1. Detect build environment & export user toolchain paths.
#   2. Install Hugo Extended v0.165.0 with SHA-256 integrity verification.
#   3. Ensure Node.js & npx are available (required for Pagefind).
#   4. Ensure cjxl is available (JPEG XL image transcoding).
#   5. Ensure ffmpeg is available (GIF to WebM video transcoding).
#   6. Verify complete toolchain versions.
#   7. Transcode media assets (incremental JXL / WebM generation).
#   8. Compile and minify Hugo static site to `build/`.
#   9. Generate Pagefind static search index.
#
# NOTE: This script is intended for CI/CD runners. For local development,
# run `hugo server --disableFastRender`.
# ==============================================================================

# Abort immediately if any command fails (exit on error)
set -o errexit

# Save the initial repository working directory
ORIGINAL_DIR="$PWD"

# ------------------------------------------------------------------------------
# Step 0: Environment Detection & User Toolchain Path Setup
# ------------------------------------------------------------------------------
echo "==> Flow CI/CD Build Pipeline initialized"

CI_PLATFORM="Generic CI / Linux Runner"
if [ "${CF_PAGES:-}" = "1" ] || [ "${CLOUDFLARE_PAGES:-}" = "true" ] || [ -n "${CF_PAGES_COMMIT_SHA:-}" ] || [[ "${PWD}" == /opt/buildhome* ]] || [ -d "/opt/buildhome" ]; then
  CI_PLATFORM="Cloudflare Pages"
elif [ -n "${RENDER:-}" ] || [[ "${PWD}" == /opt/render* ]]; then
  CI_PLATFORM="Render.com"
elif [ -n "${GITHUB_ACTIONS:-}" ]; then
  CI_PLATFORM="GitHub Actions"
elif [ "${CI:-}" != "true" ] && [ "${CI:-}" != "1" ]; then
  CI_PLATFORM="Local / Custom"
fi
echo "==> Build environment detected: ${CI_PLATFORM}"

# Prepend user toolchain directories to PATH and set LD_LIBRARY_PATH
mkdir -p "${HOME}/bin" "${HOME}/.local/bin" "${HOME}/libjxl/usr/bin"
export PATH="${HOME}/bin:${HOME}/.local/bin:${HOME}/libjxl/usr/bin:${PATH}"
export LD_LIBRARY_PATH="${HOME}/libjxl/usr/lib/x86_64-linux-gnu:${HOME}/libjxl/usr/lib:${LD_LIBRARY_PATH:-}"

# ------------------------------------------------------------------------------
# Step 1: Install Hugo Extended v0.165.0 with Checksum Verification
# ------------------------------------------------------------------------------
if ! command -v hugo &> /dev/null || ! hugo version 2>/dev/null | grep -qi "extended"; then
  HUGO_VERSION="0.165.0"
  HUGO_CHECKSUM="f43494894cdf4a8630a201d5c828051c77f523cc66bb3938b30806835470ac20"
  echo "Installing Hugo Extended v${HUGO_VERSION}..."

  mkdir -p /tmp/hugo
  cd /tmp/hugo
  wget -q "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
  echo "${HUGO_CHECKSUM}  hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz" | sha256sum -c -
  tar -xzf "hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
  mv hugo "${HOME}/bin/"
fi

# ------------------------------------------------------------------------------
# Step 2: Ensure Node.js & npx are Available (Required for Pagefind)
# ------------------------------------------------------------------------------
if ! command -v npx &> /dev/null; then
  echo "Node.js / npx not found. Installing Node.js LTS..."
  NODE_VERSION="v20.18.0"
  NODE_CHECKSUM="4543670b589593f8fa5f106111fd5139081da42bb165a9239f05195e405f240a"
  mkdir -p "${HOME}/nodejs"
  mkdir -p /tmp/node
  cd /tmp/node
  wget -q "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
  echo "${NODE_CHECKSUM}  node-${NODE_VERSION}-linux-x64.tar.xz" | sha256sum -c -
  tar -xJf "node-${NODE_VERSION}-linux-x64.tar.xz" --strip-components=1 -C "${HOME}/nodejs"
  export PATH="${HOME}/nodejs/bin:${PATH}"
fi

# ------------------------------------------------------------------------------
# Step 3: Ensure cjxl is Available for JPEG XL Media Transcoding
# ------------------------------------------------------------------------------
if ! command -v cjxl &> /dev/null; then
  echo "cjxl not found. Installing libjxl tools..."
  JXL_VERSION="0.12.0"
  mkdir -p "${HOME}/libjxl"
  mkdir -p /tmp/jxl
  cd /tmp/jxl
  if command -v wget &> /dev/null; then
    wget -q "https://github.com/libjxl/libjxl/releases/download/v${JXL_VERSION}/jxl-debs-amd64-ubuntu-22.04.tar" -O jxl-debs.tar || true
  elif command -v curl &> /dev/null; then
    curl -sSL "https://github.com/libjxl/libjxl/releases/download/v${JXL_VERSION}/jxl-debs-amd64-ubuntu-22.04.tar" -o jxl-debs.tar || true
  fi

  if [ -f jxl-debs.tar ]; then
    tar -xf jxl-debs.tar
    for deb in *.deb; do
      if [ -f "$deb" ] && command -v dpkg &> /dev/null; then
        dpkg -x "$deb" "${HOME}/libjxl"
      fi
    done
  fi
fi

# ------------------------------------------------------------------------------
# Step 4: Ensure ffmpeg is Available for GIF to WebM Transcoding
# ------------------------------------------------------------------------------
if ! command -v ffmpeg &> /dev/null; then
  echo "ffmpeg not found. Installing ffmpeg static binary..."
  mkdir -p /tmp/ffmpeg
  cd /tmp/ffmpeg
  if command -v wget &> /dev/null; then
    wget -q "https://github.com/vot/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip" -O ffmpeg.zip 2>/dev/null || true
  elif command -v curl &> /dev/null; then
    curl -sSL "https://github.com/vot/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip" -o ffmpeg.zip 2>/dev/null || true
  fi

  if [ -f ffmpeg.zip ]; then
    if command -v unzip &> /dev/null; then
      unzip -q -o ffmpeg.zip -d "${HOME}/bin"
    elif command -v python3 &> /dev/null; then
      python3 -c "import zipfile; zipfile.ZipFile('ffmpeg.zip').extractall('${HOME}/bin')" 2>/dev/null || true
    fi
  fi

  # Fallback to John Van Sickle static tarball if ffmpeg is still not extracted
  if [ ! -f "${HOME}/bin/ffmpeg" ]; then
    if command -v wget &> /dev/null; then
      wget -q "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -O ffmpeg.tar.xz 2>/dev/null || true
    elif command -v curl &> /dev/null; then
      curl -sSL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -o ffmpeg.tar.xz 2>/dev/null || true
    fi
    if [ -f ffmpeg.tar.xz ]; then
      tar -xJf ffmpeg.tar.xz --wildcards '*/ffmpeg' --strip-components=1 -C "${HOME}/bin" 2>/dev/null || true
    fi
  fi

  if [ -f "${HOME}/bin/ffmpeg" ]; then
    chmod +x "${HOME}/bin/ffmpeg" || true
  fi
fi

# ------------------------------------------------------------------------------
# Step 5: Verify Toolchain Versions
# ------------------------------------------------------------------------------
cd "$ORIGINAL_DIR"
echo "==> Verifying toolchain components:"
hugo version
node -v
npx -v
if command -v cjxl &> /dev/null; then
  cjxl --version 2>&1 || true
else
  echo "WARNING: cjxl not found on PATH."
fi
if command -v ffmpeg &> /dev/null; then
  ffmpeg -version 2>&1 | head -n 1 || true
else
  echo "WARNING: ffmpeg not found on PATH."
fi

# ------------------------------------------------------------------------------
# Step 6: Media Asset Transcoding (Incremental JXL & WebM generation)
# ------------------------------------------------------------------------------
if [ -f "./scripts/transcode-media.sh" ]; then
  echo "Invoking media transcoding pipeline..."
  bash ./scripts/transcode-media.sh
fi

# ------------------------------------------------------------------------------
# Step 7: Build Static Site with Hugo Extended
# ------------------------------------------------------------------------------
# Ensure theme directory symlink exists for CI environments (e.g. Cloudflare / Render)
mkdir -p "${ORIGINAL_DIR}/themes"
ln -sfn "${ORIGINAL_DIR}" "${ORIGINAL_DIR}/themes/flow"

# --gc: run garbage collection on unused cached assets
# --minify: minify HTML, CSS, JS, and SVG output
hugo --source exampleSite --themesDir ../themes --theme flow --gc --minify

# ------------------------------------------------------------------------------
# Step 8: Generate Pagefind Search Index
# ------------------------------------------------------------------------------
# Indexes HTML articles in the `build/` directory for client-side search.js
npx -y pagefind --site build

