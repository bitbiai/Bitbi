FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg webp ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json processor.mjs README.md ./

USER node
CMD ["node", "processor.mjs"]
