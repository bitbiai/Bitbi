#!/usr/bin/env bash
set -euo pipefail
# Existing Ubuntu CI/processor callers share one installation and execution check.
sudo apt-get update
sudo apt-get install -y ffmpeg
node scripts/check-media-tools.mjs
