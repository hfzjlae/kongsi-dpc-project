#!/bin/bash
# ==================================================================
#  update-api.sh — pull the latest code from GitHub and restart the API.
#      bash deploy/update-api.sh
# ==================================================================
set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
git pull
cd backend
npm ci --omit=dev
pm2 restart kongsi-api --update-env
sleep 2
curl -s http://localhost/api/health; echo
