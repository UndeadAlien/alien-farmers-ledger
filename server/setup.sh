#!/usr/bin/env bash
# Alien Farmers · home server setup (Ubuntu). Run from this folder:   sudo bash setup.sh
# Safe to run again (after an update, or on a new machine): it keeps your settings and only redoes what's needed.
#
# What it does:
#   1. updates Ubuntu and turns on automatic security updates
#   2. firewall: nothing comes in from the internet; SSH only from your home network; your own devices through Tailscale
#   3. installs Docker (everything runs in containers, so the server stays free for other projects)
#   4. installs Tailscale and logs this server in (a private network between your server, PC and phone)
#   5. puts the Game Helper and the Farm brain runner in /opt/alienfarmers
#   6. asks for your Ledger owner code once (kept in /opt/alienfarmers/.env, readable only by root)
#   7. starts the game browser and the Farm brain runner; both start again by themselves after a reboot
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo:  sudo bash setup.sh"; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd); APP=/opt/alienfarmers
say(){ printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
stop(){ printf '\n\033[1;31m%s\033[0m\n' "$*"; exit 1; }

# the Game Helper zip: the newest one in a home folder, or the path you give:  sudo bash setup.sh /path/to/zip
ZIP=${1:-$(ls -t /home/*/alien-farmers-game-helper-v*.zip /root/alien-farmers-game-helper-v*.zip 2>/dev/null | head -1 || true)}
[ -n "$ZIP" ] && [ -f "$ZIP" ] || stop "First copy the Game Helper zip (alien-farmers-game-helper-v0.18.1.zip, from the chat) into your home folder on this server, then run this again."

say "1/7 Updating Ubuntu and turning on automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl unzip openssl ufw unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

say "2/7 Firewall: nothing comes in from the internet"
ufw default deny incoming
ufw default allow outgoing
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do ufw allow from "$net" to any port 22 proto tcp comment "SSH from home network" >/dev/null; done
ufw allow in on tailscale0 comment "your own devices through Tailscale" >/dev/null
ufw --force enable

say "3/7 Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

say "4/7 Tailscale (private access from your PC and phone)"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
systemctl enable --now tailscaled
if ! tailscale ip -4 >/dev/null 2>&1; then
  echo "Open the link below on your PC or phone and sign in (use the same account you'll use on your phone and PC):"
  tailscale up --hostname alienfarmers-server
fi
TS_IP=$(tailscale ip -4 | head -1)
[ -n "$TS_IP" ] || stop "Tailscale didn't give this server an address. Run:  sudo tailscale up   then run this script again."

say "5/7 Putting the files in $APP"
mkdir -p "$APP" "$APP/browser-config"
cp -r "$HERE/brain-runner" "$HERE/docker-compose.yml" "$APP/"
rm -rf "$APP/extension" && mkdir -p "$APP/extension" && unzip -q -o "$ZIP" -d "$APP/extension"
[ -f "$APP/extension/manifest.json" ] || stop "That zip doesn't look like the Game Helper (no manifest.json inside)."
chown -R 1000:1000 "$APP/browser-config" "$APP/extension"
echo "Game Helper $(grep -o '"version": *"[^"]*"' "$APP/extension/manifest.json" | grep -o '[0-9.]*') from $ZIP"

say "6/7 Your Ledger owner code"
if [ ! -f "$APP/.env" ]; then
  echo "In your Ledger on your PC: Settings → Copy owner link. Paste it here (it won't show while you paste), then Enter."
  read -rsp "Owner link or code: " KEY; echo
  KEY=${KEY##*#owner=}; KEY=$(printf '%s' "$KEY" | tr -cd 'A-Za-z0-9_-')
  [ ${#KEY} -ge 24 ] || stop "That doesn't look like an owner code (it's 24+ letters and numbers). Run this again."
  PW=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)
  (umask 077; printf 'AF_OWNER_KEY=%s\nBROWSER_PASSWORD=%s\nTS_IP=%s\n' "$KEY" "$PW" "$TS_IP" > "$APP/.env")
else
  sed -i "s/^TS_IP=.*/TS_IP=$TS_IP/" "$APP/.env"
  echo "Keeping the owner code you already gave (delete $APP/.env and run again to change it)."
fi
chmod 600 "$APP/.env"; chown root:root "$APP/.env"

say "7/7 Starting the game browser and the Farm brain runner"
cd "$APP" && docker compose up -d --build

PW=$(grep '^BROWSER_PASSWORD=' "$APP/.env" | cut -d= -f2)
cat <<DONE

$(printf '\033[1;32m')All set.$(printf '\033[0m')
  Game browser:  https://$TS_IP:3001   (from any device signed in to Tailscale)
  User:          alien
  Password:      $PW      ← save it in your password manager now
  Your browser will warn about the certificate the first time: that's the server's own, choose Advanced → Proceed.

  Check on things any time:
    sudo docker compose -f $APP/docker-compose.yml ps
    sudo docker compose -f $APP/docker-compose.yml logs -f farm-brain-runner
DONE
