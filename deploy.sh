#!/usr/bin/env bash
set -euo pipefail

cd /home/adminpc/mypost-terminal

echo "Pulling latest changes..."
git fetch origin
git reset --hard origin/main

echo "Building..."
cd ./frontend
npm run build

sudo reboot now