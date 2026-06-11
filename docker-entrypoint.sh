#!/bin/sh
set -e

echo "🚀 Starting Riffado..."

echo "⏳ Running database migrations..."
bun migrate-idempotent.js

echo "🚀 Starting application..."
exec "$@"
