#!/bin/bash
# Local demo: seeded fake database + fake mailer. Set GEMINI_API_KEY to try real uploads.
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"
[ -f ~/Desktop/kargo-hiring/.env ] && [ -z "$GEMINI_API_KEY" ] && set -a && . ~/Desktop/kargo-hiring/.env && set +a
exec npx tsx scripts/demo.ts
