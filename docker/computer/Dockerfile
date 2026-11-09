# UNTESTED: Docker is not installed on the development machine. Build and smoke-test this image before relying on it:
#   docker build -t openag/computer:latest docker/computer
#   docker run --rm openag/computer:latest sh -c 'DISPLAY=:99 xdotool getmouselocation && import -window root png:- | head -c 8'
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    LANG=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb \
      openbox \
      xdotool \
      imagemagick \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      ca-certificates \
      dbus-x11 \
 && rm -rf /var/lib/apt/lists/*

# Non-root desktop user; the container runs as this user (no sudo, no root at runtime).
RUN useradd --create-home --uid 1000 --shell /bin/bash computer \
 && mkdir -p /workspace \
 && chown computer:computer /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

USER computer
WORKDIR /workspace
VOLUME ["/workspace"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
