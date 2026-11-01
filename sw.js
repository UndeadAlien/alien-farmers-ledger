// Alien Farmers Ledger service worker: makes the Ledger installable, opens instantly, and shows phone alerts.
const V = "af-70b";
// v63: pages of the site. index.html and nursery3d.html (the 3D tour / Build mode page) open from the network first and
// fall back to their last copy offline; the 3D page's modules (lot3d.js, builder.js, sheet.js) the same way.
// v66: the Nursery Aligner page (aligner.html) and its files (aligner/math.js, place.js, place2.js, ui.js, example.json) too.
const PAGES = {"": "./", "index.html": "./", "nursery3d.html": "./nursery3d.html", "aligner.html": "./aligner.html"};
const MODS = /\/(lot3d|builder|sheet)\.js$|\/aligner\/(math|place|place2|ui)\.js$|\/aligner\/example\.json$/;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  // the page: always try the network first (so updates show), fall back to the last copy when offline
  const page = PAGES[u.pathname.replace(/^.*\//, "")];
  if (r.mode === "navigate" && page == null) return;   // other pages (share links) go straight to the network
  if (r.mode === "navigate") { e.respondWith(fetch(r).then(res => { const c = res.clone(); if (res.ok) caches.open(V).then(x => x.put(page, c)); return res; }).catch(() => caches.match(page))); return; }
  if (MODS.test(u.pathname)) { e.respondWith(fetch(r).then(res => { const c = res.clone(); if (res.ok) caches.open(V).then(x => x.put(r, c)); return res; }).catch(() => caches.match(r))); return; }
  // pictures and icons: from the cache right away, refreshed in the background
  if (/\/(seeds|icons|vendor\/three)\//.test(u.pathname)) e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(r); const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
    return hit || net; }));
});
// alerts from the helper (or from the Ledger itself)
self.addEventListener("push", e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = {title: "Alien Farmers", body: e.data ? e.data.text() : ""}; }
  const big = m.kind === "jackpot" || m.kind === "big";
  e.waitUntil(self.registration.showNotification(m.title || "Alien Farmers", {
    body: m.body || "", tag: m.tag || "af", renotify: true, icon: "icons/icon-192.png", badge: "icons/badge-96.png",
    data: {seed: m.seed || "", kind: m.kind || "", tab: m.tab || ""}, requireInteraction: m.kind === "jackpot",
    vibrate: m.kind === "jackpot" ? [300, 120, 300, 120, 600] : big ? [200, 100, 200] : [120, 60, 120]}));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {}, tab = d.tab || (d.kind === "sale" || d.kind === "com" ? "sales" : d.kind === "note" ? "nurs" : "stock");
  const url = new URL(`./?tab=${tab}${d.seed ? "&open=" + encodeURIComponent(d.seed) : ""}`, self.registration.scope).href;
  e.waitUntil((async () => {
    for (const c of await clients.matchAll({type: "window", includeUncontrolled: true})) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({type: "af-open", tab, seed: d.seed}); return; }
    }
    await clients.openWindow(url);
  })());
});
