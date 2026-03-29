#!/bin/bash
set -euo pipefail

docker compose up -d --build db seeder app nginx

echo "SportsDeck is starting on http://localhost"
