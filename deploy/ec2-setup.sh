#!/bin/bash
# ==================================================================
#  ec2-setup.sh — prepares a fresh Amazon Linux 2023 EC2 instance to
#  run the Kongsi API (application tier).
#
#  Run ONCE on the EC2 instance, from inside the cloned project:
#      bash deploy/ec2-setup.sh
#
#  It installs: Node.js 22, PostgreSQL client (psql), Nginx, PM2
#  Then it installs the API's packages and sets Nginx up as a reverse
#  proxy:  internet --port 80--> Nginx --port 3000--> Node.js API
# ==================================================================
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo ">>> Project folder: $PROJECT_DIR"

echo ">>> Updating the system"
sudo dnf update -y

echo ">>> Installing Node.js 22"
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

echo ">>> Installing Nginx and the PostgreSQL client"
sudo dnf install -y nginx
sudo dnf install -y postgresql16 || sudo dnf install -y postgresql15

echo ">>> Installing PM2 (keeps the API running and restarts it if it crashes)"
sudo npm install -g pm2

echo ">>> Installing the API's packages"
cd "$PROJECT_DIR/backend"
npm ci --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  echo ">>> Created backend/.env from the template (you must edit it next)"
fi

echo ">>> Configuring Nginx"
sudo cp "$PROJECT_DIR/deploy/nginx-kongsi.conf" /etc/nginx/conf.d/kongsi.conf
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo ""
echo "=================================================================="
echo " Setup finished. Next steps (see docs/DEPLOYMENT-AWS.md):"
echo "  1. Create the tables:"
echo "       psql \"host=<RDS-endpoint> port=5432 dbname=kongsi user=postgres sslmode=require\" -f $PROJECT_DIR/database/schema.sql"
echo "  2. Edit the settings:   nano $PROJECT_DIR/backend/.env"
echo "  3. Start the API:       bash $PROJECT_DIR/deploy/start-api.sh"
echo "=================================================================="
