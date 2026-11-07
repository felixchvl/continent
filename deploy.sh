#!/usr/bin/env bash
# Deploys main to the Continent server (LXC 145, `ssh continent`): pull, build the web app,
# install the server's dependencies, restart the service. Push to GitHub first.
set -euo pipefail
ssh continent 'set -e
  sudo -u continent git -C /opt/continent pull --ff-only
  cd /opt/continent/web && sudo -u continent npm ci --silent && sudo -u continent npm run build --silent
  cd /opt/continent/server && sudo -u continent npm ci --omit=dev --silent
  sudo systemctl restart continent
  sleep 2; systemctl is-active continent'
