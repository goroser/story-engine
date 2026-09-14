#!/usr/bin/env bash
# Deploys web/ (the dynamic, Supabase-backed site + generation API) to Vercel.
#
# One-time setup (you do this yourself — account auth can't be done for you):
#   1. Create a Supabase project (free tier) at supabase.com, then run
#      supabase/schema.sql in its SQL editor.
#   2. cd web && npx vercel login          (log in with GitHub/email)
#   3. npx vercel link                      (creates/links the Vercel project)
#   4. Set these as Production env vars (npx vercel env add <NAME> production):
#        SITE_PASSWORD          — password you'll type on iPad
#        SITE_USER              — optional, defaults to "yan"
#        SUPABASE_URL           — from Supabase Project Settings → API
#        SUPABASE_SERVICE_ROLE_KEY — same page (server-only, never exposed)
#        ANTHROPIC_API_KEY      — from console.anthropic.com
#        GEMINI_API_KEY         — from aistudio.google.com (same key as the MCP server)
#
# Then just run this script whenever you want to push a code change:
#   ./scripts/deploy.sh
# (New stories don't need a redeploy — they're generated live via /api and
# read live from Supabase.)

set -euo pipefail
cd "$(dirname "$0")/../web"

echo "==> Installing web/ dependencies"
npm install --no-audit --no-fund

echo "==> Deploying to Vercel"
npx vercel deploy --prod
