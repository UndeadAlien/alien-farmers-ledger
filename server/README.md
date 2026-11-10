# Home server: morning checklist

About an hour in total. Do the parts in order and tick each box as you go.
What you'll need: your PC, your phone, and access to the server (a keyboard and screen plugged in, or SSH).

## Part A: Cloudflare, on your PC (15 min)

- [ ] **A1.** Turn on 2FA for your Cloudflare account, if it isn't on already: dash.cloudflare.com → your profile → Authentication.
      This account now controls things that matter.
- [ ] **A2.** Upgrade to Workers Paid ($5/month): Workers & Pages → Plans.
- [ ] **A3.** Copy the ID of your helper's KV namespace:
      Workers & Pages → **af-alerts** → Settings → Bindings → click the namespace bound as **AF** → copy the **ID**.
- [ ] **A4.** In PowerShell, in your `alien-farmers-ledger` folder:

  ```
  git pull
  notepad brain\wrangler.toml
  ```

  Paste the ID over `PASTE_YOUR_AF_KV_NAMESPACE_ID_HERE`, then save and close Notepad.
- [ ] **A5.** Still in PowerShell. If `npm` isn't recognized, install Node.js LTS from nodejs.org first, then reopen PowerShell.

  ```
  cd brain
  npm install
  npx wrangler login
  npx wrangler deploy
  ```

  `wrangler login` opens your browser once. Click **Allow**.
- [ ] **A6.** Open https://af-brain.alienfarmers.workers.dev/status. It should show `"app":"af-brain"`.
- [ ] **A7.** In your Ledger: **Settings → Copy owner link**. Keep it handy in your password manager. You'll paste it twice
      in Part B. Never post it in a chat.
- [ ] **A8.** From this chat, download **alien-farmers-game-helper-v0.18.1.zip** to your PC.

## Part B: the server (25 min)

- [ ] **B1.** Log in to the server, at its own keyboard or over SSH from your PC.
- [ ] **B2.** Get the repo:

  ```
  git clone https://github.com/UndeadAlien/alien-farmers-ledger.git
  ```

  If it's already on the server, run `cd alien-farmers-ledger && git pull` instead.
- [ ] **B3.** Copy the zip into your home folder on the server. Either use a USB stick, or run this from PowerShell on your PC:

  ```
  scp $HOME\Downloads\alien-farmers-game-helper-v0.18.1.zip YOURUSER@SERVER-IP:~
  ```
- [ ] **B4.** On the server:

  ```
  cd ~/alien-farmers-ledger/server
  sudo bash setup.sh
  ```
- [ ] **B5.** When it shows a **Tailscale link**:
  1. Open the link on your phone.
  2. Sign in (Google, Microsoft or GitHub). Tailscale is free for personal use.
  3. Use the **same account** in Part C.
- [ ] **B6.** When it asks, paste the **owner link** from A7. Nothing shows while you paste. Press Enter.
- [ ] **B7.** At the end it prints the **game browser address, user and password**. Save the password in your password manager.

## Part C: your phone and PC (10 min)

- [ ] **C1.** Install **Tailscale** on your phone (App Store) and your PC (tailscale.com/download). Sign in with the same account.
- [ ] **C2.** On your PC, open the game browser address from B7 (`https://100.x.x.x:3001`).
      Your browser warns about the certificate the first time. Click Advanced → Proceed.
      Then sign in with user `alien` and the password from B7.
- [ ] **C3.** You're now looking at the server's own Chromium, already on play.upland.me.
      **Log in to Upland** there yourself: email, password, 2FA.
- [ ] **C4.** In that same remote Chromium, open a new tab, paste the **owner link** from A7, and let the Ledger load once.
      Then close that tab. This hands the Game Helper your owner code.
- [ ] **C5.** Back on the game tab, check for the Alien Farmers button on the side of the screen. Open it and look at the bottom line:
  - It should say **Connected to the game**.
  - Under Restock, it should say **Plan from … (Farm brain)**. The first plan can take up to 10 minutes.
  - If the button isn't there:
    1. Go to `chrome://extensions` in that remote Chromium.
    2. Turn on Developer mode.
    3. Click Load unpacked and pick `/ext/game-helper`.

## Part D: test it (15 min)

- [ ] **D1.** Wait about 10 minutes. Then https://af-brain.alienfarmers.workers.dev/status should show `"why":"home server"`
      and a `snapAt` time.
- [ ] **D2.** On your **phone**, open the Ledger. A **Restock all** bar shows at the top when there's something to list.
      Tap **Restock all**.
      No bar? Your phone isn't an owner device yet: open the owner link from A7 on your phone once.
- [ ] **D3.** On your PC, watch the remote game browser. Within about 20 seconds the panel shows **Restock all** working,
      about one action every 10 seconds.
- [ ] **D4.** Tap **Stop** on your phone. It should stop within a few seconds. Then tap **Restock all** again and let it finish.
- [ ] **D5.** In Chrome on your own PC, keep the old Game Helper or remove it. Don't load v0.18.1 there **and** on the
      server at the same time unless you need to. They won't double-run a restock, but one game tab doing the work is simpler.

## Part E: once a month (1st of the month, 10 min)

- [ ] On the server, run:

  ```
  sudo apt update && sudo apt upgrade -y
  cd /opt/alienfarmers && sudo docker compose pull && sudo docker compose up -d
  ```
- [ ] Tailscale admin (login.tailscale.com): only your own devices are listed.
- [ ] Cloudflare → Manage account → Audit log: only your own logins and changes.
- [ ] Upland: no login emails or sessions you don't recognize.
- [ ] https://af-brain.alienfarmers.workers.dev/status: `last.state` is `done`.

## Day to day

- **The server restarts by itself after a power cut.** Docker brings both containers back, and the game tab opens again.
- **When Upland logs the game tab out**, open the game browser (C2) and log in again. The Ledger warns you when the
  session is ending.
- **Using the server for other projects:** everything for Alien Farmers lives in `/opt/alienfarmers` and its two containers.
  Other projects go in their own folders and containers next to it.
- **Moving to another machine:** copy the zip over, `git clone`, and run `sudo bash setup.sh` again. To keep the same
  owner code, copy `/opt/alienfarmers/.env` over first.
- **Turning it all off:** `cd /opt/alienfarmers && sudo docker compose down`.
