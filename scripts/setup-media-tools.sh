#!/usr/bin/env bash
set -euo pipefail
# Reuse working runner tools before contacting a package mirror. All callers
# still execute the real FFmpeg/ffprobe check; presence alone is not acceptance.
if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then
  node scripts/check-media-tools.mjs
  exit 0
fi
# Bound both each transport and the complete operation: mirror fallback can
# otherwise stall indefinitely during index downloads, before any publication.
sudo timeout --kill-after=5s 120s apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o APT::Update::Error-Mode=any update
sudo timeout --kill-after=5s 300s apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 install -y ffmpeg
node scripts/check-media-tools.mjs
