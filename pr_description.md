🎯 **What:** The `build.sh` script downloaded a Hugo binary without verifying its integrity, exposing the build process to potential Man-in-the-Middle (MITM) attacks or compromised release assets.

⚠️ **Risk:** If a malicious actor compromised the network or the release server, they could serve a malicious binary, leading to arbitrary code execution in the build environment, potentially compromising deployment secrets or modifying the application payload.

🛡️ **Solution:** Added a checksum validation step using `sha256sum -c -` with the official SHA-256 hash for the Hugo version 0.165.0 Linux AMD64 release. If the checksum does not match, the `sha256sum` command will fail, and because the script uses `set -o errexit`, it will halt the entire execution safely.
