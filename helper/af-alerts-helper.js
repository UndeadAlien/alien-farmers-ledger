// Alien Farmers Ledger · phone alerts helper (Cloudflare Worker, one file, no npm)
//
// Every minute it reads your account on Upland's public ledger (chain-history.upland.me) and sends a push
// notification to the phones where you turned alerts on in the Ledger: your sales, commission from other
// players' sales in your shops, and valuable mints. It only reads; it can't list, buy or move anything.
//
// It can also hold a public copy of your Ledger, so anyone who opens your site sees it without connecting anything.
// It also keeps your Build-mode designs (so they follow you to a new phone or browser) and the read-only
// Alien Farmers share links you make for a build. Shared links show only the lot from Upland's public map.
//
// Needs one KV namespace bound as AF and a Cron Trigger "* * * * *". No keys to paste: it makes its own
// push key the first time, and the Ledger claims it with a private code saved in your browser.
//
// v63: the Ledger reads everything from the public chain now (no Upland session anywhere). The public pass-through
// (/pubup) also passes Upland's public shop page (GET /metaventures/secondary-shop/{id}: name, open or waiting, slots, lot),
// cached 10 minutes, so the Ledger knows each nursery without a login. /quote now holds the mint price the owner's
// Ledger read from the chain (what other players just paid).
// v64: GET /shelves?id=<shop> reads a nursery's real shelves from Upland's public shop pages (no login), cached 60 s.
// v66: the Ledger's Find tab lists every nursery on Upland. GET /shops?k=<owner code>&from=<shop number>&n=<up to 40> reads
// that many public shop pages in one call (cached 10 minutes), so the owner's Ledger can walk every shop number in a few
// hundred calls. The list it builds is kept here (POST /dir/save from the owner's Ledger, at most every 10 minutes; GET /dir
// for his other devices and visitors) so his phone and the public site share it.
// v62: the Ledger's Game link: Upland now answers only the game, so a snippet in your play.upland.me tab reads shelves and
// mint cost and hands them to the Ledger; when the two tabs can't talk directly it posts them here (POST /live, with a link
// key that can do nothing else) and the Ledger reads GET /live. Kept in the edge cache, saved to KV at most every 10 minutes.
// v60: a morning summary at the hour you pick, and a warning before (and when) the Upland session on your computer ends.
// v59: it also keeps your live mint quote (so every device and visitor sees it within a minute), sends a push when
// one of your new nurseries opens, and takes alert settings from whichever of your devices changed them last.

const VERSION = 66;
const CHAIN = "https://chain-history.upland.me";
const GAME = "playuplandme";
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type,x-af-key,x-af-meta"};

// ---------- small helpers ----------
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const json = (o, st = 200) => new Response(JSON.stringify(o), {status: st, headers: {...CORS, "Content-Type": "application/json"}});
const qty = q => parseFloat(String(q || "0").split(" ")[0]) || 0;
const lc = s => String(s || "").trim().toLowerCase();
const int = v => Math.round(v).toLocaleString("en-US");

// ---------- VAPID keys (made once, kept in KV) ----------
async function vapidKeys(env){
  let k = await env.AF.get("vapid", "json");
  if (!k) {
    const kp = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey), pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    k = {jwk, pub: b64u(pub)};
    await env.AF.put("vapid", JSON.stringify(k));
  }
  return k;
}
async function vapidAuth(endpoint, keys, subject){
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({typ: "JWT", alg: "ES256"}))), body = b64u(enc.encode(JSON.stringify({aud, exp: now + 12 * 3600, sub: subject || "mailto:alerts@alienfarmers.invalid"})));
  const key = await crypto.subtle.importKey("jwk", keys.jwk, {name: "ECDSA", namedCurve: "P-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign({name: "ECDSA", hash: "SHA-256"}, key, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.pub}`;
}

// ---------- Web Push payload encryption (RFC 8291, aes128gcm) ----------
const hkdf = async (salt, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({name: "HKDF", hash: "SHA-256", salt, info},
  await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), len * 8));
