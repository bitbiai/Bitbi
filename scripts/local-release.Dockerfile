# Persistent tooling only; no source, credentials, sessions or previous test state.
FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS node22
FROM mcr.microsoft.com/playwright:v1.58.2-noble@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d
USER root
COPY --from=node22 /usr/local/bin/node /usr/bin/node
COPY --from=node22 /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/bin/node /usr/local/bin/node && \
    ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && \
    apt-get update && apt-get install -y --no-install-recommends ffmpeg iproute2 sudo python3 curl util-linux git zip unzip && \
    rm -rf /var/lib/apt/lists/* && \
    test "$(id -u pwuser)" = 1001 && test "$(id -g pwuser)" = 1001 && \
    printf 'pwuser ALL=(root) NOPASSWD: /usr/bin/env\n' > /etc/sudoers.d/bitbi-release && \
    chmod 0440 /etc/sudoers.d/bitbi-release && \
    printf '{"policy":"development-mac-v1","boundary":"disposable-container"}\n' > /etc/bitbi-local-release.json && \
    chmod 0444 /etc/bitbi-local-release.json && \
    test "$(node --version)" = v22.23.1 && zip -v >/dev/null && unzip -v >/dev/null
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=1 WRANGLER_SEND_METRICS=false
USER 1001:1001
