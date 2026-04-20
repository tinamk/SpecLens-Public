#!/bin/sh
set -eu

attempt=0
until mc alias set speclens "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "minio-init: unable to connect to $MINIO_ENDPOINT after $attempt attempts" >&2
    exit 1
  fi
  sleep 2
done

mc mb --ignore-existing "speclens/$MINIO_BUCKET"
mc anonymous set private "speclens/$MINIO_BUCKET"