async function encryptPayload(sub, text, _test){
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = _test && _test.as || await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, {name: "ECDH", namedCurve: "P-256"}, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({name: "ECDH", public: uaKey}, as.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = _test && _test.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce}, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function pushTo(env, sub, msg){
  const keys = await vapidKeys(env);
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const r = await fetch(sub.endpoint, {method: "POST", body, headers: {
    "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high",
    Authorization: await vapidAuth(sub.endpoint, keys, (await cfg(env)).subject)}});
  return r.status;
}
async function pushAll(env, msg){
  const subs = (await env.AF.get("subs", "json")) || [];
  if (!subs.length) return 0;
  const keep = [];
  for (const s of subs) { const st = await pushTo(env, s, msg).catch(() => 0); if (st !== 404 && st !== 410) keep.push(s); }
  if (keep.length !== subs.length) await env.AF.put("subs", JSON.stringify(keep));
  return keep.length;
}

// ---------- settings sent from the Ledger ----------
const cfg = async env => (await env.AF.get("cfg", "json")) || {};
async function owner(env, key){ const c = await cfg(env); return !!key && c.key === key; }

// ---------- reading the chain (same rules as the Ledger) ----------
async function chain(path, params){
  const r = await fetch(CHAIN + path + "?" + new URLSearchParams(params), {headers: {Accept: "application/json"}});
  if (!r.ok) throw new Error("chain " + r.status);
  return r.json();
}
function itemInfo(memo){
  memo = memo || "";
  return {name: (/NFT\s+"([^"]+)"/.exec(memo) || [])[1] || "", cat: (/owner of the\s+(.+?)\s+NFT\s+"/.exec(memo) || [])[1] || ""};
}
async function saleOf(trx, me){
  const d = await chain("/v2/history/get_transaction", {id: trx});
  const acts = (d.actions || []).map(a => ({c: a.act.account, n: a.act.name, d: a.act.data || {}}));
  const n = acts.find(a => a.c === GAME && a.n === "n112"); if (!n) return null;
  const nft = acts.find(a => a.n === "transfernft" && a.d.from === GAME && a.d.to === n.d.p14);
  const paid = acts.find(a => a.c === "upxtokenacct" && a.d.from === GAME && a.d.to === me);
  const info = itemInfo(nft && nft.d.memo);
  return {role: n.d.p25 === me ? "own" : n.d.p135 === me ? "commission" : "other", buyer: n.d.p14, seller: n.d.p25,
    received: paid ? qty(paid.d.quantity) || +paid.d.amount || 0 : 0, gross: qty(n.d.p141), item: info.name, cat: info.cat};
}
const isSeed = (c, name, cat) => /seed/i.test(cat || "") || (c.seeds || []).includes(lc(name));
const nice = (c, k) => (c.names && c.names[k]) || String(k).replace(/\b\w/g, x => x.toUpperCase());

async function check(env, now = Date.now()){
  const c = await cfg(env); if (!c.account) return {skipped: "no account yet"};
  const st = (await env.AF.get("state", "json")) || {};
  if (!st.seq) {   // first run: start from your latest action, so old news isn't sent
    const d0 = await chain("/v2/history/get_actions", {account: c.account, limit: 1, sort: "desc"});
    const a0 = (d0.actions || [])[0];
    await env.AF.put("state", JSON.stringify({seq: a0 ? a0.global_sequence : 1, ts: a0 ? Date.parse(a0.timestamp + "Z") : now}));
    return {started: true};
  }
  const d = await chain("/v2/history/get_actions", {account: c.account, limit: 200, sort: "desc", after: new Date((st.ts || now - 3 * 60e3) - 5 * 60e3).toISOString().slice(0, 19)});
  const acts = (d.actions || []).filter(a => a.global_sequence > (st.seq || 0)).sort((a, b) => a.global_sequence - b.global_sequence);
  if (!acts.length) return {new: 0};
  const msgs = [];
  {
    const pays = acts.filter(a => a.act.account === "upxtokenacct" && a.act.name === "transfer" && a.act.data.to === c.account && a.act.data.from === GAME);
    for (const p of pays.slice(0, 20)) {
      const s = await saleOf(p.trx_id, c.account).catch(() => null);
      if (!s || s.role === "other" || !isSeed(c, s.item, s.cat)) continue;
      const k = lc(s.item);
      if (s.role === "own" && c.sales !== false) msgs.push({kind: "sale", seed: k, title: `💰 Sold ${nice(c, k)}`, body: `${int(s.received)} UPX · bought by ${s.buyer}`});
      if (s.role === "commission" && c.commission !== false) msgs.push({kind: "com", seed: k, title: `％ Commission · ${nice(c, k)}`, body: `+${s.received.toFixed(2)} UPX · sold by ${s.seller}`});
    }
    if (c.mints !== false) {
      const mint = new Map();
      for (const a of acts) {
        const dd = a.act.data || {};
        if (a.act.account !== "uplandnftact" || a.act.name !== "transfernft" || dd.to !== c.account || dd.from !== GAME || !/initial owner/.test(dd.memo || "")) continue;
        const info = itemInfo(dd.memo); if (!info.name || !isSeed(c, info.name, info.cat)) continue;
        const k = lc(info.name); mint.set(k, (mint.get(k) || 0) + (dd.dgood_ids || [1]).length);
      }
      for (const [k, n] of mint) {
        const v = (c.prices || {})[k] || 0, up = c.upx || 1500, gold = Math.max(up, c.gold || 3000);
        if (v >= gold) msgs.push({kind: "jackpot", seed: k, title: `★ Jackpot! ${nice(c, k)}${n > 1 ? ` ×${n}` : ""}`, body: `Sells ~${int(v)} UPX`});
        else if (v >= up) msgs.push({kind: "big", seed: k, title: `✦ Big mint! ${nice(c, k)}${n > 1 ? ` ×${n}` : ""}`, body: `Sells ~${int(v)} UPX`});
      }
    }
  }
  const last = acts[acts.length - 1];
  await env.AF.put("state", JSON.stringify({seq: last.global_sequence, ts: Date.parse(last.timestamp + "Z") || now}));
  if (msgs.length > 4) {   // a burst: one summary instead of a pile
    await pushAll(env, {title: `${msgs.length} things happened`, body: msgs.slice(0, 6).map(m => m.title.replace(/^\S+\s/, "")).join(" · "), tag: "af-burst"});
  } else for (const m of msgs) await pushAll(env, {title: m.title, body: m.body, tag: "af-" + m.kind + "-" + m.seed + "-" + Date.now(), seed: m.seed, kind: m.kind});
  return {new: acts.length, sent: msgs.length};
}

