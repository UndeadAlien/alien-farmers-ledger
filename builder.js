// Alien Farmers Ledger · Build mode (v54)
// Lay out a lot in 3D with Upland's own models, snapping the way Upland does (side to side, edges lined up, turned to match),
// then follow the build list in the game. Designs are saved per lot.
const DEG = Math.PI / 180;
const LAYER_NAME = {flat: "flat (paths, pavers)", plant: "plants", default: "decor and buildings"};
const KIND_GROUP = k => /plant/.test(k) ? "plants" : /nursery|building/.test(k) ? "buildings" : /car/.test(k) ? "vehicles" : "decor";
const uid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const wrapA = a => { a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a; };
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const bearing = (dx, dz) => COMPASS[Math.round(((Math.atan2(dx, -dz) / DEG + 360) % 360) / 45) % 8];

// ---------- geometry ----------
// world offset of a local (lx, lz) for a holder turned by yaw (three.js rotation.y)
const toWorld = (it, lx, lz) => { const c = Math.cos(it.yaw), s = Math.sin(it.yaw); return [it.x + lx * c + lz * s, it.z - lx * s + lz * c]; };
const toLocal = (b, x, z) => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
const corners = it => [[-it.hx, -it.hz], [it.hx, -it.hz], [it.hx, it.hz], [-it.hx, it.hz]].map(([a, b]) => toWorld(it, a, b));
function overlap(a, b, tol = .02){   // two turned rectangles (SAT)
  const A = corners(a), B = corners(b);
  for (const P of [A, B]) for (let i = 0; i < 2; i++) {
    const [x1, z1] = P[i], [x2, z2] = P[i + 1], nx = -(z2 - z1), nz = x2 - x1, L = Math.hypot(nx, nz) || 1;
    const pa = A.map(([x, z]) => (x * nx + z * nz) / L), pb = B.map(([x, z]) => (x * nx + z * nz) / L);
    if (Math.max(...pa) <= Math.min(...pb) + tol || Math.max(...pb) <= Math.min(...pa) + tol) return false;
  }
  return true;
}
const inRing = (x, z, R) => { let ins = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins; } return ins; };
const sameLayer = (a, b) => a.layer === b.layer;

// Upland-style snapping: line up with a neighbour (turned to match, side to side, edges or centres lined up), else the lot edge
function snapPose(it, others, ring, T){
  let best = null;
  const tryCand = (c) => { if (!best || c.cost < best.cost) best = c; };
  for (const b of others) {
    if (!sameLayer(it, b)) continue;
    const reach = Math.hypot(it.hx, it.hz) + Math.hypot(b.hx, b.hz) + T;
    if (Math.hypot(it.x - b.x, it.z - b.z) > reach) continue;
    const k = Math.round((it.yaw - b.yaw) / (Math.PI / 2)), dy = wrapA(it.yaw - (b.yaw + k * Math.PI / 2));
    if (Math.abs(dy) > 14 * DEG) continue;
    const yaw = b.yaw + k * Math.PI / 2, odd = Math.abs(k) % 2 === 1, ax = odd ? it.hz : it.hx, az = odd ? it.hx : it.hz;
    const [u, v] = toLocal(b, it.x, it.z);
    const alignU = [0, b.hx - ax, -(b.hx - ax)], alignV = [0, b.hz - az, -(b.hz - az)];
    const near = (val, list) => { let r = null; for (const c of list) if (Math.abs(val - c) < T && (!r || Math.abs(val - c) < Math.abs(val - r))) r = c; return r; };
    // side by side across u (east/west faces of the neighbour), lined up along v
    for (const uc of [b.hx + ax, -(b.hx + ax)]) {
      if (Math.abs(u - uc) >= T || Math.abs(v) > b.hz + az) continue;
      const vc = near(v, alignV), vv = vc == null ? v : vc;
      tryCand({b, yaw, u: uc, v: vv, cost: Math.abs(u - uc) + (vc == null ? .2 : Math.abs(v - vc)), side: uc > 0 ? "u+" : "u-", aligned: vc != null});
    }
    for (const vc0 of [b.hz + az, -(b.hz + az)]) {
      if (Math.abs(v - vc0) >= T || Math.abs(u) > b.hx + ax) continue;
      const uc = near(u, alignU), uu = uc == null ? u : uc;
      tryCand({b, yaw, u: uu, v: vc0, cost: Math.abs(v - vc0) + (uc == null ? .2 : Math.abs(u - uc)), side: vc0 > 0 ? "v+" : "v-", aligned: uc != null});
    }
  }
  if (best) {
    const b = best.b, [x, z] = toWorld(b, best.u, best.v);
    const dx = x - b.x, dz = z - b.z;
    return {x, z, yaw: best.yaw, to: b.id, dir: bearing(dx, dz), aligned: best.aligned, guide: guideFor({x, z, yaw: best.yaw, hx: it.hx, hz: it.hz}, b)};
  }
  // the lot edge: turn square to it (within 10°) and sit flush inside it
  let le = null;
  if (ring && ring.length > 2) {
    const R = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    const cx = R.reduce((a, p) => a + p[0], 0) / R.length, cz = R.reduce((a, p) => a + p[1], 0) / R.length;
    for (let i = 0; i < R.length; i++) {
      const [x1, z1] = R[i], [x2, z2] = R[(i + 1) % R.length], ex = x2 - x1, ez = z2 - z1, L = Math.hypot(ex, ez); if (L < .5) continue;
      const th = Math.atan2(ez, ex), k = Math.round((-th - it.yaw) / (Math.PI / 2)), yaw = -th - k * Math.PI / 2;
      if (Math.abs(wrapA(it.yaw - yaw)) > 10 * DEG) continue;
      let nx = -ez / L, nz = ex / L; if ((cx - x1) * nx + (cz - z1) * nz < 0) { nx = -nx; nz = -nz; }   // inward
      const d = (it.x - x1) * nx + (it.z - z1) * nz, c = Math.cos(yaw), s = Math.sin(yaw);
      const e = Math.abs(nx * c - nz * s) * it.hx + Math.abs(nx * s + nz * c) * it.hz;   // half size across the edge
      const t = ((it.x - x1) * ex + (it.z - z1) * ez) / (L * L);
      if (Math.abs(d - e) >= T || t < -.05 || t > 1.05) continue;
      const cost = Math.abs(d - e) + .05;
      if (!le || cost < le.cost) le = {cost, x: it.x + (e - d) * nx, z: it.z + (e - d) * nz, yaw, edge: i, seg: [R[i], R[(i + 1) % R.length]]};
    }
  }
  if (le) return {x: le.x, z: le.z, yaw: le.yaw, to: "edge:" + le.edge, dir: null, guide: [le.seg]};
  return null;
}
function guideFor(a, b){   // the shared edge, drawn while snapped
  const A = corners(a), B = corners(b), segs = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const a1 = A[i], a2 = A[(i + 1) % 4], b1 = B[j], b2 = B[(j + 1) % 4];
    const mid = [(a1[0] + a2[0]) / 2, (a1[1] + a2[1]) / 2], mb = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2];
    const dA = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]), cross = Math.abs((a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]));
    if (cross < 1e-3 * dA * Math.hypot(b2[0] - b1[0], b2[1] - b1[1]) + 1e-6 && Math.abs((mb[0] - mid[0]) * (a2[1] - a1[1]) - (mb[1] - mid[1]) * (a2[0] - a1[0])) / (dA || 1) < .03) segs.push([a1, a2]);
  }
  return segs.length ? [segs[0]] : [];
}

