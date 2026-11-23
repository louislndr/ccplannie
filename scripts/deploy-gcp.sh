#!/bin/bash
# Deploy the company console to an always-free Google Cloud e2-micro VM with HTTPS.
#   PROJECT=lawly00 ./scripts/deploy-gcp.sh        (first run creates the VM; later runs update it)
# Needs: gcloud logged in, billing enabled on the project, and a filled-in .env in the repo root.
set -euo pipefail
PROJECT="${PROJECT:-lawly00}"
ZONE="${ZONE:-us-central1-a}"     # always-free e2-micro regions: us-west1, us-central1, us-east1
VM="${VM:-plannie}"
cd "$(dirname "$0")/.."
[ -s .env ] || { echo "Fill in .env first (copy .env.example)."; exit 1; }
G="gcloud --project $PROJECT --quiet"

$G services enable compute.googleapis.com >/dev/null
if ! $G compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  echo "Creating $VM (e2-micro, $ZONE)…"
  $G compute instances create "$VM" --zone "$ZONE" --machine-type e2-micro \
    --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-standard --tags plannie-web >/dev/null
fi
$G compute firewall-rules describe plannie-web >/dev/null 2>&1 || \
  $G compute firewall-rules create plannie-web --allow tcp:80,tcp:443 --target-tags plannie-web >/dev/null
IP=$($G compute instances describe "$VM" --zone "$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
HOST="${HOST:-${IP//./-}.sslip.io}"   # free hostname that resolves to the VM, so Caddy can get a real HTTPS certificate

echo "Building the web app…"
npm run build:web >/dev/null
TMP=$(mktemp -d)
tar czf "$TMP/ccplannie.tgz" --exclude=node_modules --exclude=web/node_modules --exclude=data --exclude=.env \
  --exclude=.git --exclude=design/shots --exclude='*.sqlite*' .
cp .env "$TMP/plannie.env"
echo "Uploading to $VM ($IP)…"
for i in 1 2 3 4 5 6; do $G compute scp --zone "$ZONE" "$TMP/ccplannie.tgz" "$TMP/plannie.env" deploy/vm-setup.sh "$VM":/tmp/ && break; echo "  waiting for SSH…"; sleep 10; done
rm -rf "$TMP"
$G compute ssh "$VM" --zone "$ZONE" --command "sudo bash /tmp/vm-setup.sh $HOST"
echo
echo "Company console: https://$HOST/admin"
