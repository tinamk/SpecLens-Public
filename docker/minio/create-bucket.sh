#!/bin/sh
set -eu

mc alias set speclens "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "speclens/$MINIO_BUCKET"
mc anonymous set private "speclens/$MINIO_BUCKET"
