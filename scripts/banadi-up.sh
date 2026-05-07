#!/usr/bin/env bash
# Build (if needed) and start the long-lived `banadi` kali container.
# Idempotent: re-running while the container is up is a no-op.

set -euo pipefail

IMAGE="${BANADI_IMAGE:-banadi/banadi:latest}"
NAME="${BANADI_CONTAINER:-banadi}"
DOCKERFILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docker/banadi"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "build: $IMAGE" >&2
  docker build -t "$IMAGE" "$DOCKERFILE_DIR"
fi

state="$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || true)"

case "$state" in
  running)
    echo "banadi: already running" >&2
    ;;
  exited|created)
    echo "banadi: starting existing container" >&2
    docker start "$NAME" >/dev/null
    ;;
  "")
    echo "banadi: creating container" >&2
    docker run -d --name "$NAME" --restart unless-stopped "$IMAGE" >/dev/null
    ;;
  *)
    echo "banadi: unexpected state '$state'" >&2
    exit 1
    ;;
esac

docker inspect -f '{{.State.Status}}' "$NAME"