// Nurseries waiting for approval (the Ledger sends their shop numbers): every 5 minutes, ask Upland whether each is open yet.
// If Upland wants a login to answer, this stops and the Ledger's own check (while it's open) does the job instead.
async function watchShops(env){
  const c = await cfg(env), list = Array.isArray(c.watch) ? c.watch : [];
  if (!list.length || c.watchAuth === false) return {skipped: true};
  const left = [];
  for (const w of list.slice(0, 6)) {
    const r = await fetch("https://api.prod.upland.me/metaventures/secondary-shop/" + (+w.id), {headers: {Accept: "application/json"}}).catch(() => null);
    if (r && (r.status === 401 || r.status === 403)) { await env.AF.put("cfg", JSON.stringify({...c, watchAuth: false})); return {auth: false}; }
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (j && j.isActive !== false && j.ownerId === c.account) await pushAll(env, {title: `🌱 ${w.name || "Your new nursery"} is open`, body: "It's approved and taking listings. Fill shop has already made room for it.", tag: "af-nursery-" + w.id, kind: "note", tab: "prices"});
    else left.push(w);
  }
  if (left.length !== list.length) await env.AF.put("cfg", JSON.stringify({...c, watch: left}));
  return {left: left.length};
}

// ---------- once a day, and the Upland session (v60) ----------
// The Ledger on your computer sends when its Upland session ends (just the date, never the session itself) and a short
// digest of your shelves with its other settings. Every 5 minutes this checks whether a warning or the summary is due.
const DAYMS = 864e5;
function localNow(ms, tz){
  const parts = {}; for (const x of new Intl.DateTimeFormat("en-US", {timeZone: tz || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(new Date(ms))) parts[x.type] = x.value;
  return {day: `${parts.year}-${parts.month}-${parts.day}`, hour: +parts.hour % 24, minute: +parts.minute};
}
async function summaryMsg(env, c, now){
  const lines = [];
  // the last 24 hours from the public ledger: your sales and commission (each payment's transaction tells which)
  try {
    const d = await chain("/v2/history/get_actions", {account: c.account, limit: 500, sort: "desc", after: new Date(now - DAYMS).toISOString().slice(0, 19)});
    const pays = (d.actions || []).filter(a => a.act.account === "upxtokenacct" && a.act.name === "transfer" && a.act.data.to === c.account && a.act.data.from === GAME);
    let own = 0, ownN = 0, com = 0, comN = 0, other = 0;
    for (const a of pays.slice(0, 25)) {
      const s = await saleOf(a.trx_id, c.account).catch(() => null);
      if (!s || s.role === "other") continue;
      if (s.role === "own") { own += s.received; ownN++; } else { com += s.received; comN++; }
    }
    for (const a of pays.slice(25)) other += qty(a.act.data.quantity);
    lines.push(ownN || comN || other ? `${ownN} sale${ownN === 1 ? "" : "s"} · ${int(own + other)} UPX${comN ? ` · +${int(com)} commission` : ""}${pays.length > 25 ? ` (${pays.length} payments)` : ""}` : "No sales in the last 24 hours");
  } catch { lines.push("Couldn't read the ledger for yesterday's sales"); }
  const g = c.digest;
  if (g && g.at && now - g.at < 18 * 3600e3 && (g.shops || []).length) {
    lines.push("Free slots: " + g.shops.map(x => `${x.n} ${x.free}`).join(" · ") + (g.add ? ` · ${g.add} to list` : ""));
    if (g.gen && g.gen[0] && g.gen[0].net > 0) lines.push(`Generating pays at ${g.gen[0].n} (+${int(g.gen[0].net)} per mint)`);
  }
  const q = await env.AF.get("quote", "json");
  if (q && typeof q.p === "number" && now - (q.ms || 0) < 3 * 3600e3) lines.push(`Mint cost ${q.p.toFixed(2)} Sparklet`);
  return {title: "☀️ Alien Farmers this morning", body: lines.join("\n"), tag: "af-summary", kind: "note", tab: "prices"};
}
async function daily(env, now = Date.now()){
  const c = await cfg(env); if (!c.account) return {skipped: true};
  const st = (await env.AF.get("daily", "json")) || {}; let dirty = false;
  const exp = +c.sessionExp || 0;
  if (exp && c.sessWarn !== false) {
    const ended = !!c.sessionEnded || now >= exp;
    if (ended && st.endedFor !== exp) {
      await pushAll(env, {title: "⚠️ Your Upland session ended", body: "Shelves, mint cost and the new-nursery check are paused. Open the Ledger on your computer and reconnect.", tag: "af-session", kind: "note", tab: "prices"});
      st.endedFor = exp; st.warnedFor = exp; dirty = true;
    } else if (!ended && now >= exp - 2 * DAYMS && st.warnedFor !== exp) {
      const h = Math.round((exp - now) / 3600e3);
      await pushAll(env, {title: "⏳ Upland session ends soon", body: `In about ${h >= 36 ? Math.round(h / 24) + " days" : h + " hours"}. Reconnect on your computer so shelves and mint cost stay live.`, tag: "af-session", kind: "note", tab: "prices"});
      st.warnedFor = exp; dirty = true;
    }
  }
  const S = c.summary;
  if (S && S.on) {
    const t = localNow(now, S.tz);
    if (t.hour === +S.hour && t.minute < 20 && st.sumDay !== t.day) { await pushAll(env, await summaryMsg(env, c, now)); st.sumDay = t.day; dirty = true; }
  }
  if (dirty) await env.AF.put("daily", JSON.stringify(st));
  return {ok: true, ...st};
}

const rid = n => { const a = crypto.getRandomValues(new Uint8Array(n)), c = "abcdefghijkmnpqrstuvwxyz23456789"; return [...a].map(x => c[x % c.length]).join(""); };
async function staticFile(path){   // Upland's public 3D files, cached at the edge for a week
  const src = "https://static.upland.me/" + path, cache = caches.default, key = new Request(src);
  let r = await cache.match(key);
  if (!r) {
    const u = await fetch(src);
    if (!u.ok) return new Response(null, {status: u.status, headers: CORS});
    r = new Response(u.body, {status: 200, headers: {"Content-Type": u.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "public, max-age=604800"}});
    await cache.put(key, r.clone());
  }
  const h = new Headers(r.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(r.body, {status: 200, headers: h});
}

// ---------- web endpoints used by the Ledger ----------
export default {
  async fetch(req, env){
    if (req.method === "OPTIONS") return new Response(null, {headers: CORS});
    const url = new URL(req.url), p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (p === "/" || p === "/status") {
        const c = await cfg(env), subs = (await env.AF.get("subs", "json")) || [], st = (await env.AF.get("state", "json")) || {};
        return json({ok: true, app: "alien-farmers-alerts", v: VERSION, claimed: !!c.key, account: c.account || null, phones: subs.length, lastSeen: st.ts ? new Date(st.ts).toISOString() : null});
      }
      if (p === "/vapid") return json({key: (await vapidKeys(env)).pub});
      if (p === "/quote" && req.method === "GET") {   // your latest live mint quote, as your connected browser last read it (public: it's only a price)
        const q = await env.AF.get("quote", "json");
        return new Response(JSON.stringify(q || {}), {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
      }
      if (p === "/up") {   // read-only pass-through to Upland's public property API, for the Ledger's lot finder (browsers may block it)
        if (!(await owner(env, url.searchParams.get("k")))) return json({error: "not yours"}, 403);
        const path = url.searchParams.get("path") || "";
        if (!/^\/api\/(map\?[\w=&.\-]+|properties\/\d+|profile\/[\w.\-]+)$/.test(path)) return json({error: "not allowed"}, 400);
        const r = await fetch("https://api.prod.upland.me" + path, {headers: {Accept: "application/json"}});
        return new Response(await r.text(), {status: r.status, headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=60"}});
      }
      if (p === "/pubup") {   // the same read-only pass-through for visitors to the public site: Upland's public map, lot and shop pages, cached 10 minutes
        const path = url.searchParams.get("path") || "";
        if (!/^\/(api\/(map\?[\w=&.\-]+|properties\/\d+|profile\/[\w.\-]+)|metaventures\/secondary-shop\/\d+)$/.test(path)) return json({error: "not allowed"}, 400);
        const src = "https://api.prod.upland.me" + path, cache = caches.default, key = new Request(src);
        let r = await cache.match(key);
        if (!r) {
          const u = await fetch(src, {headers: {Accept: "application/json"}});
          if (!u.ok) return new Response(await u.text(), {status: u.status, headers: {...CORS, "Content-Type": "application/json"}});
          r = new Response(await u.text(), {status: 200, headers: {"Content-Type": "application/json", "Cache-Control": "public, max-age=600"}});
          await cache.put(key, r.clone());
        }
        const h = new Headers(r.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v);
        return new Response(r.body, {status: 200, headers: h});
      }
      if (p.startsWith("/st/")) {   // read-only pass-through to Upland's 3D files (models and their pictures), for the Ledger's nursery tours
        const m = /^\/st\/([^/]+)\/(3d-models\/[\w\-./%]+\.(gltf|glb|bin|jpe?g|png|webp|ktx2))$/i.exec(p);
        if (!m || m[2].includes("..")) return json({error: "not allowed"}, 400);
        if (!(await owner(env, decodeURIComponent(m[1])))) return json({error: "not yours"}, 403);
        return staticFile(m[2]);
      }
      if (p.startsWith("/pub/")) {   // the same 3D files for people opening an Alien Farmers share link (Upland's public files, nothing of yours)
        const m = /^\/pub\/(3d-models\/[\w\-./%]+\.(gltf|glb|bin|jpe?g|png|webp|ktx2))$/i.exec(p);
        if (!m || m[1].includes("..")) return json({error: "not allowed"}, 400);
        return staticFile(m[1]);
      }
      if (p.startsWith("/s/") && req.method === "GET") {   // a shared build, readable by anyone with the link
        const id = p.slice(3); if (!/^[a-z0-9]{6,16}$/.test(id)) return json({error: "not found"}, 404);
        const v = await env.AF.get("share:" + id); if (!v) return json({error: "This share link was removed."}, 404);
        return new Response(v, {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=30"}});
      }
      if (p === "/site/meta" && req.method === "GET") {   // the public copy of your Ledger: when it was made, so visitors know if theirs is old
        const m = await env.AF.get("site:meta", "json");
        return new Response(JSON.stringify(m || {at: 0}), {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
      }
      if (p === "/site/snap" && req.method === "GET") {   // the copy itself (gzipped JSON), readable by anyone who opens your site
        const v = await env.AF.get("site:snap", "arrayBuffer"); if (!v) return json({error: "not published"}, 404);
        return new Response(v, {headers: {...CORS, "Content-Type": "application/octet-stream", "Cache-Control": "no-store"}});
      }
      if (p === "/site/snap.json" && req.method === "GET") {   // the same copy for browsers that can't unzip it themselves: sent gzip-encoded, the browser unpacks it
        const v = await env.AF.get("site:snap", "arrayBuffer"); if (!v) return json({error: "not published"}, 404);
        return new Response(v, {encodeBody: "manual", headers: {...CORS, "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store"}});
      }
      if (p === "/site/save" && req.method === "POST") {   // only your own Ledger (the browser that owns this helper) can publish
        if (!(await owner(env, req.headers.get("x-af-key")))) return json({error: "This helper belongs to someone else, or isn't set up yet."}, 403);
        const buf = await req.arrayBuffer(); if (buf.byteLength > 24e6) return json({error: "too big"}, 413);
        let meta = {}; try { meta = JSON.parse(req.headers.get("x-af-meta") || "{}"); } catch {}
        const m = {at: Date.now(), size: buf.byteLength, account: String(meta.account || "").slice(0, 20), user: String(meta.user || "").slice(0, 40), hto: String(meta.hto || "").slice(0, 25)};
        await env.AF.put("site:snap", buf); await env.AF.put("site:meta", JSON.stringify(m)); return json({ok: true, ...m});
      }
      if (p === "/shelves" && req.method === "GET") {   // v64: a nursery's real shelves, read from Upland's public shop pages (no login), cached 60 s
        const id = +(url.searchParams.get("id") || 0); if (!(id > 0 && id < 1e7)) return json({error: "bad id"}, 400);
        const cache = caches.default, ck = new Request("https://af.internal/shelves/" + id);
        const hit = await cache.match(ck); if (hit) { const h = new Headers(hit.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v); return new Response(hit.body, {status: 200, headers: h}); }
        const KEEP = ["dGoodId", "tokenDisplayName", "askingPrice", "currency", "ownerUserName", "ownerId", "status", "listingApprovedAt", "createdAt", "displayIndex", "mintNumber", "shopId"];
        const items = []; let st = 0, pages = 0;
        for (let off = 0; off < 400; off += 40) {
          const r = await fetch(`https://api.prod.upland.me/metaventures/secondary-shop/${id}/items`, {method: "POST", headers: {Accept: "application/json", "Content-Type": "application/json"}, body: JSON.stringify({offset: off, limit: 40})});
          st = r.status; pages++; if (!r.ok) break;
          const j = await r.json().catch(() => null), L = Array.isArray(j) ? j : j && Array.isArray(j.items) ? j.items : null; if (!L) break;
          for (const x of L) { const o = {}; for (const k of KEEP) if (x && x[k] !== undefined) o[k] = x[k]; items.push(o); }
          if (L.length < 40) break;
        }
        if (!items.length && st >= 300) return json({error: "Upland answered " + st, status: st}, 502);
        const body = JSON.stringify({id, at: Date.now(), n: items.length, items});
        await cache.put(ck, new Response(body, {headers: {"Content-Type": "application/json", "Cache-Control": "public, max-age=60"}}));
        return new Response(body, {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
      }
      if (p === "/shops" && req.method === "GET") {   // v66: up to 40 public shop pages in one call (the Find tab's nursery list); owner only, cached 10 minutes
        if (!(await owner(env, url.searchParams.get("k")))) return json({error: "not yours"}, 403);
        const from = Math.floor(+(url.searchParams.get("from") || 0)), n = Math.min(40, Math.max(1, Math.floor(+(url.searchParams.get("n") || 40)) || 40));
        if (!(from > 0 && from < 1e7)) return json({error: "bad from"}, 400);
        const cache = caches.default, ck = new Request(`https://af.internal/shops/${from}/${n}`);   // one cache entry per call: 40 reads + 2 cache calls stay under the free plan's 50 subrequests
        const hit = await cache.match(ck); if (hit) return new Response(await hit.text(), {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
        const shops = [], none = [], held = [], down = [];
        const one = async id => {
          let u; try { u = await fetch("https://api.prod.upland.me/metaventures/secondary-shop/" + id, {headers: {Accept: "application/json"}}); } catch { down.push(id); return; }
          if (u.status === 401 || u.status === 403) { held.push(id); return; }
          if (u.status === 429 || u.status >= 500) { down.push(id); return; }
          const j = u.ok ? await u.json().catch(() => null) : null;
          if (!j || typeof j !== "object" || (j.name == null && j.ownerId == null)) { none.push(id); return; }
          const s = j.settings || {};
          shops.push({id, name: String(j.name || "").slice(0, 80), ownerId: j.ownerId || "", propertyId: j.propertyId != null ? String(j.propertyId) : null, lat: j.lat != null ? +j.lat : null, lng: j.lng != null ? +j.lng : null,
            cityId: j.cityId != null ? j.cityId : null, active: !(j.isActive === false || j.active === false), cap: +s.itemCapacity > 0 ? +s.itemCapacity : +j.capacity > 0 ? +j.capacity : null,
            vacant: typeof s.vacantSpots === "number" ? s.vacantSpots : null});
        };
        const ids = Array.from({length: n}, (_, i) => from + i);
        for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(one));
        shops.sort((a, b) => a.id - b.id);
        const body = JSON.stringify({from, n, at: Date.now(), shops, none, held, down});
        if (!down.length) await cache.put(ck, new Response(body, {headers: {"Content-Type": "application/json", "Cache-Control": "public, max-age=600"}}));
        return new Response(body, {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
      }
      if (p === "/dir" && req.method === "GET") {   // v66: the nursery list the owner's Ledger built (every shop on Upland, compact), for his other devices and visitors
        const v = await env.AF.get("dir", {cacheTtl: 300});
        return new Response(v || JSON.stringify({v: 1, at: 0, rows: []}), {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
      }
      if (p === "/probe") {   // v62: can the helper read Upland's shop pages, shelves, Generate screen and quote with no login at all?
        const id = +(url.searchParams.get("id") || 8207) || 8207;
        const up = async (path, body) => { try { const r = await fetch("https://api.prod.upland.me" + path, {method: body ? "POST" : "GET", headers: {Accept: "application/json", ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify(body) : undefined});
          let j = null; try { j = await r.json(); } catch {} return {status: r.status, j}; } catch (e) { return {status: 0, err: String(e && e.message || e)}; } };
        const [info, items, itemsGet, wait, det, q] = await Promise.all([up(`/metaventures/secondary-shop/${id}`), up(`/metaventures/secondary-shop/${id}/items`, {offset: 0, limit: 40}),
          up(`/metaventures/secondary-shop/${id}/items?offset=0&limit=40`), up(`/metaventures/secondary-shop/${id}/items/waiting-for-approval?offset=0&limit=40`), up(`/life/seed-generation/details/${id}`), up("/life/seed-generation/transaction")]);
        const n = x => Array.isArray(x.j) ? x.j.length : x.j && Array.isArray(x.j.items) ? x.j.items.length : null, why = x => x.j && !Array.isArray(x.j) ? (x.j.code || x.j.message || x.j.error || "") : x.err || "";
        return json({shop: id, info: {status: info.status, name: info.j && info.j.name, slots: info.j && info.j.settings && info.j.settings.itemCapacity, why: info.status >= 300 ? why(info) : ""},
          shelves: {status: items.status, listings: n(items), why: items.status >= 300 ? why(items) : ""}, shelvesGet: {status: itemsGet.status, listings: n(itemsGet)},
          waiting: {status: wait.status, listings: n(wait)}, generate: {status: det.status, price: det.j && det.j.price, why: det.status >= 300 ? why(det) : ""}, quote: {status: q.status, why: q.status >= 300 ? why(q) : ""}});
      }
      if (p === "/live" && req.method === "GET") {   // the newest shelves and mint cost from your Game link (the same things the public copy shows)
        const hit = await caches.default.match(new Request("https://af.internal/live"));
        const v = hit ? await hit.text() : await env.AF.get("live");
        return new Response(v || "{}", {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "no-store"}});
      }
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      if (p === "/live") {   // from the snippet in your game tab, with its link key (not your owner code)
        const c = await cfg(env); if (!c.liveKey || body.k !== c.liveKey) return json({error: "not yours"}, 403);
        if (!body.msg || body.msg.type !== "af-live") return json({error: "bad"}, 400);
        const txt = JSON.stringify({at: Date.now(), msg: body.msg}); if (txt.length > 4e6) return json({error: "too big"}, 413);
        await caches.default.put(new Request("https://af.internal/live"), new Response(txt, {headers: {"Content-Type": "application/json", "Cache-Control": "max-age=900"}}));
        const old = await env.AF.get("live", "json").catch(() => null);
        if (!old || Date.now() - (old.at || 0) > 10 * 60e3) await env.AF.put("live", txt);
        return json({ok: true});
      }
      if (p === "/claim") {   // the first browser to claim the helper owns it
        const c = await cfg(env);
        if (c.key && c.key !== body.key) return json({error: "This helper already belongs to another browser. Use the code from that browser, or make a new helper."}, 403);
        if (!body.key || body.key.length < 24) return json({error: "bad code"}, 400);
        await env.AF.put("cfg", JSON.stringify({...c, key: body.key})); return json({ok: true});
      }
      if (!(await owner(env, body.key))) return json({error: "This helper belongs to someone else, or isn't set up yet."}, 403);
      if (p === "/config") {
        const c = await cfg(env), keep = ["account", "prices", "seeds", "names", "upx", "gold", "sales", "commission", "mints", "subject", "watch", "summary", "sessWarn", "sessionExp", "sessionEnded", "digest", "liveKey"];
        const next = {...c}; for (const k of keep) if (body[k] !== undefined) next[k] = body[k];
        if (c.account !== next.account) await env.AF.delete("state");
        await env.AF.put("cfg", JSON.stringify(next)); return json({ok: true});
      }
      if (p === "/subscribe") {
        const subs = ((await env.AF.get("subs", "json")) || []).filter(s => s.endpoint !== body.sub.endpoint);
        subs.push({endpoint: body.sub.endpoint, keys: body.sub.keys, at: Date.now(), name: body.name || ""});
        await env.AF.put("subs", JSON.stringify(subs.slice(-10))); return json({ok: true, phones: subs.length});
      }
      if (p === "/unsubscribe") {
        const subs = ((await env.AF.get("subs", "json")) || []).filter(s => s.endpoint !== body.endpoint);
        await env.AF.put("subs", JSON.stringify(subs)); return json({ok: true, phones: subs.length});
      }
      if (p === "/quote") {   // the owner's browser sends its live quote when it changes (and every 15 minutes)
        const q = {p: typeof body.p === "number" ? body.p : null, ms: +body.ms || Date.now(), err: String(body.err || "").slice(0, 120), at: Date.now()};
        await env.AF.put("quote", JSON.stringify(q)); return json({ok: true});
      }
      if (p === "/notify") {   // a one-off push from the Ledger (a new nursery opened)
        const title = String(body.title || "").slice(0, 80); if (!title) return json({error: "no title"}, 400);
        return json({ok: true, phones: await pushAll(env, {title, body: String(body.body || "").slice(0, 200), tag: "af-note-" + String(body.tag || Date.now()).slice(0, 40), kind: "note", tab: String(body.tab || "").slice(0, 12)})});
      }
      if (p === "/test") return json({ok: true, phones: await pushAll(env, {title: "🛸 Alien Farmers alerts are on", body: "Sales, commission and big mints will show up here, even with the Ledger closed.", tag: "af-test"})});
      if (p === "/check") return json(await check(env));
      if (p === "/summary") { const msg = await summaryMsg(env, await cfg(env), Date.now()); return json({ok: true, msg, phones: body.send ? await pushAll(env, msg) : 0}); }
      if (p === "/share") {   // publish one build as a read-only link
        const data = JSON.stringify(body.data || null); if (data.length > 1500000) return json({error: "That build is too big to share."}, 413);
        if (!body.data || body.data.brand !== "Alien Farmers") return json({error: "bad share"}, 400);
        const id = body.id && /^[a-z0-9]{6,16}$/.test(body.id) && (await env.AF.get("share:" + body.id)) ? body.id : rid(10);
        await env.AF.put("share:" + id, data);
        const list = ((await env.AF.get("shares", "json")) || []).filter(x => x.id !== id);
        list.unshift({id, title: body.data.lot && body.data.lot.title || "", design: body.data.design && body.data.design.name || "", at: Date.now()});
        await env.AF.put("shares", JSON.stringify(list.slice(0, 200))); return json({ok: true, id});
      }
      if (p === "/shares") return json({ok: true, list: (await env.AF.get("shares", "json")) || []});
      if (p === "/unshare") {
        if (!/^[a-z0-9]{6,16}$/.test(body.id || "")) return json({error: "bad id"}, 400);
        await env.AF.delete("share:" + body.id);
        await env.AF.put("shares", JSON.stringify(((await env.AF.get("shares", "json")) || []).filter(x => x.id !== body.id))); return json({ok: true});
      }
      if (p === "/site/off") { await env.AF.delete("site:snap"); await env.AF.delete("site:meta"); return json({ok: true}); }
      if (p === "/dir/save") {   // v66: the nursery list from the owner's Ledger; at most every 10 minutes (KV's free plan: 1000 writes a day)
        const d = body.dir; if (!d || !Array.isArray(d.rows) || d.rows.length > 100000) return json({error: "bad list"}, 400);
        const txt = JSON.stringify({v: 1, at: Date.now(), full: +d.full || 0, top: +d.top || 0, rows: d.rows, nm: d.nm && typeof d.nm === "object" ? d.nm : {}});
        if (txt.length > 8e6) return json({error: "too big"}, 413);
        const m = (await env.AF.get("dir:at", "json")) || {}; if (Date.now() - (m.at || 0) < 10 * 60e3) return json({ok: false, wait: true, at: m.at || 0});
        await env.AF.put("dir", txt); await env.AF.put("dir:at", JSON.stringify({at: Date.now(), n: d.rows.length})); return json({ok: true, n: d.rows.length});
      }
      if (p === "/cloud/save") {   // your build designs and names, kept here so they survive a new browser or phone
        if (!/^[a-z0-9:_-]{1,40}$/i.test(body.name || "")) return json({error: "bad name"}, 400);
        const data = JSON.stringify(body.data === undefined ? null : body.data); if (data.length > 5000000) return json({error: "too big"}, 413);
        const at = Date.now(); await env.AF.put("cloud:" + body.name, JSON.stringify({at, data: body.data})); return json({ok: true, at});
      }
      if (p === "/cloud/load") {
        if (!/^[a-z0-9:_-]{1,40}$/i.test(body.name || "")) return json({error: "bad name"}, 400);
        const v = await env.AF.get("cloud:" + body.name, "json"); return json({ok: true, at: v ? v.at : 0, data: v ? v.data : null});
      }
      return json({error: "not found"}, 404);
    } catch (e) { return json({error: String(e && e.message || e)}, 500); }
  },
  async scheduled(event, env, ctx){ ctx.waitUntil(check(env).catch(() => {})); if (new Date().getUTCMinutes() % 5 === 0) { ctx.waitUntil(watchShops(env).catch(() => {})); ctx.waitUntil(daily(env).catch(() => {})); } }
};
