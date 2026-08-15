#!/usr/bin/env bash

# ==============================================================================
# build.sh - Render.com CI/CD Production Build Pipeline
#
# This script prepares the production build environment on Render.com:
#   1. Downloads and installs Hugo Extended v0.165.0 with SHA-256 integrity check.
#   2. Installs Node.js LTS (if not present) for running Pagefind search indexing.
#   3. Optionally executes media asset transcoding (JXL/WebM).
#   4. Compiles and minifies the Hugo static site to the `build/` directory.
#   5. Runs Pagefind to generate static search indexes for client-side search.
#
# NOTE: This script is reserved for Render.com CI/CD. Do not run locally.
# ==============================================================================

# Abort immediately if any command fails (exit on error)
set -o errexit

# Save the initial repository working directory
ORIGINAL_DIR="$PWD"

# ------------------------------------------------------------------------------
# Step 1: Install Hugo Extended v0.165.0 with Checksum Verification
# ------------------------------------------------------------------------------
HUGO_VERSION="0.165.0"
HUGO_CHECKSUM="f43494894cdf4a8630a201d5c828051c77f523cc66bb3938b30806835470ac20"
echo "Installing Hugo Extended ${HUGO_VERSION}..."

# Create installation and temporary download directories
mkdir -p "${HOME}/bin"
mkdir -p /tmp/hugo
cd /tmp/hugo

# Download Hugo Extended tarball and verify SHA-256 checksum
wget -q https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz
echo "${HUGO_CHECKSUM}  hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz" | sha256sum -c -
tar -xzf hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz

# Move binary to user bin directory and prepend to PATH
mv hugo "${HOME}/bin/"
export PATH="${HOME}/bin:${PATH}"

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
# Step 3: Verify Toolchain Versions
# ------------------------------------------------------------------------------
hugo version
node -v
npx -v

# Return back to repository root directory
cd "$ORIGINAL_DIR"

# ------------------------------------------------------------------------------
# Step 4: Media Asset Transcoding (Incremental JXL & WebM generation)
# ------------------------------------------------------------------------------
if [ -f "./scripts/transcode-media.sh" ]; then
  echo "Invoking media transcoding at build time..."
  bash ./scripts/transcode-media.sh
fi

# ------------------------------------------------------------------------------
# Step 5: Build Static Site with Hugo
# ------------------------------------------------------------------------------
# --gc: run garbage collection on unused cached assets
# --minify: minify HTML, CSS, JS, and SVG output
hugo --gc --minify

# ------------------------------------------------------------------------------
# Step 6: Generate Pagefind Search Index
# ------------------------------------------------------------------------------
# Indexes HTML articles in the `build/` directory for client-side search.js
npx -y pagefind --site build

