# Farm brain (af-brain)

A second Cloudflare Worker, separate from your phone-alerts helper (af-alerts).

## What it does

Every 10 minutes it opens your Ledger in a headless browser on Cloudflare as an owner device. It saves one snapshot of the
restock plan and the Home numbers, which the Ledger, your phone and the Game Helper all read. It also keeps the public copy
of your Ledger fresh. Your computer can be off for all of this.

It also holds **Restock all** runs:

- You press Restock all on any device, and it waits here.
- The Game Helper in your open play.upland.me tab picks it up and works through every nursery. It does one action every
  10 seconds (never faster than every 8), waits out Upland's cooldowns, and pauses 30 seconds between nurseries.
- You can press Stop on any device.

The brain itself never lists anything. It has no Upland login and no game keys.

## Setup (once, about 15 minutes)

1. In the Cloudflare dashboard, go to **Workers & Pages → Plans** and switch to **Workers Paid** ($5/month). Headless
   browsers need the paid plan.
2. Find the KV namespace your helper uses:
   1. Go to **Workers & Pages → af-alerts → Settings → Bindings**.
   2. Click the KV namespace bound as **AF**.
   3. Copy its **ID**.
3. Open `brain/wrangler.toml` in this repo and paste that ID over `PASTE_YOUR_AF_KV_NAMESPACE_ID_HERE`.
4. Install Node.js (the LTS version) from nodejs.org, if it isn't installed already.
5. In PowerShell, in this repo's folder, run:

   ```
   git pull
   cd brain
   npm install
   npx wrangler login
   npx wrangler deploy
   ```

   `wrangler login` opens your browser once, so you can let it into your Cloudflare account.
6. Wait 10 minutes, then open https://af-brain.alienfarmers.workers.dev/status. `snapAt` should show a time, and
   `last.state` should say `done`.

## Cost

- Workers Paid is $5/month and includes 10 browser hours.
- Each brain run takes roughly 30 to 90 seconds, and it runs 144 times a day. That's about 36 to 108 browser hours a month.
- Browser time over the included 10 hours costs $0.09 an hour.
- That puts the total around $7 to $14 a month, depending on how long each run takes.
- To spend less, change the cron in `wrangler.toml`, for example to `*/20 * * * *`, then run `npx wrangler deploy` again.

## Routes

| Route | Who can use it | What it does |
| --- | --- | --- |
| `GET /status` | Anyone | Last run, snapshot time, current Restock run |
| `GET /snap` | Anyone | The snapshot (it's the same data the public site already shows) |
| `POST /refresh` | Owner | Run the brain now |
| `GET /run` | Anyone | Shows the current Restock all run |
| `POST /run` | Owner | Start a Restock all run |
| `POST /run/stop` | Owner | Stop the current run |
| `POST /run/claim` | Owner (Game Helper) | Pick up a waiting run |
| `POST /run/progress` | Owner (Game Helper) | Report progress |

"Owner" means the call carries the private code your Ledger already has for af-alerts. There's no new secret to set up.
