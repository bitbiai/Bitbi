FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg=7:5.1.9-0+deb12u1 webp=1.2.4-0.2+deb12u1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json processor.mjs canvas-full-video.mjs memvid-preview-flow.mjs private-media-runner.mjs container-server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "processor.mjs"]
