// Alien Farmers · Farm brain (Cloudflare Worker)
//
// Every 10 minutes it opens your Ledger in a headless browser (Cloudflare Browser Run) as an owner device, lets it read
// the chain and your real shelves, and saves one snapshot: the restock plan and the Home numbers. The Ledger, your phone
// and the Game Helper all read that one snapshot (GET /snap), so they show the same thing, instantly, with your computer off.
// The Ledger it opens also publishes a fresh public copy of itself, so the public site stays current too.
//
// It also holds "Restock all" runs. The Ledger (on any device) asks for one; the Game Helper in your play.upland.me tab
// picks it up, lists one seed at a time at a fixed pace a person could keep (one action every 10 s by default, never faster
// than every 8 s, plus Upland's own cooldowns), and reports progress here. Stop works from any device.
// The brain itself never signs or lists anything: it has no Upland login and no game keys.
//
// Shares the KV namespace (AF) with the phone-alerts helper, so the owner code is the one your Ledger already has.

import puppeteer from "@cloudflare/puppeteer";

const VERSION = 1;
const LEDGER = "https://undeadalien.github.io/alien-farmers-ledger/";
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type,x-af-key"};
export const PACE = {gap: 10, min: 8, max: 60, pauseShop: 30};   // seconds
const LOCK_MS = 6 * 60e3, QUEUED_MAX = 30 * 60e3, SILENT_MAX = 15 * 60e3;

const json = (o, st = 200) => new Response(JSON.stringify(o), {status: st, headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
const cfg = async env => (await env.AF.get("cfg", "json")) || {};
export async function owner(env, key){ const c = await cfg(env); return !!key && !!c.key && c.key === key; }
const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");
const live = r => !!(r && /^(queued|running|stopping)$/.test(r.state));
const clean = (v, n) => String(v == null ? "" : v).slice(0, n);

// ---------- thinking: one headless Ledger run → one snapshot ----------
export async function think(env, why = "schedule", deps = {}){
  const now = Date.now(), lock = await env.AF.get("brain:lock", "json");
  if (lock && now - lock.at < LOCK_MS) return {skipped: "already thinking"};
  const c = await cfg(env); if (!c.key) return {skipped: "the helper isn't claimed yet"};
  await env.AF.put("brain:lock", JSON.stringify({at: now, why}));
  const launch = deps.launch || (() => puppeteer.launch(env.BROWSER));
  let browser = null, res = null;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(LEDGER + "?brain=1#owner=" + encodeURIComponent(c.key), {waitUntil: "domcontentloaded", timeout: 60e3});
    await page.waitForFunction(() => window.__afBrain && /^(done|error)$/.test(window.__afBrain.state), {timeout: 300e3, polling: 1000});
    res = await page.evaluate(() => window.__afBrain);
  } catch (e) { res = {state: "error", error: String(e && e.message || e)}; }
  finally { try { if (browser) await browser.close(); } catch {} await env.AF.delete("brain:lock"); }
  const last = {at: now, end: Date.now(), why, state: res && res.state || "error", error: res && res.error || "", ms: res && res.ms || 0};
  if (res && res.state === "done" && res.snap && res.snap.app === "af-snap") { await env.AF.put("brain:snap", JSON.stringify(res.snap)); last.snapAt = res.snap.at; }
  await env.AF.put("brain:last", JSON.stringify(last));
  return last;
}

// ---------- runs ----------
async function getRun(env){ return (await env.AF.get("brain:run", "json")) || null; }
async function putRun(env, r){ await env.AF.put("brain:run", JSON.stringify(r)); return r; }
export async function tidyRun(env, now = Date.now()){   // queued too long, or a running tab that went quiet
  const r = await getRun(env); if (!live(r)) return r;
  if (r.state === "queued" && now - r.at > QUEUED_MAX) return putRun(env, {...r, state: "expired", end: now, progress: {...(r.progress || {}), line: "No game tab picked it up"}});
  if (r.state !== "queued" && now - (r.seen || r.at) > SILENT_MAX) return putRun(env, {...r, state: "lost", end: now, progress: {...(r.progress || {}), line: "The game tab stopped answering"}});
  return r;
}

export async function handle(req, env, ctx){
  if (req.method === "OPTIONS") return new Response(null, {headers: CORS});
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, "") || "/";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const mine = () => owner(env, req.headers.get("x-af-key"));
  const later = f => ctx && ctx.waitUntil ? ctx.waitUntil(f) : f;
  if (p === "/" || p === "/status") {
    const last = await env.AF.get("brain:last", "json"), snap = await env.AF.get("brain:snap", "json");
    return json({ok: true, app: "af-brain", v: VERSION, pace: PACE, last, snapAt: snap ? snap.at : null, run: await tidyRun(env)});
  }
  if (p === "/snap" && req.method === "GET") {
    const v = await env.AF.get("brain:snap"); if (!v) return json({error: "No snapshot yet. The first one comes within 10 minutes."}, 404);
    return new Response(v, {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
  }
  if (p === "/refresh" && req.method === "POST") {
    if (!(await mine())) return json({error: "Only the Ledger's owner can do that."}, 403);
    later(think(env, "asked")); return json({ok: true, started: true});
  }
  if (p === "/run" && req.method === "GET") return json({run: await tidyRun(env)});
  if (p.startsWith("/run") && req.method === "POST") {
    if (!(await mine())) return json({error: "Only the Ledger's owner can do that."}, 403);
    const now = Date.now(); let r = await tidyRun(env, now);
    if (p === "/run") {
      if (live(r)) return json({run: r, note: "A run is already going."});
      const gap = Math.min(PACE.max, Math.max(PACE.min, +body.gap || PACE.gap));
      const scope = body.scope === "all" || body.scope == null ? "all" : String(+body.scope || "all");
      r = await putRun(env, {id: rid(), at: now, state: "queued", scope, gap, pauseShop: PACE.pauseShop, by: clean(body.from || "ledger", 20), progress: {}});
      return json({run: r});
    }
    if (!r || (body.id && r.id !== body.id)) return json({error: "That run isn't the current one.", run: r}, 409);
    if (p === "/run/stop") {
      if (!live(r)) return json({run: r});
      r = await putRun(env, r.state === "queued" ? {...r, state: "stopped", end: now} : {...r, state: "stopping", stopAt: now});
      return json({run: r});
    }
    if (p === "/run/claim") {
      if (r.state !== "queued") return json({error: "This run was already picked up or ended.", run: r}, 409);
      r = await putRun(env, {...r, state: "running", device: clean(body.device, 40), start: now, seen: now});
      return json({run: r});
    }
    if (p === "/run/progress") {
      if (!live(r)) return json({run: r});
      const pg = body.progress || {}, progress = {shop: clean(pg.shop, 60), shopN: +pg.shopN || 0, shops: +pg.shops || 0, done: +pg.done || 0, of: +pg.of || 0, listed: +pg.listed || 0, fixed: +pg.fixed || 0, line: clean(pg.line, 160)};
      const end = /^(done|error|stopped)$/.test(body.state || "");
      r = await putRun(env, {...r, seen: now, progress, ...(end ? {state: body.state, end: now, error: clean(body.error, 300)} : {})});
      if (end) later(think(env, "after run"));   // fresh numbers once the shelves changed
      return json({run: r});
    }
  }
  return json({error: "not found"}, 404);
}

export default {
  fetch: (req, env, ctx) => handle(req, env, ctx).catch(e => json({error: String(e && e.message || e)}, 500)),
  async scheduled(event, env, ctx){ ctx.waitUntil(tidyRun(env).then(() => think(env)).catch(() => {})); }
};
