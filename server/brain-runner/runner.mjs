// Alien Farmers · Farm brain runner (on your home server)
// Every 10 minutes (or within a minute of a Refresh from any device) it opens your Ledger headless as an owner device,
// lets it read the chain and your shelves, and pushes the snapshot to the Farm brain on Cloudflare (POST /snap). The
// Ledger's saved data lives in /data between runs, so each run only reads what's new. While this runs, Cloudflare's own
// browser stays off. Needs AF_OWNER_KEY (your Ledger's owner code), from /opt/alienfarmers/.env.
import {chromium} from "playwright";
const BRAIN = process.env.BRAIN_URL || "https://af-brain.alienfarmers.workers.dev";
const LEDGER = process.env.LEDGER_URL || "https://undeadalien.github.io/alien-farmers-ledger/";
const KEY = process.env.AF_OWNER_KEY || "", HOST = process.env.HOST_NAME || "home server", PROFILE = process.env.PROFILE_DIR || "/data/ledger-profile";
const EVERY = Math.max(2, +process.env.EVERY_MIN || 10) * 60e3, ONCE = process.env.ONCE === "1";
const log = m => console.log(new Date().toISOString().slice(0, 19).replace("T", " "), m);
if (!KEY) { log("No owner code (AF_OWNER_KEY). Run setup.sh again."); process.exit(1); }
let last = 0, lastWant = 0, busy = false;
export async function think(){
  busy = true; const t0 = Date.now(); let ctx = null, ok = false;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE, {headless: true});
    const page = await ctx.newPage();
    await page.goto(LEDGER + "?brain=1#owner=" + encodeURIComponent(KEY), {waitUntil: "domcontentloaded", timeout: 60e3});
    await page.waitForFunction(() => window.__afBrain && /^(done|error)$/.test(window.__afBrain.state), null, {timeout: 300e3, polling: 1000});
    const r = await page.evaluate(() => window.__afBrain);
    if (r.state !== "done" || !r.snap) throw new Error(r.error || "the Ledger couldn't make a plan");
    const res = await fetch(BRAIN + "/snap", {method: "POST", headers: {"Content-Type": "application/json", "x-af-key": KEY}, body: JSON.stringify({snap: r.snap, host: HOST, ms: Date.now() - t0})});
    if (!res.ok) throw new Error(`the Farm brain answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    ok = true; log(`snapshot sent: ${r.snap.home && r.snap.home.say || ""} (${Math.round((Date.now() - t0) / 1000)} s)`);
  } catch (e) { log("couldn't make a snapshot: " + (e && e.message || e)); }
  finally { try { if (ctx) await ctx.close(); } catch {} busy = false; last = Date.now(); }
  return ok;
}
async function tick(){
  if (busy) return;
  let want = 0; try { const s = await (await fetch(BRAIN + "/status", {cache: "no-store"})).json(); want = (s.want && s.want.at) || 0; } catch {}
  const asked = want > lastWant && want > last;
  if (asked || Date.now() - last >= EVERY) { lastWant = Math.max(lastWant, want); if (asked) log("refresh asked for"); await think(); }
}
if (ONCE) process.exit((await think()) ? 0 : 1);
log(`Farm brain runner: every ${EVERY / 60e3} min, Ledger ${LEDGER}, brain ${BRAIN}`);
tick(); setInterval(tick, 60e3);
