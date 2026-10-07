#!/bin/bash
# ==================================================================
#  start-api.sh — starts (or restarts) the API with PM2 and makes it
#  start automatically when the EC2 instance reboots.
#      bash deploy/start-api.sh
# ==================================================================
set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR/backend"

if pm2 describe kongsi-api > /dev/null 2>&1; then
  pm2 restart kongsi-api --update-env
else
  pm2 start src/server.js --name kongsi-api
fi
pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" > /dev/null

sleep 2
echo ""
echo ">>> Health check through Nginx:"
curl -s http://localhost/api/health || echo "Health check failed — run: pm2 logs kongsi-api"
echo ""
echo ">>> Useful commands:  pm2 status | pm2 logs kongsi-api | pm2 restart kongsi-api --update-env"