// ---------- the Build mode controller ----------
export function createBuilder(H){
  const $ = id => document.getElementById(id);
  const esc = H.esc, int = H.int;
  const S = {on: false, v: null, n: null, prop: null, D: null, d: null, orig: new Map(), added: new Map(), sel: [], drag: null, arm: null, snap: H.store.get("af:bldSnap", true),
    undo: [], redo: [], src: "all", q: "", grp: "", listOn: false, cat: H.store.get("af:catalog", {v: 1, items: {}}), thumbs: H.store.get("af:thumbs", {}), names: H.store.get("af:catNames", {}),
    busy: false, thumbQ: [], thumbBusy: false, plan: false, unlocked: new Set(), dims: {}};
  const saveCat = () => H.store.set("af:catalog", S.cat), saveThumbs = () => H.store.set("af:thumbs", S.thumbs);
  const designsAll = () => H.store.get("af:designs", {});
  const saveDesigns = () => { const all = designsAll(); S.D.ms = Date.now(); all[S.prop] = S.D; H.store.set("af:designs", all); H.onSave && H.onSave(); };

  // ---------- catalog ----------
  const keyOf = m => { const L = m.lods && (m.lods["0"] || m.lods[Object.keys(m.lods)[0]]); return String((L && (L.modelUrl || L.model)) || m.model || "").replace(/^\/+/, ""); };
  const slim = m => ({lods: m.lods, model: m.model, size: m.size, scale: m.scale, meshes: m.meshes, modelType: m.modelType, subType: m.subType, metadata: m.metadata && m.metadata.name ? {name: m.metadata.name} : undefined,
    rotate: [m.rotate ? +m.rotate[0] : Math.PI / 2, 0, m.rotate ? +m.rotate[2] || 0 : 0], extensions: (m.extensions || []).filter(e => e.type === "airpin"), name: m.name, _fit: m._fit, _fitRef: m._fitRef});
  function catAdd(m, src){
    const k = keyOf(m); if (!k || /wireframe/i.test(k)) return null;
    const e = S.cat.items[k] || (S.cat.items[k] = {k, m: slim(m), seen: 0, mine: 0, wallet: 0, lots: {}, src: {}});
    if (src.wallet != null) e.wallet = src.wallet;
    if (src.name && !e.m.name) e.m.name = src.name;
    if (!e.m.meshes && m.meshes) e.m.meshes = m.meshes;
    if (!(e.m.size && e.m.size[0] > 0) && m.size && m.size[0] > 0) e.m.size = m.size;
    e.src[src.kind || "map"] = 1;
    return e;
  }
  // counts are set, not added, so reading the same lot again never double counts
  function catFromProps(props, mineSet){
    for (const p of props || []) {
      const pid = String(p.prop_id), mine = mineSet.has(pid), tally = new Map();
      for (const m of p.models || []) { const e = catAdd(m, {kind: mine ? "mine" : "map"}); if (e) tally.set(e, (tally.get(e) || 0) + 1); }
      for (const [e, c] of tally) { e.lots[pid] = c; e.seen = Object.keys(e.lots).length; e.mine = Object.keys(e.lots).filter(id => mineSet.has(id)).length; }
    }
  }
  function rebuildFromCache(){
    const mine = H.mineSet();
    for (const props of H.allMaps()) catFromProps(props, mine);
    saveCat();
  }
  const entryName = e => S.names[e.k] || e.m.name || H.nameOf(e.m);
  const locked = o => /^(nursery|building)$/.test(o.userData.kind) && !S.unlocked.has(o.userData.id);
  function applyNames(){   // names from your wallet or your own renames, on everything in the scene
    if (!S.v) return;
    for (const o of S.v.editable()) { const k = keyOfObj(o), e = S.cat.items[k]; const nm = S.names[k] || (e && e.m.name) || (o.userData.m && o.userData.m.name); if (nm) o.userData.name = nm; }
  }
  const entryKind = e => H.kindOf(e.m);
  const dims = e => { const s = (e.m.size || []).map(Number); return s[0] > 0 && s[1] > 0 ? `${s[0].toFixed(1)} × ${s[1].toFixed(1)} m` : ""; };
  function seedEntries(){
    return H.seeds().map(sd => {
      const tree = /tree|palm|willow|magnolia|maple|birch|pine|walnut|avocado|apple|lemon|olive|cherry|orange|peach/i.test(sd.name), shrub = /boxwood|arborvitae|forsythia|blueberry|bougainvillea|monstera|hydrangea|bush|shrub/i.test(sd.name);
      const fit = /palm/i.test(sd.name) ? 6 : tree ? 4 : shrub ? 1.4 : .6;
      const k = "local:" + sd.url;
      return S.cat.items[k] || {k, m: {name: sd.name, modelType: "plant", subType: sd.name, lods: {0: {modelUrl: "local:" + sd.url}}, rotate: [Math.PI / 2, 0, 0], size: [fit, fit, 0], _fit: fit, _fitRef: "local:" + sd.url}, seen: 0, mine: 0, wallet: sd.n || 0, lots: {}, src: {seed: 1}, local: true};
    });
  }
  function libraryList(){
    let L = Object.values(S.cat.items);
    const plantsSeen = new Set(L.filter(e => entryKind(e) === "plant").map(e => entryName(e).toLowerCase()));
    if (S.src === "seeds" || S.src === "all") L = L.concat(seedEntries().filter(e => !plantsSeen.has(entryName(e).toLowerCase()) && !S.cat.items[e.k]));
    if (S.src === "lot") L = L.filter(e => e.lots[S.prop]);
    else if (S.src === "mine") L = L.filter(e => e.mine);
    else if (S.src === "map") L = L.filter(e => e.seen && !e.mine);
    else if (S.src === "seeds") L = L.filter(e => entryKind(e) === "plant");
    if (S.grp) L = L.filter(e => KIND_GROUP(entryKind(e)) === S.grp || (S.grp === "flat" && (e.m.size || [])[2] > 0 && +(e.m.size || [])[2] <= .155));
    if (S.q) { const q = S.q.toLowerCase(); L = L.filter(e => entryName(e).toLowerCase().includes(q) || e.k.toLowerCase().includes(q)); }
    return L.sort((a, b) => (b.wallet > 0) - (a.wallet > 0) || (b.lots[S.prop] || 0) - (a.lots[S.prop] || 0) || b.mine - a.mine || b.seen - a.seen || entryName(a).localeCompare(entryName(b)));
  }
  function renderLib(){
    const L = libraryList(), counts = {all: 0, lot: 0, mine: 0, map: 0, seeds: 0, wallet: 0};
    for (const e of Object.values(S.cat.items)) { counts.all++; if (e.lots[S.prop]) counts.lot++; if (e.mine) counts.mine++; if (e.seen && !e.mine) counts.map++; if (entryKind(e) === "plant") counts.seeds++; if (e.wallet > 0) counts.wallet++; }
    document.querySelectorAll("#bldSrc button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.src === S.src)); const c = b.querySelector("em"); if (c) c.textContent = b.dataset.src === "seeds" ? "" : counts[b.dataset.src] || ""; });
    document.querySelectorAll("#bldGrp button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.grp === S.grp)));
    $("bldGrid").innerHTML = L.slice(0, 240).map(e => {
      const th = S.thumbs[e.k], nm = entryName(e), here = e.lots[S.prop] || 0;
      return `<button type="button" class="bld-tile${S.arm && S.arm.k === e.k ? " on" : ""}" data-bk="${esc(e.k)}" title="${esc(nm)}${dims(e) ? " · " + dims(e) : ""}">
        <span class="bt-img">${th ? `<img src="${th}" alt="">` : `<i class="bt-ph"></i>`}</span><b>${esc(nm)}</b>
        <span class="bt-meta">${[dims(e), here ? `${here} here` : "", e.wallet ? `${e.wallet} in wallet` : ""].filter(Boolean).join(" · ") || (e.local ? "seed" : `seen ${e.seen}×`)}</span></button>`;
    }).join("") || `<p class="note" style="margin:8px">Nothing here yet. Collect from your lots or the map below.</p>`;
    $("bldLibN").textContent = `${int(L.length)} item${L.length === 1 ? "" : "s"}`;
    queueThumbs(L.slice(0, 240));
  }
  function queueThumbs(L){
    for (const e of L) if (!S.thumbs[e.k] && !e._tq && !e._tf) { e._tq = 1; S.thumbQ.push(e); }
    if (!S.thumbBusy) pumpThumbs();
  }
  async function pumpThumbs(){
    S.thumbBusy = true; let n = 0;
    while (S.thumbQ.length && S.on) {
      const e = S.thumbQ.shift(); e._tq = 0;
      try { S.thumbs[e.k] = await H.thumb(e.m); const im = document.querySelector(`.bld-tile[data-bk="${CSS.escape(e.k)}"] .bt-img`); if (im) im.innerHTML = `<img src="${S.thumbs[e.k]}" alt="">`; } catch { e._tf = 1; }
      if (++n % 12 === 0) saveThumbs();
      await new Promise(r => setTimeout(r, 30));
    }
    saveThumbs(); S.thumbBusy = false;
  }
  async function collectMine(){
    if (S.busy) return; S.busy = true;
    const lots = H.myLots(), mine = H.mineSet(); let i = 0;
    try {
      for (const l of lots) {
        $("bldLibMsg").textContent = `Reading your lots… ${++i} of ${lots.length}`;
        try { const props = await H.mapOf({key: l.id, prop: l.id, lat: l.lat, lng: l.lng}); catFromProps(props, mine); } catch {}
        if (i % 5 === 0) { saveCat(); renderLib(); }
      }
      $("bldLibMsg").textContent = `Read ${lots.length} of your lots.`;
    } finally { S.busy = false; saveCat(); renderLib(); }
  }
  async function collectAround(){
    if (S.busy || !S.n) return; S.busy = true; const mine = H.mineSet(); let i = 0;
    try {
      const d = .0014;
      for (const [a, b] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
        $("bldLibMsg").textContent = `Looking around the lot… ${++i} of 8`;
        try { const props = await H.mapOf({key: `around:${S.prop}:${a}:${b}`, lat: S.n.lat + a * d, lng: S.n.lng + b * d / Math.cos(S.n.lat * DEG)}); catFromProps(props, mine); } catch {}
      }
      $("bldLibMsg").textContent = "Added everything seen around this lot.";
    } finally { S.busy = false; saveCat(); renderLib(); }
  }
  // ---------- designs ----------
  const blank = name => ({name, add: [], moves: {}, removed: {}, done: {}});
  const D = () => S.D.designs[S.D.cur];
  function pushUndo(){ S.undo.push(JSON.stringify(D())); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
  function itemsNow(){   // every editable item as plain numbers
    return S.v.editable().filter(o => o.visible).map(o => ({o, id: o.userData.id, x: o.position.x, z: o.position.z, yaw: o.rotation.y, hx: o.userData.hx, hz: o.userData.hz, layer: o.userData.layer, name: o.userData.name}));
  }
  async function applyDesign(){
    const v = S.v; if (!v) return;
    for (const [, o] of S.added) v.removeItem(o); S.added.clear();
    const d = D(); d.stage = d.stage || {};
    for (const [id, p] of S.orig) {   // growth stages first (they swap the model), then spots
      const want = d.stage[id] ? {...p.m0, lods: d.stage[id].lods, model: d.stage[id].model} : p.m0;
      if (firstUrl(p.o.userData.m) !== firstUrl(want)) { try { const nu = await v.swapModel(p.o, want); relink(p.o, nu); } catch {} }
      v.moveItem(p.o, p.x, p.z, p.yaw); p.o.visible = true;
    }
    for (const [id, mv] of Object.entries(d.moves)) { const p = S.orig.get(id); if (p) v.moveItem(p.o, mv.x, mv.z, mv.yaw); }
    for (const id of Object.keys(d.removed)) { const p = S.orig.get(id); if (p) p.o.visible = false; }
    const jobs = d.add.map(async a => { try { const o = await v.addItem(a.m, {x: a.x, z: a.z, yaw: a.yaw, id: a.id}); S.added.set(a.id, o); } catch {} });
    await Promise.all(jobs); applyNames();
    S.sel = S.sel.filter(o => o.parent && o.visible); marks(); overlays(); renderInsp(); renderDesigns(); if (S.listOn) renderList(); v.refresh();
  }
  function renderDesigns(){
    $("bldDesign").innerHTML = S.D.designs.map((d, i) => `<option value="${i}"${i === S.D.cur ? " selected" : ""}>${esc(d.name)}</option>`).join("");
    const d = D(), n = d.add.length + Object.keys(d.moves).length + Object.keys(d.removed).length;
    $("bldCount").textContent = n ? `${n} change${n === 1 ? "" : "s"}` : "no changes yet";
    $("bldUndo").disabled = !S.undo.length; $("bldRedo").disabled = !S.redo.length;
  }

  // ---------- selection, validity, overlays ----------
  function problems(it, all){
    const out = [];
    if (S.v.ring && !corners(it).every(([x, z]) => inRing(x, z, S.v.ring))) out.push("outside the lot");
    for (const b of all) if (b.id !== it.id && sameLayer(it, b) && overlap(it, b)) { out.push(`overlaps ${b.name}`); break; }
    return out;
  }
  function marks(){
    const all = itemsNow(), selIds = new Set(S.sel.map(o => o.userData.id));
    for (const it of all) {
      const bad = problems(it, all).length > 0, d = D(), moved = !!d.moves[it.id];
      S.v.mark(it.o, selIds.has(it.id) ? (bad ? "bad" : S.sel.length > 1 ? "multi" : "sel") : bad && (S.added.has(it.id) || moved) ? "bad" : null);
    }
  }
  function overlays(guides){
    const d = D(), list = [];
    for (const id of Object.keys(d.moves)) { const p = S.orig.get(id); if (p) list.push({x: p.x, z: p.z, yaw: p.yaw, hx: p.o.userData.hx, hz: p.o.userData.hz, color: 0xf6b552}); }
    for (const id of Object.keys(d.removed)) { const p = S.orig.get(id); if (p) list.push({x: p.x, z: p.z, yaw: p.yaw, hx: p.o.userData.hx, hz: p.o.userData.hz, color: 0xff5a5a}); }
    for (const g of guides || []) list.push({seg: g, color: 0x62dcff});
    S.v.setOverlays(list);
  }
  const selItem = () => S.sel.length === 1 ? S.sel[0] : null;
  function renderInsp(){
    const o = selItem(), el = $("bldInsp");
    if (!S.sel.length) { el.innerHTML = `<p class="note" style="margin:0">${S.arm ? `Click on the lot to put down <b>${esc(entryName(S.arm))}</b>. The patch under the pointer shows where it lands: <b style="color:#62dcff">blue</b> fits, <b style="color:#ff6b6b">red</b> can't go there. R turns it. Esc to stop.</p><p class="note" id="bldWhy" style="margin:6px 0 0;color:#ff8a8a"></p><p hidden>` : "Pick something from the library, or click an item on the lot to move it. Drag to move, it snaps to the things around it like in Upland."}</p>`; return; }
    if (!o) { el.innerHTML = `<div class="bi-h"><b>${S.sel.length} selected</b></div><div class="bi-row"><button class="tbtn" type="button" data-ba="rot:-90">⟲ 90°</button><button class="tbtn" type="button" data-ba="rot:90">⟳ 90°</button><button class="tbtn" type="button" data-ba="dup">Duplicate</button><button class="tbtn bad" type="button" data-ba="del">Remove</button></div><p class="note">Drag any of them to move them all.</p>`; return; }
    const u = o.userData, it = {id: u.id, x: o.position.x, z: o.position.z, yaw: o.rotation.y, hx: u.hx, hz: u.hz, layer: u.layer, name: u.name}, pr = problems(it, itemsNow());
    const ang = ((-o.rotation.y / DEG) % 360 + 360) % 360, d = D(), isNew = S.added.has(u.id), moved = !!d.moves[u.id];
    const snapTo = liveSnap(u.id, isNew ? (d.add.find(a => a.id === u.id) || {}).snap : moved ? d.moves[u.id].snap : null);
    const tk = (u.m && u.m._k) || keyOf(u.m), th = S.thumbs[tk];
    el.innerHTML = `<div class="bi-h">${th ? `<img src="${th}" alt="">` : ""}<div><b>${esc(u.name)}</b><span>${(u.hx * 2).toFixed(2)} × ${(u.hz * 2).toFixed(2)} m · ${LAYER_NAME[u.layer]}${isNew ? " · new" : moved ? " · moved" : " · already on the lot"}</span></div></div>
      ${pr.length ? `<p class="neg bi-warn">Can't go here: ${esc(pr.join(", "))}.</p>` : snapTo ? `<p class="pos bi-ok">Snapped ${esc(snapText(snapTo))}.</p>` : ""}
      <label class="bi-lab">Turn <b class="num" id="bldAngV">${ang.toFixed(1)}°</b></label>
      <input type="range" id="bldAng" min="0" max="360" step="0.5" value="${ang.toFixed(1)}">
      <div class="bi-row"><button class="tbtn" type="button" data-ba="rot:-90">−90°</button><button class="tbtn" type="button" data-ba="rot:-15">−15°</button><button class="tbtn" type="button" data-ba="rot:-1">−1°</button><button class="tbtn" type="button" data-ba="rot:1">+1°</button><button class="tbtn" type="button" data-ba="rot:15">+15°</button><button class="tbtn" type="button" data-ba="rot:90">+90°</button></div>
      ${(() => { const si = stageInfo(o); return si ? `<label class="bi-lab">Growth <b>${esc(si.label(si.cur))}</b></label><div class="bi-row"><button class="tbtn" type="button" data-ba="stage:-1"${si.cur <= 1 ? " disabled" : ""}>− Younger</button><button class="tbtn" type="button" data-ba="stage:1"${si.n && si.cur >= si.n ? " disabled" : ""}>Grow +</button></div>` : ""; })()}
      <label class="bi-lab">Add one next to it</label>
      <div class="bi-row bi-rep"><button class="tbtn" type="button" data-ba="rep:v-">↑</button><button class="tbtn" type="button" data-ba="rep:u-">←</button><button class="tbtn" type="button" data-ba="rep:u+">→</button><button class="tbtn" type="button" data-ba="rep:v+">↓</button><span class="muted">side by side, snapped</span></div>
      <div class="bi-row"><button class="tbtn" type="button" data-ba="dup">Duplicate</button>${moved ? `<button class="tbtn" type="button" data-ba="back">Put back</button>` : ""}<button class="tbtn" type="button" data-ba="focus">Look at it</button><button class="tbtn" type="button" data-ba="rename">Rename</button>${/^(nursery|building)$/.test(u.kind) ? `<button class="tbtn" type="button" data-ba="lock">${locked(o) ? "Unlock to move" : "Lock"}</button>` : ""}<button class="tbtn bad" type="button" data-ba="del">${isNew ? "Remove" : "Pick up"}</button></div>
      <p class="note bi-pos">${esc(edgeText(it))}</p>`;
    $("bldAng").addEventListener("input", e => { const a = -(+e.target.value) * DEG; if (!S.angUndo) { pushUndo(); S.angUndo = true; } setPose(o, o.position.x, o.position.z, a); commit(o, null, true); $("bldAngV").textContent = (+e.target.value).toFixed(1) + "°"; });
    $("bldAng").addEventListener("change", () => { S.angUndo = false; renderInsp(); });
  }
  // is a saved snap still true? (the two still touch); moving the anchor later breaks it
  function touching(idA, idB){
    if (String(idB).startsWith("edge:")) return true;
    const all = itemsNow(), a = all.find(x => x.id === idA), b = all.find(x => x.id === idB); if (!a || !b) return false;
    return overlap({...a, hx: a.hx + .04, hz: a.hz + .04}, b, 0);
  }
  const liveSnap = (id, sn) => sn && touching(id, sn.to) ? sn : null;
  function nameById(id){ if (String(id).startsWith("edge:")) return "lot edge " + "ABCDEFGHIJKLMNOP"[+id.slice(5)]; const p = S.orig.get(id) || null; const o = p ? p.o : S.added.get(id); return o ? o.userData.name : "an item"; }
  function snapText(sn){ return sn.to.startsWith("edge:") ? `flush against ${nameById(sn.to)}` : `to the ${sn.dir} side of ${nameById(sn.to)}${sn.aligned ? ", edges lined up" : ""}`; }
  function edgeText(it){   // distance to the two nearest lot edges
    const R = S.v.ring; if (!R) return "";
    const L = R[0][0] === R[R.length - 1][0] ? R.slice(0, -1) : R, out = [];
    L.forEach((p, i) => { const q = L[(i + 1) % L.length], ex = q[0] - p[0], ez = q[1] - p[1], len = Math.hypot(ex, ez) || 1; const t = Math.max(0, Math.min(1, ((it.x - p[0]) * ex + (it.z - p[1]) * ez) / (len * len))); const d = Math.hypot(it.x - (p[0] + t * ex), it.z - (p[1] + t * ez)); out.push({i, d}); });
    out.sort((a, b) => a.d - b.d);
    return `Centre is ${out.slice(0, 2).map(e => `${e.d.toFixed(2)} m from edge ${"ABCDEFGHIJKLMNOP"[e.i]}`).join(" and ")}.`;
  }

  // ---------- changing things ----------
  function setPose(o, x, z, yaw){ S.v.moveItem(o, x, z, yaw); }
  function commit(o, snap, quiet){   // write an item's spot into the design
    const id = o.userData.id, d = D(), a = d.add.find(x => x.id === id);
    const pose = {x: +o.position.x.toFixed(4), z: +o.position.z.toFixed(4), yaw: +o.rotation.y.toFixed(5)};
    if (a) { Object.assign(a, pose); if (snap !== undefined) a.snap = snap; }
    else { const p = S.orig.get(id); if (!p) return;
      if (Math.hypot(p.x - pose.x, p.z - pose.z) < .005 && Math.abs(wrapA(p.yaw - pose.yaw)) < .001) delete d.moves[id];
      else d.moves[id] = {...pose, snap: snap !== undefined ? snap : (d.moves[id] || {}).snap || null}; }
    if (!quiet) { saveDesigns(); renderDesigns(); }
    marks(); overlays(); if (S.listOn) renderList();
    if (quiet) { clearTimeout(S.saveT); S.saveT = setTimeout(() => { saveDesigns(); renderDesigns(); }, 400); }
  }
  async function addFrom(e, x, z, yaw = 0, snapNow = true){
    pushUndo();
    const id = uid(), m = JSON.parse(JSON.stringify(e.m)); m._k = e.k;
    const o = await S.v.addItem(m, {x, z, yaw, id}); S.added.set(id, o);
    D().add.push({id, k: e.k, m, x, z, yaw, snap: null});
    S.dims[e.k] = {hx: o.userData.hx, hz: o.userData.hz, layer: o.userData.layer};
    let sn = null;
    if (snapNow && S.snap) { const it = {id, x, z, yaw, hx: o.userData.hx, hz: o.userData.hz, layer: o.userData.layer}; const r = snapPose(it, itemsNow().filter(b => b.id !== id), S.v.ring, snapT(it)); if (r) { setPose(o, r.x, r.z, r.yaw); sn = {to: r.to, dir: r.dir, aligned: r.aligned}; } }
    commit(o, sn); select([o]); return o;
  }
  const snapT = it => Math.max(.25, Math.min(.7, Math.min(it.hx, it.hz) * .9 + .15));
  function select(list){ S.sel = list.filter(Boolean); marks(); renderInsp(); }
  function rotateSel(deg){
    if (!S.sel.length) return; pushUndo();
    const cx = S.sel.reduce((a, o) => a + o.position.x, 0) / S.sel.length, cz = S.sel.reduce((a, o) => a + o.position.z, 0) / S.sel.length, r = -deg * DEG, c = Math.cos(r), s = Math.sin(r);
    for (const o of S.sel) { const dx = o.position.x - cx, dz = o.position.z - cz; setPose(o, S.sel.length > 1 ? cx + dx * c + dz * s : o.position.x, S.sel.length > 1 ? cz - dx * s + dz * c : o.position.z, o.rotation.y + r); commit(o, null, true); }
    saveDesigns(); renderDesigns(); renderInsp();
  }
  async function duplicateSel(){
    if (!S.sel.length) return; const made = [];
    for (const o of S.sel) { const e = entryFor(o); const u = o.userData, [x, z] = toWorld({x: o.position.x, z: o.position.z, yaw: o.rotation.y}, u.hx * 2 + .02, 0); made.push(await addFrom(e, x, z, o.rotation.y, true)); }
    select(made);
  }
  async function repeat(side){
    const o = selItem(); if (!o) return; const u = o.userData, e = entryFor(o);
    const lx = side === "u+" ? u.hx * 2 : side === "u-" ? -u.hx * 2 : 0, lz = side === "v+" ? u.hz * 2 : side === "v-" ? -u.hz * 2 : 0;
    const [x, z] = toWorld({x: o.position.x, z: o.position.z, yaw: o.rotation.y}, lx, lz);
    pushUndo();
    const id = uid(), m = JSON.parse(JSON.stringify(e.m)); m._k = e.k; const n = await S.v.addItem(m, {x, z, yaw: o.rotation.y, id}); S.added.set(id, n);
    const rel = {to: u.id, dir: bearing(x - o.position.x, z - o.position.z), aligned: true};
    D().add.push({id, k: e.k, m, x, z, yaw: o.rotation.y, snap: rel}); commit(n, rel); select([n]);
  }
  function entryFor(o){ const k = keyOfObj(o); return S.cat.items[k] || {k, m: slim(o.userData.m)}; }
  const keyOfObj = o => (o.userData.m && o.userData.m._k) || keyOf(o.userData.m) || String(o.userData.key || "");
  function removeSel(){
    if (!S.sel.length) return; pushUndo(); const d = D();
    for (const o of S.sel) { const id = o.userData.id;
      if (S.added.has(id)) { S.v.removeItem(o); S.added.delete(id); d.add = d.add.filter(a => a.id !== id); for (const a of d.add) if (a.snap && a.snap.to === id) a.snap = null; }
      else { o.visible = false; d.removed[id] = true; delete d.moves[id]; } }
    S.sel = []; saveDesigns(); renderDesigns(); marks(); overlays(); renderInsp(); if (S.listOn) renderList(); S.v.refresh();
  }
  async function undoRedo(back){
    const from = back ? S.undo : S.redo, to = back ? S.redo : S.undo; if (!from.length) return;
    to.push(JSON.stringify(D())); S.D.designs[S.D.cur] = JSON.parse(from.pop()); S.sel = []; saveDesigns(); await applyDesign();
  }

  // ---------- the patch on the ground where the next item goes (green = fine, red = can't go there) ----------
  function armDims(e){
    if (S.dims[e.k]) return S.dims[e.k];
    const sz = (e.m.size || []).map(Number), kind = entryKind(e);
    if (kind === "plant") { const f = (sz[0] || 0) > 1.6 ? 1.4 : (e.m._fit || 0) > 1.6 ? 1.4 : .7; return {hx: f / 2, hz: f / 2, layer: "plant"}; }
    const hx = sz[0] > 0 ? sz[0] / 2 : .6, hz = sz[1] > 0 ? sz[1] / 2 : .6;
    return {hx, hz, layer: sz[2] > 0 && sz[2] <= .155 ? "flat" : "default"};
  }
  function previewAt(cx, cy){
    const e = S.arm; if (!e) return null; S.pvXY = [cx, cy];
    const sp = S.v.surfaceAt(cx, cy); if (!sp) { S.v.setPreview(null); return null; }
    const d = armDims(e), it = {id: "_preview", x: sp[0], z: sp[1], yaw: S.lastYaw || 0, hx: d.hx, hz: d.hz, layer: d.layer, name: entryName(e)};
    let guides = null;
    if (S.snap) { const r = snapPose(it, itemsNow(), S.v.ring, snapT(it)); if (r) { it.x = r.x; it.z = r.z; it.yaw = r.yaw; guides = r.guide; } }
    const pr = problems(it, itemsNow());
    S.v.setPreview({...it, ok: !pr.length}); overlays(guides);
    const why = $("bldWhy"); if (why) why.textContent = pr.length ? "Can't go here: " + pr.join(", ") + "." : "";
    S.prev = {...it, pr};
    return it;
  }

  // ---------- growth stages (plants) ----------
  const firstUrl = m => { const L = m.lods && (m.lods["0"] || m.lods[Object.keys(m.lods)[0]]); return String((L && (L.modelUrl || L.model)) || m.model || ""); };
  function stageInfo(o){
    const m = o.userData.m; if (!m || o.userData.kind !== "plant") return null;
    const url = firstUrl(m);
    let g = /local:models\/(?:phases\/)?([a-z0-9-]+?)(?:-p(\d+)-(?:bloom|leaf))?\.glb/i.exec(url);
    if (g) { const key = g[1], n = (H.phases() || {})[key]; if (!n) return null; const cur = g[2] ? +g[2] : n + 1;
      return {n: n + 1, cur, label: st => st > n ? "grown" : `stage ${st} of ${n + 1}`, url: st => st > n ? `local:models/${key}.glb?v=${H.modelVer}` : `local:models/phases/${key}-p${st}-bloom.glb?v=${H.modelVer}`}; }
    g = /(phase|stage)[_\-]?(\d+)/i.exec(url); if (!g) return null;
    return {n: null, cur: +g[2], label: st => `stage ${st}`, url: st => url.replace(/(phase|stage)([_\-]?)(\d+)/ig, (a, w, sep) => w + sep + st)};
  }
  function mWithStage(m, st, info){
    const m2 = JSON.parse(JSON.stringify(m)), from = firstUrl(m), to = info.url(st);
    if (/^local:/.test(from)) m2.lods = {0: {modelUrl: to}};
    else for (const k of Object.keys(m2.lods || {})) { const L = m2.lods[k]; for (const f of ["modelUrl", "textureUrl"]) if (L[f]) L[f] = String(L[f]).replace(/(phase|stage)([_\-]?)(\d+)/ig, (a, w, sep) => w + sep + st); }
    if (m2.model) m2.model = String(m2.model).replace(/(phase|stage)([_\-]?)(\d+)/ig, (a, w, sep) => w + sep + st);
    return m2;
  }
  function relink(old, nu){   // a swapped model is a new object: point everything at it
    const id = nu.userData.id;
    if (S.added.get(id) === old) S.added.set(id, nu);
    const p = S.orig.get(id); if (p && p.o === old) p.o = nu;
    S.sel = S.sel.map(x => x === old ? nu : x);
  }
  async function setStage(o, dir){
    if (S.staging) return;
    const info = stageInfo(o); if (!info) return;
    const st = info.cur + dir; if (st < 1 || (info.n && st > info.n)) return;
    const m2 = mWithStage(o.userData.m, st, info);
    S.staging = true; let nu;
    try { nu = await S.v.swapModel(o, m2); } catch { H.toast && H.toast("Upland has no model for that stage"); return; } finally { S.staging = false; }
    pushUndo(); relink(o, nu);
    const id = nu.userData.id, d = D(), a = d.add.find(x => x.id === id);
    if (a) a.m = m2; else { d.stage = d.stage || {}; if (firstUrl(m2) === firstUrl(S.orig.get(id).m0)) delete d.stage[id]; else d.stage[id] = {lods: m2.lods, model: m2.model}; }
    saveDesigns(); renderDesigns(); applyNames(); marks(); renderInsp(); if (S.listOn) renderList();
  }

  // ---------- build sheet picture ----------
  async function exportSheet(){
    const btn = $("bldSheet"); if (btn) btn.disabled = true;
    try {
      const L = steps(), all = itemsNow(), d = D(); S.v.setPreview(null);
      const hero = S.v.snapshot(1200, 700, "image/jpeg", .9, "hero");
      const prevLabels = S.listOn; S.v.setLabels(null);
      const top = S.v.snapshotTop(1800, 1800);
      if (prevLabels) renderList();
      const counts = new Map(); for (const a of d.add) { const nm = nameById(a.id); counts.set(nm, (counts.get(nm) || 0) + 1); }
      const needs = [...counts].map(([name, count]) => { const e = Object.values(S.cat.items).find(x => entryName(x) === name); return {name, count, wallet: e && e.wallet ? e.wallet : null}; });
      const info = {top, hero, title: S.n.title, sub: [S.n.addr, S.n.city].filter(Boolean).join(", "), design: d.name, made: new Date().toLocaleDateString([], {month: "short", day: "numeric", year: "numeric"}),
        ring: S.v.ring, needs,
        steps: L.map(s => { const it = all.find(a => a.id === s.id), p = S.orig.get(s.id); const pos = s.kind === "pick" && p ? {x: p.x, z: p.z} : it ? {x: it.x, z: it.z} : {};
          return {n: s.n, kind: s.kind, name: s.name, text: s.text, ...pos, bad: it ? problems(it, all).length > 0 : false}; })};
      const sheet = await import("./sheet.js"), cv = await sheet.makeSheet(info);
      await sheet.saveCanvas(cv, `alien-farmers-build-${String(S.n.title || "lot").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(d.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
      return info;
    } finally { if (btn) btn.disabled = false; }
  }
  // what a share link carries: the lot (from Upland's map), the design, and the steps; nothing else from your Ledger
  function sharePayload(){
    const d = D(), L = steps(), all = itemsNow(), me = S.v.me || (S.props || []).find(p => String(p.prop_id) === S.prop);
    const near = (S.v.props || S.props || []).filter(p => p !== me && p.boundaries).map(p => ({prop_id: p.prop_id, boundaries: p.boundaries, centerlat: p.centerlat, centerlng: p.centerlng, models: []}));
    return {v: 1, brand: "Alien Farmers", at: new Date().toISOString(), lot: {prop: me ? String(me.prop_id) : S.prop, lat: S.n.lat, lng: S.n.lng, title: S.n.title, addr: S.n.addr || "", city: S.n.city || "", zone: S.n.zone || ""},
      props: [me, ...near].filter(Boolean), design: {name: d.name, add: d.add, moves: d.moves, removed: d.removed, stage: d.stage || {}}, names: S.names,
      steps: L.map(s => { const it = all.find(a => a.id === s.id), p = S.orig.get(s.id); const pos = s.kind === "pick" && p ? {x: p.x, z: p.z} : it ? {x: it.x, z: it.z} : {}; return {n: s.n, kind: s.kind, id: s.id, name: s.name, text: s.text, ...pos}; })};
  }

  // ---------- pointer: pick, drag (with snapping), place ----------
  function onDown(e){
    if (!S.on || e.button > 0 || !e.isPrimary) return;
    if (e.target.closest && !e.target.closest("#tourCv")) return;
    const g = S.v.groundAt(e.clientX, e.clientY);
    if (S.arm) { const pv = previewAt(e.clientX, e.clientY); if (!pv) return; const sp = [pv.x, pv.z]; e.stopPropagation(); S.v.setControls(false); const e0 = S.arm; if (!e.shiftKey) { S.arm = null; renderLib(); } if (!e.shiftKey) S.v.setPreview(null); addFrom(e0, sp[0], sp[1], pv.yaw).then(() => S.v.setControls(true)); return; }
    const o = S.v.pickAt(e.clientX, e.clientY);
    if (!o) { S.downEmpty = {x: e.clientX, y: e.clientY}; return; }
    if (locked(o) && !e.shiftKey) { S.downLocked = {o, x: e.clientX, y: e.clientY}; return; }   // buildings stay put unless unlocked: dragging on them moves the map
    e.stopPropagation(); S.v.setControls(false);
    let list = S.sel.includes(o) ? S.sel : [o];
    if (e.shiftKey) { list = S.sel.includes(o) ? S.sel.filter(x => x !== o) : S.sel.concat(o); select(list); S.v.setControls(true); return; }
    if (!S.sel.includes(o)) select([o]);
    S.drag = {id: e.pointerId, g0: g, start: list.map(x => ({o: x, x: x.position.x, z: x.position.z, yaw: x.rotation.y})), moved: false, sx: e.clientX, sy: e.clientY};
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  }
  function onMove(e){
    if (!S.on) return;
    const dr = S.drag;
    if (!dr && S.arm && e.pointerType === "mouse" && e.target && e.target.closest && e.target.closest("#tourCv")) { const now = performance.now(); if (now - (S.pvT || 0) > 40) { S.pvT = now; previewAt(e.clientX, e.clientY); } return; }
    if (!dr || e.pointerId !== dr.id) return;
    const g = S.v.groundAt(e.clientX, e.clientY); if (!g || !dr.g0) return;
    if (!dr.moved && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 4) return;
    if (!dr.moved) { dr.moved = true; pushUndo(); }
    const dx = g[0] - dr.g0[0], dz = g[1] - dr.g0[1];
    let guides = null; dr.snap = null;
    if (dr.start.length === 1) {
      const s0 = dr.start[0], o = s0.o, u = o.userData, it = {id: u.id, x: s0.x + dx, z: s0.z + dz, yaw: o.rotation.y, hx: u.hx, hz: u.hz, layer: u.layer};
      const r = S.snap && !e.altKey ? snapPose(it, itemsNow().filter(b => b.id !== u.id), S.v.ring, snapT(it)) : null;
      if (r) { setPose(o, r.x, r.z, r.yaw); guides = r.guide; dr.snap = {to: r.to, dir: r.dir, aligned: r.aligned}; } else setPose(o, it.x, it.z, it.yaw);
    } else for (const s0 of dr.start) setPose(s0.o, s0.x + dx, s0.z + dz, s0.yaw);
    marks(); overlays(guides);
  }
  function onUp(e){
    if (!S.on) return;
    if (S.downEmpty) { const de = S.downEmpty; S.downEmpty = null; if (Math.hypot(e.clientX - de.x, e.clientY - de.y) < 5 && S.sel.length) select([]); }
    if (S.downLocked) { const dl = S.downLocked; S.downLocked = null; if (Math.hypot(e.clientX - dl.x, e.clientY - dl.y) < 5) select([dl.o]); }
    const dr = S.drag; if (!dr || e.pointerId !== dr.id) return;
    S.drag = null; S.v.setControls(true);
    if (dr.moved) { for (const s0 of dr.start) commit(s0.o, dr.start.length === 1 ? dr.snap : null, true); saveDesigns(); renderDesigns(); overlays(); renderInsp(); S.lastYaw = dr.start[0].o.rotation.y; }
  }
  function onKey(e){
    if (!S.on || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "")) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "z" || k === "Z")) { e.preventDefault(); e.stopImmediatePropagation(); undoRedo(!e.shiftKey); return; }
    if (mod && (k === "y" || k === "Y")) { e.preventDefault(); e.stopImmediatePropagation(); undoRedo(false); return; }
    if (mod && (k === "d" || k === "D")) { e.preventDefault(); e.stopImmediatePropagation(); duplicateSel(); return; }
    if (k === "Escape") { if (S.arm || S.sel.length) { e.stopImmediatePropagation(); S.arm = null; S.v.setPreview(null); overlays(); select([]); renderLib(); } return; }
    if (S.arm && (k === "r" || k === "R")) { e.preventDefault(); e.stopImmediatePropagation(); S.lastYaw = (S.lastYaw || 0) - (e.shiftKey ? -15 : 15) * DEG; if (S.pvXY) previewAt(...S.pvXY); return; }
    if (!S.sel.length) return;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); e.stopImmediatePropagation(); removeSel(); return; }
    if (k === "r" || k === "R") { e.preventDefault(); e.stopImmediatePropagation(); rotateSel(e.shiftKey ? -15 : 15); return; }
    if (k === "," || k === ".") { e.preventDefault(); e.stopImmediatePropagation(); rotateSel(k === "," ? -1 : 1); return; }
  }

  // ---------- build list (what to do in the game, in order) ----------
  function steps(){
    const d = D(), out = [], placed = new Set([...S.orig.keys()].filter(id => !d.removed[id] && !d.moves[id]));
    for (const id of Object.keys(d.removed)) { const p = S.orig.get(id); if (p) out.push({kind: "pick", id, name: p.o.userData.name, o: p.o, text: "Pick it up (back to your wallet)."}); }
    const pending = [...Object.entries(d.moves).map(([id, mv]) => ({id, mv: {...mv, snap: liveSnap(id, mv.snap)}, mode: "move"})), ...d.add.map(a => ({id: a.id, mv: {...a, snap: liveSnap(a.id, a.snap)}, mode: "add"}))];
    let guard = 0;
    while (pending.length && guard++ < 5000) {
      let i = pending.findIndex(p => !p.mv.snap || p.mv.snap.to.startsWith("edge:") || placed.has(p.mv.snap.to));
      if (i < 0) i = 0;
      const p = pending.splice(i, 1)[0], o = p.mode === "add" ? S.added.get(p.id) : (S.orig.get(p.id) || {}).o; if (!o) continue;
      const sn = p.mv.snap, n = out.length + 1;
      const anchor = sn && !sn.to.startsWith("edge:") ? out.find(s => s.id === sn.to) : null;
      const text = sn ? (sn.to.startsWith("edge:") ? `Snap it flush against ${nameById(sn.to)}.` : `Snap it to the ${sn.dir} side of ${nameById(sn.to)}${anchor ? ` (step ${anchor.n})` : " (already on the lot)"}${sn.aligned ? ", edges lined up" : ""}.`)
        : `${edgeText({x: o.position.x, z: o.position.z})} Turn ${(((-o.rotation.y / DEG) % 360 + 360) % 360).toFixed(1)}°.`;
      out.push({kind: p.mode, id: p.id, name: o.userData.name, o, n, text: (p.mode === "move" ? "Move it: " : "") + text});
      placed.add(p.id);
    }
    out.forEach((s, i) => s.n = i + 1);
    return out;
  }
  function renderList(){
    const L = steps(), d = D(), all = itemsNow();
    $("bldListBody").innerHTML = L.length ? L.map(s => {
      const it = all.find(a => a.id === s.id), pr = it ? problems(it, all) : [];
      return `<div class="bl-step${d.done[s.id] ? " done" : ""}" data-bstep="${esc(s.id)}"><label><input type="checkbox" data-bdone="${esc(s.id)}"${d.done[s.id] ? " checked" : ""}></label><b class="num">${s.n}</b>
        <div><span class="bl-k ${s.kind}">${s.kind === "pick" ? "Pick up" : s.kind === "move" ? "Move" : "Place"}</span> <b>${esc(s.name)}</b><small>${esc(s.text)}${pr.length ? ` <em class="neg">${esc(pr.join(", "))}</em>` : ""}</small></div></div>`;
    }).join("") : `<p class="note" style="margin:0">No changes yet. Everything you add, move or pick up shows here as steps to follow in Upland.</p>`;
    const counts = new Map(); for (const a of d.add) { const nm = nameById(a.id); counts.set(nm, (counts.get(nm) || 0) + 1); }
    $("bldNeed").innerHTML = counts.size ? `<b>You'll need:</b> ${[...counts].map(([nm, c]) => { const e = Object.values(S.cat.items).find(x => entryName(x) === nm); const w = e && e.wallet ? ` (${e.wallet} in wallet${e.wallet < c ? `, ${c - e.wallet} short` : ""})` : ""; return `${c} × ${esc(nm)}${w}`; }).join(" · ")}` : "";
    S.v.setLabels(S.listOn ? L.filter(s => s.kind !== "pick").map(s => ({x: s.o.position.x, z: s.o.position.z, y: Math.min(3, s.o.userData.h || 1), text: s.n, edge: d.done[s.id] ? "#8c9bb1" : "#5ee38f"})) : null);
  }

  // ---------- panels ----------
  function bind(){
    const tour = $("tour");
    tour.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
    $("bldSearch").addEventListener("input", e => { S.q = e.target.value.trim(); renderLib(); });
    $("bldDesign").addEventListener("change", e => { S.D.cur = +e.target.value; S.undo = []; S.redo = []; saveDesigns(); applyDesign(); });
    document.addEventListener("click", async e => {
      if (!S.on) return; const t = e.target;
      const sb = t.closest("#bldSrc button"); if (sb) { S.src = sb.dataset.src; renderLib(); return; }
      const gb = t.closest("#bldGrp button"); if (gb) { S.grp = S.grp === gb.dataset.grp ? "" : gb.dataset.grp; renderLib(); return; }
      const tile = t.closest("[data-bk]"); if (tile) {
        const e0 = S.cat.items[tile.dataset.bk] || seedEntries().find(x => x.k === tile.dataset.bk); if (!e0) return;
        if (H.coarse()) { const r = $("tourCv").getBoundingClientRect(), g = S.v.surfaceAt(r.left + r.width / 2, r.top + r.height / 2); if (g) await addFrom(e0, g[0], g[1], S.lastYaw || 0); H.sheet(null); }
        else { S.arm = S.arm && S.arm.k === e0.k ? null : e0; if (!S.arm) S.v.setPreview(null); S.sel = []; marks(); renderInsp(); renderLib(); }
        return;
      }
      const ba = t.closest("[data-ba]"); if (ba) { const [a, v] = ba.dataset.ba.split(":");
        if (a === "stage" && selItem()) setStage(selItem(), +v); else
        if (a === "rot") rotateSel(+v); else if (a === "dup") duplicateSel(); else if (a === "del") removeSel(); else if (a === "rep") repeat(v); else if (a === "focus" && selItem()) S.v.focus(selItem());
        else if (a === "rename" && selItem()) { const o = selItem(), k = keyOfObj(o), nm = prompt("Name for this item (every copy of it gets this name)", o.userData.name); if (nm) { S.names[k] = nm.trim(); H.store.set("af:catNames", S.names); applyNames(); renderInsp(); renderLib(); if (S.listOn) renderList(); } }
        else if (a === "lock" && selItem()) { const id = selItem().userData.id; if (S.unlocked.has(id)) S.unlocked.delete(id); else S.unlocked.add(id); renderInsp(); }
        else if (a === "back" && selItem()) { pushUndo(); const o = selItem(), p = S.orig.get(o.userData.id); if (p) { setPose(o, p.x, p.z, p.yaw); delete D().moves[o.userData.id]; saveDesigns(); renderDesigns(); marks(); overlays(); renderInsp(); } }
        return; }
      if (t.closest("#bldSheet")) { exportSheet().catch(err => H.toast && H.toast("Couldn't make the picture: " + (err && err.message || err))); return; }
      if (t.closest("#bldShare")) { H.share(sharePayload()); return; }
      if (t.closest("#bldUndo")) { undoRedo(true); return; }
      if (t.closest("#bldRedo")) { undoRedo(false); return; }
      if (t.closest("#bldSnap")) { S.snap = !S.snap; H.store.set("af:bldSnap", S.snap); $("bldSnap").setAttribute("aria-pressed", String(S.snap)); return; }
      if (t.closest("#bldPlan")) { S.plan = !S.plan; $("bldPlan").setAttribute("aria-pressed", String(S.plan)); S.v.planView(S.plan); return; }
      if (t.closest("#bldListBtn")) { S.listOn = !S.listOn; $("bldListP").hidden = !S.listOn; $("bldListBtn").setAttribute("aria-pressed", String(S.listOn)); if (S.listOn) renderList(); else S.v.setLabels(null); return; }
      if (t.closest("#bldNew")) { const nm = prompt("Name for the new design", `Design ${S.D.designs.length + 1}`); if (!nm) return; S.D.designs.push(blank(nm)); S.D.cur = S.D.designs.length - 1; S.undo = []; saveDesigns(); applyDesign(); return; }
      if (t.closest("#bldCopy")) { const c = JSON.parse(JSON.stringify(D())); c.name = D().name + " copy"; c.add.forEach(a => { const old = a.id; a.id = uid(); c.add.forEach(b => { if (b.snap && b.snap.to === old) b.snap.to = a.id; }); }); S.D.designs.push(c); S.D.cur = S.D.designs.length - 1; S.undo = []; saveDesigns(); applyDesign(); return; }
      if (t.closest("#bldRename")) { const nm = prompt("Rename this design", D().name); if (!nm) return; D().name = nm; saveDesigns(); renderDesigns(); return; }
      if (t.closest("#bldDelete")) { if (!confirm(`Delete “${D().name}”? This can't be undone.`)) return; S.D.designs.splice(S.D.cur, 1); if (!S.D.designs.length) S.D.designs.push(blank("Design 1")); S.D.cur = 0; S.undo = []; saveDesigns(); applyDesign(); return; }
      if (t.closest("#bldMine")) { collectMine(); return; }
      if (t.closest("#bldAround")) { collectAround(); return; }
      const st = t.closest("[data-bstep]"); if (st && !t.closest("input")) { const p = S.orig.get(st.dataset.bstep), o = p ? p.o : S.added.get(st.dataset.bstep); if (o) { if (o.visible) select([o]); S.v.focus(o); } return; }
      const sh = t.closest("[data-bsheet]"); if (sh) { H.sheet(sh.dataset.bsheet); return; }
    });
    document.addEventListener("change", e => { const c = e.target.closest && e.target.closest("[data-bdone]"); if (!c || !S.on) return; const d = D(); if (c.checked) d.done[c.dataset.bdone] = 1; else delete d.done[c.dataset.bdone]; saveDesigns(); renderList(); });
  }
  let bound = false;

  // ---------- enter / leave ----------
  async function enter(v, n, props){
    if (!bound) { bind(); bound = true; }
    S.on = true; S.v = v; S.n = n; S.prop = String(n.prop || n.key); S.sel = []; S.arm = null; S.added = new Map(); S.undo = []; S.redo = [];
    S.orig = new Map(v.editable().filter(o => !o.userData.added).map(o => [o.userData.id, {o, x: o.position.x, z: o.position.z, yaw: o.rotation.y, m0: o.userData.m}]));
    S.props = props;
    const all = designsAll(); S.D = all[S.prop] || {v: 1, prop: S.prop, cur: 0, designs: [blank("Design 1")]};
    catFromProps(props, H.mineSet()); rebuildFromCache();
    $("bldSnap").setAttribute("aria-pressed", String(S.snap));
    renderLib(); renderInsp(); await applyDesign(); applyNames(); renderInsp();
  }
  function leave(){
    if (!S.on) return; S.on = false; S.arm = null;
    if (S.v) { for (const [, o] of S.added) S.v.removeItem(o); for (const [, p] of S.orig) { S.v.moveItem(p.o, p.x, p.z, p.yaw); p.o.visible = true; S.v.mark(p.o, null);
        if (firstUrl(p.o.userData.m) !== firstUrl(p.m0)) { const old = p.o; S.v.swapModel(old, p.m0).then(nu => { p.o = nu; }).catch(() => {}); } }
      S.v.setOverlays(null); S.v.setLabels(null); S.v.setPreview(null); S.v.setControls(true); S.v.refresh(); }
    S.added.clear(); S.sel = []; S.listOn = false; $("bldListP").hidden = true; $("bldListBtn").setAttribute("aria-pressed", "false");
  }
  return {enter, leave, get on(){ return S.on; }, exportSheet, sharePayload, _S: S, _snapPose: snapPose};
}
export {snapPose, overlap};
