#!/bin/sh
set -e

echo "🚀 Starting Mesynx AI..."

echo "⏳ Running database migrations..."
bun migrate-idempotent.js

echo "🚀 Starting application..."
exec "$@"
