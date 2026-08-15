#!/usr/bin/env bash

# This script is used by Render to build the app for production deployment.

# set up an exit on error
set -o errexit

# Save the initial directory
ORIGINAL_DIR="$PWD"

# Install specific version of Hugo
HUGO_VERSION="0.165.0"  # Change this to your required version
HUGO_CHECKSUM="f43494894cdf4a8630a201d5c828051c77f523cc66bb3938b30806835470ac20"
echo "Installing Hugo ${HUGO_VERSION}..."

# Create directory for Hugo download and installation
mkdir -p "${HOME}/bin"
mkdir -p /tmp/hugo
cd /tmp/hugo

# Download and install specific Hugo version
wget -q https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz
echo "${HUGO_CHECKSUM}  hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz" | sha256sum -c -
tar -xzf hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz

# Move Hugo to a directory you have permission for
mv hugo "${HOME}/bin/"

# Add the bin directory to PATH
export PATH="${HOME}/bin:${PATH}"

# Verify installation
hugo version

# Return to project directory
cd "$ORIGINAL_DIR"

# Transcode media assets at build time (JXL, WebM)
if [ -f "./scripts/transcode-media.sh" ]; then
  echo "Invoking media transcoding at build time..."
  bash ./scripts/transcode-media.sh
fi

# Build static site
hugo --gc --minify
