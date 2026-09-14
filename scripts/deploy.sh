#!/usr/bin/env bash
# Builds the site export and deploys it to Vercel, password-gated.
#
# One-time setup (you do this yourself — account auth can't be done for you):
#   1. npx vercel login          (log in with GitHub/email — free account is fine)
#   2. npx vercel link           (run from repo root; creates/links a Vercel project)
#   3. npx vercel env add SITE_PASSWORD production   (paste a password you'll type on iPad)
#      npx vercel env add SITE_USER production       (optional; defaults to "yan")
#
# Then just run this script whenever you want to push the latest stories:
#   ./scripts/deploy.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Building TypeScript"
npm run build

echo "==> Exporting static site"
node scripts/export-site.mjs

echo "==> Adding robots.txt and Vercel middleware"
printf 'User-agent: *\nDisallow: /\n' > site/robots.txt
cp vercel/middleware.js site/middleware.js

echo "==> Deploying to Vercel"
npx vercel deploy site --prod
