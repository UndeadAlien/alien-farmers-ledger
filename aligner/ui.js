// Alien Farmers Ledger · Nursery Aligner page logic (v66).
// Alien's nursery-aligner v5 src/ui.js, brought into the Ledger: the steps, outline/nursery finding, drawing and the
// answer are his; what's new is the Ledger part around it:
//  - step 1 lists his nurseries (the Ledger's saved shop facts and lots on this device, else its public copy) and loads the
//    picked one's lot; ?prop=<property id> or ?shop=<shop id> picks it straight away;
//  - Upland's public pages (profile, properties, map) are read through the Alien Farmers helper's /pubup (no login,
//    cached there), straight from Upland only if the helper can't be reached; never a login, never a session;
//  - "Use its saved spot": when Upland has the nursery saved on the lot, the taps can come from that spot (no screenshot);
//  - "See it in 3D" hands the planned spot to nursery3d.html (?ghost=1), which shows it on the lot.
(function () {
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const LET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const HELPER = "https://af-alerts.alienfarmers.workers.dev", UPAPI = "https://api.prod.upland.me", USER = "undeadalien";
  const Q = new URLSearchParams(location.search), num = (v) => { const m = String(v || "").match(/\d{4,}/); return m ? m[0] : null; };
  const Q_PROP = num(Q.get("prop")), Q_SHOP = num(Q.get("shop")), FROM3D = Q.get("from") === "3d";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const titleCase = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Nw|Ne|Sw|Se)\b/g, (x) => x.toUpperCase());
  const shopTitle = (nm) => String(nm || "").replace(/^alien farmers\s*[-–·:]\s*/i, "").replace(/\s+by\s+alien farmers$/i, "").trim();
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const isNursery = (m) => /nursery/i.test(m.subType || "") || /nurser/i.test(String(m.model || ""));
  const S = { example: false, lots: [], lotIdx: -1, fr: null, poly: [], obstacles: [], shot: null,
    lotClicks: [], lotDone: false, nur: [], fit: null, rough: null, quarter: 0, plan: null, cur: null,
    src: "shot", nurM: null, nurs: [], sel: null, prop: null, loading: null };

  // ---------- Upland's public pages: through the helper (no login, cached), straight from Upland only as a fallback ----------
  async function upGet(path, text) {
    const read = async (r) => { if (!r.ok) { const e = new Error("Upland answered " + r.status); e.status = r.status; throw e; } return text ? r.text() : r.json(); };
    let first;
    try { return await read(await fetch(`${HELPER}/pubup?path=${encodeURIComponent(path)}`, { cache: "no-store" })); }
    catch (e) { first = e; if (e.status === 404) throw e; }   // Upland itself said "no such page": asking it directly won't change that
    try { return await read(await fetch(UPAPI + path, { headers: { Accept: "application/json" } })); }
    catch (e) { throw first && first.status ? first : e; }
  }
  const noReach = (what) => `<span class="err">Couldn't read ${what} from Upland, even through the Alien Farmers helper. Try again in a minute, or paste the map data (Another lot).</span>`;

  // ---------- the Ledger's own saved facts on this device (read only) ----------
  function idbGet(keys) {
    return new Promise((res) => {
      const out = {}; let done = false; const fin = () => { if (!done) { done = true; res(out); } }; setTimeout(fin, 2500);
      try {
        const r = indexedDB.open("af-ledger", 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore("kv"); } catch (e) {} };
        r.onerror = fin;
        r.onsuccess = () => {
          try {
            const st = r.result.transaction("kv").objectStore("kv"); let n = keys.length;
            keys.forEach((k) => { const q = st.get(k); q.onsuccess = () => { if (q.result !== undefined) out[k] = q.result; if (!--n) fin(); }; q.onerror = () => { if (!--n) fin(); }; });
          } catch (e) { fin(); }
        };
      } catch (e) { fin(); }
    });
  }
  async function pubCopy() {   // a device that has never opened the Ledger: the public copy it publishes
    try {
      if (typeof DecompressionStream !== "undefined") { const r = await fetch(HELPER + "/site/snap", { cache: "no-store" }); if (!r.ok) return null;
        return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text()); }
      const r = await fetch(HELPER + "/site/snap.json", { cache: "no-store" }); return r.ok ? r.json() : null;
    } catch (e) { return null; }
  }
  const KEYS = ["af:shopSnap", "af:props", "af:lotMap"];
  async function loadKnown() {
    const kv = await idbGet(KEYS);
    const get = (k) => kv[k] !== undefined ? kv[k] : ls.get(k, null);
    let snap = get("af:shopSnap"), props = get("af:props"), my = ls.get("af:myShops", []) || [], seen = ls.get("af:nursSeen", {}) || {};
    S.lotMaps = get("af:lotMap") || {};
    if (!(snap && snap.shops && snap.shops.length) && !(props && props.list && props.list.length) && !my.length) {
      const pc = await pubCopy(), k = (pc && pc.app === "af-site" && pc.keys) || {};
      snap = k["af:shopSnap"] || snap; props = k["af:props"] || props; my = k["af:myShops"] || my; seen = k["af:nursSeen"] || seen;
      if (k["af:lotMap"]) S.lotMaps = k["af:lotMap"];
    }
    const lots = (props && props.list) || [], byId = new Map(lots.map((x) => [String(x.id), x])), out = new Map();
    const stOf = (lot, sh) => { const nb = lot && lot.nb;
      if (sh) return sh.active === false ? "Waiting for approval" : "Open";
      if (nb && nb.st && nb.st !== "completed") return nb.pct != null ? `Being built · ${Math.round(nb.pct * 100)}%` : "Being built";
      return "Built"; };
    for (const sh of (snap && snap.shops) || []) {
      const prop = sh.prop ? String(sh.prop) : null, lot = prop ? byId.get(prop) : null, sn = seen[String(sh.id)] || {};
      out.set(prop || "shop" + sh.id, { prop, shop: String(sh.id), name: shopTitle(sh.name || sn.name) || titleCase(lot && lot.addr) || "Shop " + sh.id,
        city: (lot && lot.city) || sh.city || "", st: stOf(lot, sh) });
    }
    for (const id of my) if (![...out.values()].some((n) => n.shop === String(id))) { const sn = seen[String(id)] || {};
      out.set("shop" + id, { prop: null, shop: String(id), name: shopTitle(sn.name) || "Shop " + id, city: sn.city || "", st: "" }); }
    for (const x of lots) if ((x.nursery || x.nb) && !out.has(String(x.id))) out.set(String(x.id), { prop: String(x.id), shop: null, name: titleCase(x.addr) || "Nursery", city: x.city || "", st: stOf(x, null) });
    S.nurs = [...out.values()].sort((a, b) => (a.city || "~").localeCompare(b.city || "~") || a.name.localeCompare(b.name));
  }
  function renderNurs() {
    const L = S.nurs;
    $("nurBox").hidden = !L.length; $("nurNone").hidden = !!L.length;
    $("nurLbl").textContent = L.length === 1 ? "Your nursery" : `Your nurseries · ${L.length}`;
    $("nurList").innerHTML = L.map((n, i) => `<button type="button" class="nur${S.loading && S.sel === n ? " busy" : ""}" data-nur="${i}" aria-pressed="${S.sel === n}"><b>${esc(n.name)}</b><span>${esc([n.city, n.st].filter(Boolean).join(" · ") || "Tap to load its lot")}</span></button>`).join("");
  }
  $("nurList").addEventListener("click", (e) => { const b = e.target.closest("[data-nur]"); if (b) pick(S.nurs[+b.dataset.nur]); });
  async function pick(n) {
    if (!n) return;
    S.sel = n; renderNurs();
    let prop = n.prop;
    if (!prop && n.shop) {   // only the shop is known here: its public page says which lot it's on
      $("mapMsg").textContent = `Finding ${n.name}'s lot…`;
      try { const j = await upGet(`/metaventures/secondary-shop/${n.shop}`); if (j && j.propertyId != null) { prop = n.prop = String(j.propertyId); if (/^Shop \d+$/.test(n.name) && j.name) n.name = shopTitle(j.name) || n.name; } }
      catch (e) {}
      if (!prop) { $("mapMsg").innerHTML = noReach(`${esc(n.name)}'s shop page`); return; }
    }
    await loadProp(prop, n);
  }
  function setHead() {
    const n = S.sel, lot = S.lots[S.lotIdx], name = n && lot && n.prop === lot.id ? n.name : null;
    $("hT").textContent = S.example ? "Example: Tokyo" : name ? name : lot ? "Lot " + lot.id : "Place a nursery";
    document.title = `${name ? name + " · " : ""}Nursery Aligner · Alien Farmers`;
    $("resWhere").textContent = S.example ? "example" : name || (lot ? "lot " + lot.id : "");
  }
  // back to where it was opened from
  if (FROM3D && (Q_PROP || Q_SHOP)) { $("back").href = `nursery3d.html?${Q_PROP ? "prop=" + Q_PROP : "shop=" + Q_SHOP}`; $("backT").textContent = "3D"; }

  // ---------- step 1: map data ----------
  $("useMap").addEventListener("click", () => useMap($("mapText").value, false));
  $("loadUp").addEventListener("click", loadUpland);
  // your properties by username: profile → property IDs → each address
  try { const un = localStorage.getItem("na:user"); $("userIn").value = un || USER; } catch (e) { $("userIn").value = USER; }
  $("myProps").addEventListener("click", listMine);
  $("userIn").addEventListener("keydown", (e) => { if (e.key === "Enter") listMine(); });
  $("propList").addEventListener("change", () => { const v = $("propList").value; if (v) { $("propIn").value = v; loadUpland(); } });
  async function listMine() {
    const un = $("userIn").value.trim().replace(/^@/, ""), msg = $("mapMsg"), sel = $("propList");
    if (!un) { msg.innerHTML = `<span class="err">Type the Upland username.</span>`; return; }
    try { localStorage.setItem("na:user", un); } catch (e) {}
    msg.textContent = "Loading the properties…";
    try {
      const prof = await upGet(`/api/profile/${encodeURIComponent(un)}`);
      const ids = (prof.properties || []).map(p => String(p.property_id || p.prop_id || p)).filter(Boolean);
      if (!ids.length) { msg.innerHTML = `<span class="warn">No properties found for ${esc(un)}.</span>`; return; }
      const rows = [];
      let next = 0, done = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++];
          try {
            const q = await upGet(`/api/properties/${id}`);
            const city = (q.city && (q.city.name || q.city)) || q.city_name || "";
            rows.push({ id, addr: q.full_address || q.address || id, city: typeof city === "string" ? city : "" });
          } catch (e) { rows.push({ id, addr: id, city: "" }); }
          done++; msg.textContent = `Loading the properties… ${done} of ${ids.length}`;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      rows.sort((a, b) => (a.city + a.addr).localeCompare(b.city + b.addr));
      sel.innerHTML = `<option value="">Pick a property (${rows.length})</option>` + rows.map(x => `<option value="${esc(x.id)}">${esc(x.city ? x.city + " · " : "")}${esc(titleCase(x.addr))}</option>`).join("");
      sel.hidden = false;
      msg.innerHTML = `<span class="ok">${rows.length} properties. Pick one to load it.</span>`;
    } catch (e) { msg.innerHTML = noReach("the profile"); }
  }
  $("propIn").addEventListener("keydown", (e) => { if (e.key === "Enter") loadUpland(); });
  function loadUpland() {
    const v = $("propIn").value.trim(), m = v.match(/prop_id=(\d+)/) || v.match(/(\d{9,})/), msg = $("mapMsg");
    if (!m) { msg.innerHTML = `<span class="err">Enter a property ID or an Upland link with prop_id= in it.</span>`; return; }
    S.sel = S.nurs.find(n => n.prop === m[1]) || null; renderNurs();
    return loadProp(m[1], S.sel);
  }
  async function loadProp(id, nur) {
    const msg = $("mapMsg"), label = nur ? nur.name : "lot " + id;
    S.loading = id; renderNurs();
    msg.textContent = `Reading ${label} from Upland…`;
    let txt = null, cached = null;
    try {
      const p = await upGet(`/api/properties/${id}`);
      let lat = +(p.centerlat || p.center_lat || p.latitude || 0), lng = +(p.centerlng || p.center_lng || p.longitude || 0);
      if (!lat && p.boundaries) {
        let b = typeof p.boundaries === "string" ? JSON.parse(p.boundaries) : p.boundaries;
        const ring = b.type === "MultiPolygon" ? b.coordinates[0][0] : b.coordinates[0];
        lng = ring.reduce((a, q) => a + q[0], 0) / ring.length; lat = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      }
      if (!lat) throw new Error("centre");
      const d = 0.0009;
      txt = await upGet(`/api/map?north=${lat + d}&south=${lat - d}&east=${lng + d}&west=${lng - d}&marker=false`, true);
    } catch (e) {   // offline or Upland unreachable: the map the 3D page saved for this lot, if any
      cached = (S.lotMaps || {})[id];
      if (cached && cached.props && cached.props.length) txt = JSON.stringify(cached.props);
    }
    if (S.loading !== id) return;   // another lot was picked meanwhile
    S.loading = null; renderNurs();
    if (!txt) { msg.innerHTML = noReach(esc(label)); refresh(); return; }
    if (S.example) clearExample(true);
    if (!useMap(txt, true)) return;
    const i = S.lots.findIndex(l => l.id === id);
    if (i >= 0) {
      selectLot(i);
      if (!S.example) ls.set("af:alLast", id);
      const when = cached && cached.ms ? new Date(cached.ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
      msg.innerHTML = cached ? `<span class="warn">Upland couldn't be reached, so this is the map saved on this device${when ? " (" + when + ")" : ""}.</span>` : `<span class="ok">Loaded ${esc(label)} and ${S.lots.length - 1} lots around it.</span>`;
    } else { selectLot(0); msg.innerHTML = `<span class="warn">Loaded the area, but lot ${esc(id)} wasn't in it. Pick it on the little map.</span>`; }
  }
  $("mapText").addEventListener("paste", () => setTimeout(() => useMap($("mapText").value, false), 0));
  function useMap(text, quiet) {
    const msg = $("mapMsg");
    if (/bearer\s+ey/i.test(text)) {
      msg.innerHTML = `<span class="err">That paste includes your login token. It was cleared. Paste only the Response.</span>`;
      $("mapText").value = ""; return false;
    }
    try { S.lots = PL.parseMap(text); }
    catch (e) { msg.innerHTML = `<span class="err">That isn't the map response. Copy the Response tab of the <b>map?north=…</b> request.</span>`; S.lots = []; S.lotIdx = -1; S.poly = []; $("lotPick").hidden = true; refresh(); return false; }
    if (S.example && !quiet) clearExample(true);
    msg.innerHTML = `<span class="ok">${S.lots.length} lots found.</span>`;
    $("lotSel").innerHTML = S.lots.map((l, i) => {
      const fr = PL.frame(l), a = Math.round(PL.area(l.ring.map(fr.toM)));
      const nb = l.models.filter(m => m.modelType !== "crate").length;
      return `<option value="${i}">${l.id} · ${a.toLocaleString()} m² · ${l.ring.length} corners · ${esc(l.status || "?")}${nb ? " · " + nb + " building" + (nb > 1 ? "s" : "") : ""}</option>`;
    }).join("");
    $("lotPick").hidden = false;
    if (!quiet) { S.sel = null; renderNurs(); selectLot(0); }
    return true;
  }
  $("lotSel").addEventListener("change", () => selectLot(+$("lotSel").value));
  function selectLot(i, keepClicks) {
    S.lotIdx = i; $("lotSel").value = i;
    const lot = S.lots[i];
    S.fr = PL.frame(lot);
    S.poly = lot.ring.map(S.fr.toM);
    S.nurM = lot.models.find(isNursery) || null;   // the nursery Upland has saved here (it's the one being placed, so not an obstacle)
    S.obstacles = lot.models.filter(m => m.size && m.modelType !== "crate" && !isNursery(m)).map(m => PL.modelFoot(m, S.fr));
    if (S.src === "saved" && !keepClicks) { S.src = "shot"; S.shot = null; }   // that picture was drawn for the other lot
    if (!S.example && !keepClicks) { S.lotClicks = []; S.lotDone = false; S.nur = []; S.rough = null; S.quarter = 0; S.autoNur = false; S.askDoor = false; }
    S.switched = null;
    fillSelects(); drawMini(); setHead(); refresh();
  }
  function drawMini() {
    const cv = $("mini"), c = cv.getContext("2d");
    if (!S.lots.length) return;
    const base = PL.frame(S.lots[Math.max(0, S.lotIdx)]);
    const rings = S.lots.map(l => l.ring.map(base.toM));
    const all = rings.flat(), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sc = Math.min((cv.width - 20) / (x1 - x0 || 1), (cv.height - 20) / (y1 - y0 || 1));
    const ox = (cv.width - (x1 - x0) * sc) / 2, oy = (cv.height - (y1 - y0) * sc) / 2;
    const P = (p) => [ox + (p[0] - x0) * sc, oy + (p[1] - y0) * sc];
    S.miniMap = { P, rings };
    c.clearRect(0, 0, cv.width, cv.height);
    rings.forEach((r, i) => {
      c.beginPath(); r.map(P).forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
      c.fillStyle = i === S.lotIdx ? hexA(css("--blue"), 0.35) : hexA(css("--muted"), 0.12); c.fill();
      c.strokeStyle = i === S.lotIdx ? css("--blue") : css("--muted"); c.lineWidth = i === S.lotIdx ? 2.5 : 1; c.stroke();
    });
    c.fillStyle = css("--muted"); c.font = '600 14px "IBM Plex Mono", monospace'; c.fillText("N ↑", 8, 18);
  }
  $("mini").addEventListener("click", (e) => {
    if (!S.miniMap) return;
    const cv = $("mini"), r = cv.getBoundingClientRect();
    const q = [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height];
    const i = S.miniMap.rings.findIndex(ring => G.inPoly(q, ring.map(S.miniMap.P)));
    if (i >= 0) selectLot(i);
  });

  // ---------- step 2: screenshot, outline, nursery ----------
  const drop = $("drop"), file = $("file");
  drop.addEventListener("click", () => file.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  $("replaceBtn").addEventListener("click", () => file.click());
  file.addEventListener("change", () => { if (file.files[0]) loadImage(file.files[0]); file.value = ""; });
  ["dragover", "dragenter"].forEach(t => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadImage(f); });
  document.addEventListener("paste", (e) => {
    if (e.target === $("mapText")) return;
    const it = e.clipboardData && [...e.clipboardData.items].find(x => x.type.startsWith("image/"));
    if (it) { e.preventDefault(); loadImage(it.getAsFile()); }
  });
  function loadImage(f) {
    const img = new Image();
    img.onload = () => {
      if (S.example) clearExample(false);
      S.src = "shot"; S.askDoor = false;
      setShot(img, img.naturalWidth, img.naturalHeight);
      S.lotClicks = []; S.lotDone = false; S.nur = []; S.rough = null; S.quarter = 0; S.autoNur = false; S.pvT = null;
      refresh();
    };
    img.onerror = () => { $("prompt").textContent = "That file didn't open as a picture. Try a PNG or JPG."; };
    img.src = URL.createObjectURL(f);
  }
  function setShot(img, w, h) {
    const off = document.createElement("canvas"); off.width = w; off.height = h;
    const c = off.getContext("2d"); c.drawImage(img, 0, 0);
    let data = null; try { data = c.getImageData(0, 0, w, h).data; } catch (e) {}
    S.shot = { img, w, h, data };
  }
  const N = () => S.poly.length;
  const phase = () => !S.shot ? "none" : !S.lotDone ? "lot" : S.nur.length < 4 ? "nur" : "done";
  function toImg(cv, e, w, h) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * w / r.width, (e.clientY - r.top) * h / r.height]; }
  const shotCv = $("shot");
  function addPoint(p) {
    if (S.src === "saved") return;
    const ph = phase();
    if (ph === "lot") { if (S.lotClicks.length < Math.max(N(), 3)) S.lotClicks.push(p); }
    else if (ph === "nur") { S.nur.push(p); S.autoNur = false; } else return;
    S.rough = null; refresh();
  }
  function showLoupe(p) {
    const lp = $("loupe"), c = lp.getContext("2d"), z = 4, R = 66;
    lp.hidden = false; c.clearRect(0, 0, 132, 132); c.save(); c.beginPath(); c.arc(R, R, R, 0, 7); c.clip();
    c.fillStyle = "#333"; c.fillRect(0, 0, 132, 132);
    c.imageSmoothingEnabled = false; c.drawImage(shotCv, p[0] - R / z, p[1] - R / z, 2 * R / z, 2 * R / z, 0, 0, 132, 132); c.restore();
    c.strokeStyle = "#ff3b6b"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(R, R - 12); c.lineTo(R, R + 12); c.moveTo(R - 12, R); c.lineTo(R + 12, R); c.stroke();
  }
  const placing = () => { const ph = phase(); return S.src !== "saved" && (ph === "lot" || ph === "nur"); };
  // touch: press, slide to aim with the magnifier, lift to place
  shotCv.addEventListener("pointerdown", (e) => {
    if (!S.shot || e.pointerType === "mouse" || !placing()) return;
    e.preventDefault(); S.touching = true; try { shotCv.setPointerCapture(e.pointerId); } catch (x) {}
    S.hover = toImg(shotCv, e, S.shot.w, S.shot.h); drawShot(); showLoupe(S.hover);
  });
  shotCv.addEventListener("pointermove", (e) => {
    if (!S.shot || !placing()) return;
    if (e.pointerType === "mouse" || S.touching) { S.hover = toImg(shotCv, e, S.shot.w, S.shot.h); drawShot(); showLoupe(S.hover); }
  });
  shotCv.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse" || !S.touching) return;
    S.touching = false; S.lastTouch = Date.now(); $("loupe").hidden = true;
    const p = toImg(shotCv, e, S.shot.w, S.shot.h); S.hover = null; addPoint(p);
  });
  shotCv.addEventListener("pointercancel", () => { S.touching = false; S.hover = null; $("loupe").hidden = true; if (S.shot) drawShot(); });
  shotCv.addEventListener("click", (e) => {
    if (!S.shot || Date.now() - (S.lastTouch || 0) < 700) return;
    addPoint(toImg(shotCv, e, S.shot.w, S.shot.h));
  });
  // fit error in metres of an outline against lot i
  function lotErr(i, clicks) {
    const l = S.lots[i], fr = PL.frame(l), poly = l.ring.map(fr.toM);
    if (clicks.length > poly.length) return Infinity;
    const f = PL.lotClicksMatch(clicks, poly);
    return f ? f.rms / f.scale : Infinity;
  }
  $("lotDone").addEventListener("click", () => {
    if (S.lotClicks.length < 3) return;
    // if the outline fits another lot in the map data much better, switch to it
    let mine = lotErr(S.lotIdx, S.lotClicks), switched = null;
    if (mine > 0.5 && S.lots.length > 1) {
      let best = -1, bv = Infinity;
      S.lots.forEach((l, i) => { if (l.ring.length > 14) return; const e = lotErr(i, S.lotClicks); if (e < bv) { bv = e; best = i; } });
      if (best >= 0 && best !== S.lotIdx && bv < 0.4) { selectLot(best, true); switched = S.lots[best].id; mine = bv; }
    }
    if (mine > 0.8) {   // don't move on: the next clicks would land as nursery corners
      S.lotDone = false;
      S.lotWarn = `These ${S.lotClicks.length} dots don't match any lot in the map data (closest is off by ${isFinite(mine) ? mine.toFixed(1) + " m" : "a lot"}). Undo and tap only the lot's corners, going around in order.`;
    } else {
      S.lotDone = true; S.lotWarn = null; S.switched = switched;
      if (!S.nur.length) findNursery(true);   // try to mark the nursery for you
    }
    refresh();
  });
  function findNursery(quiet) {
    if (!S.shot || !S.shot.data) return false;
    const r = PL.detectNursery(S.shot.data, S.shot.w, S.shot.h);
    if (!r) { if (!quiet) { $("fitMsg").hidden = false; $("fitMsg").innerHTML = `<span class="warn">Couldn't find the nursery's green door tabs. Tap its corners instead, door side first.</span>`; } return false; }
    S.nur = r; S.autoNur = true; S.rough = null; return true;
  }
  $("findNurBtn").addEventListener("click", () => { S.nur = []; findNursery(false); refresh(); });
  $("clearNurBtn").addEventListener("click", () => { S.nur = []; S.autoNur = false; S.rough = null; refresh(); });
  $("undoBtn").addEventListener("click", () => { S.lotWarn = null;
    if (S.nur.length) S.nur.pop(); else if (S.lotDone) S.lotDone = false; else S.lotClicks.pop();
    S.rough = null; refresh();
  });
  $("findBtn").addEventListener("click", () => {
    if (!S.shot || !S.shot.data || !N()) return;
    const hull = PL.detectOutline(S.shot.data, S.shot.w, S.shot.h, 0);
    if (!hull || hull.length < 3) { $("fitMsg").hidden = false; $("fitMsg").innerHTML = `<span class="warn">Couldn't find the blue outline. Tap the corners instead.</span>`; return; }
    S.lotClicks = hull; S.lotDone = false; S.lotWarn = null; refresh();
  });
  shotCv.addEventListener("pointerleave", (e) => { if (e.pointerType !== "mouse") return; S.hover = null; $("loupe").hidden = true; if (S.shot) drawShot(); });

  // ---------- step 2 without a screenshot: the spot Upland has saved for the nursery ----------
  // A north-up picture of the lot drawn from the map data stands in for the screenshot, with the lot and nursery already
  // marked, so the same maths gives the taps. The door side (which edge of Upland's nursery model is the entrance) is asked once.
  const bearing = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((Math.atan2(d[0], -d[1]) * 180 / Math.PI) + 360) % 360 / 45) % 8];
  const doorSide = () => { const v = ls.get("af:alDoorSide", null); return v == null ? null : +v; };
  $("useSaved").addEventListener("click", () => { if (doorSide() == null) { S.askDoor = true; refresh(); } else useSaved(doorSide()); });
  $("doors").addEventListener("click", (e) => { const b = e.target.closest("[data-door]"); if (!b) return; ls.set("af:alDoorSide", +b.dataset.door); S.askDoor = false; useSaved(+b.dataset.door); });
  function useSaved(d) {
    if (!S.nurM) return;
    if (S.example) clearExample(true);
    const F = PL.modelFoot(S.nurM, S.fr), foot = [0, 1, 2, 3].map(k => F[(d + k) % 4]);
    const W = 960, H = 640, all = S.poly.concat(foot), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.min((W - 120) / (x1 - x0 || 1), (H - 120) / (y1 - y0 || 1)), c0 = [(x0 + x1) / 2, (y0 + y1) / 2];
    const toS = (w) => [W / 2 + (w[0] - c0[0]) * k, H / 2 + (w[1] - c0[1]) * k];
    const cvs = document.createElement("canvas"); cvs.width = W; cvs.height = H;
    const c = cvs.getContext("2d"), path = (pts) => { c.beginPath(); pts.forEach((p, q) => q ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); };
    c.fillStyle = "#1a2433"; c.fillRect(0, 0, W, H);
    S.lots.forEach((l, j) => { if (j === S.lotIdx) return; path(l.ring.map(S.fr.toM).map(toS)); c.fillStyle = "#202c3d"; c.fill(); c.strokeStyle = "#3a4a61"; c.lineWidth = 1; c.stroke(); });
    path(S.poly.map(toS)); c.fillStyle = "#24344a"; c.fill(); c.strokeStyle = "#0099ff"; c.lineWidth = 4; c.stroke();
    S.obstacles.forEach(o => { path(o.map(toS)); c.fillStyle = "#3b4658"; c.fill(); c.strokeStyle = "#8c9bb1"; c.lineWidth = 1.5; c.stroke(); });
    path(foot.map(toS)); c.fillStyle = "#5c6f8c"; c.fill(); c.strokeStyle = "#a9bbd6"; c.lineWidth = 2; c.stroke();
    setShot(cvs, W, H);
    S.src = "saved"; S.lotClicks = S.poly.map(toS); S.lotDone = true; S.lotWarn = null; S.switched = null;
    S.nur = foot.map(toS); S.autoNur = false; S.rough = null; S.quarter = 0; S.pvT = null;
    refresh();
  }

  // ---------- step 3: controls ----------
  ["alignSel", "cLR", "cFB", "grid", "step"].forEach(id => $(id).addEventListener("input", () => { if (id === "alignSel") S.quarter = 0; solve(); }));
  $("rotL").addEventListener("click", () => { S.quarter -= 1; solve(); });
  $("rotR").addEventListener("click", () => { S.quarter += 1; solve(); });
  $("openBtn").addEventListener("click", () => {
    if (!S.cur || !S.plan) return;
    S.rough = PL.openSpot({ poly: S.poly, obstacles: S.obstacles, cur: S.cur }, S.plan.ang); solve();
  });
  function fillSelects() {
    const edges = S.poly.map((p, i) => `<option value="${i}">Edge ${LET[i]} · ${G.len(G.sub(S.poly[(i + 1) % N()], p)).toFixed(1)} m</option>`).join("");
    const a0 = $("alignSel").value;
    $("alignSel").innerHTML = `<option value="auto">Nearest edge (least turning)</option>` + edges + `<option value="-1">Keep its current angle</option>`;
    if (a0 && $("alignSel").querySelector(`option[value="${a0}"]`)) $("alignSel").value = a0;
  }
  function alignEdge() {
    const v = $("alignSel").value;
    if (v === "-1") return -1;
    if (v !== "auto") return +v;
    // edge whose direction is closest (mod 90°) to the nursery's current angle; longer edges win ties
    let best = 0, bv = Infinity;
    S.poly.forEach((p, i) => {
      const a = PL.edgeAngle(S.poly, i) * 180 / Math.PI, off = Math.abs(PL.normDeg(a - S.cur.ang * 180 / Math.PI));
      const len = G.len(G.sub(S.poly[(i + 1) % N()], p)), score = off - len * 0.02;
      if (score < bv) { bv = score; best = i; }
    });
    return best;
  }

  // ---------- drawing ----------
  function marker(c, p, label, color, r) {
    c.fillStyle = color; c.strokeStyle = "#fff"; c.lineWidth = r * 0.35;
    c.beginPath(); c.arc(p[0], p[1], r, 0, 7); c.fill(); c.stroke();
    c.font = `600 ${r * 2.2}px "IBM Plex Mono", monospace`; c.lineWidth = r * 0.5; c.strokeStyle = "rgba(0,0,0,.65)"; c.fillStyle = "#fff";
    c.strokeText(label, p[0] + r * 1.4, p[1] - r * 1.2); c.fillText(label, p[0] + r * 1.4, p[1] - r * 1.2);
  }
  function poly(c, pts, color, w, close, fill, dash) {
    pts = pts.filter(Boolean); if (!pts.length) return;
    c.save(); c.setLineDash(dash || []); c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => c.lineTo(p[0], p[1]));
    if (close) c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } c.strokeStyle = color; c.lineWidth = w; c.stroke(); c.restore();
  }
  function seg(c, a, b, color, w) { c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  function hexA(col, al) { const m = String(col).match(/^#([0-9a-f]{6})$/i); if (!m) return col; const v = parseInt(m[1], 16); return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${al})`; }
  function drawShot() {
    const cv = $("shot"), s = S.shot; cv.width = s.w; cv.height = s.h;
    const c = cv.getContext("2d"); c.drawImage(s.img, 0, 0);
    const r = Math.max(4, Math.max(s.w, s.h) / 150), blue = css("--blue"), amber = css("--amber");
    poly(c, S.lotClicks, blue, r * 0.6, S.lotDone);
    if (S.src !== "saved") S.lotClicks.forEach((p, k) => marker(c, p, String(k + 1), blue, r));
    poly(c, S.nur, amber, r * 0.6, S.nur.length === 4, S.nur.length === 4 ? "rgba(246,181,82,.18)" : null);
    const ph = phase(), hv = S.hover;
    if (hv && placing()) {   // live line to the pointer, and the closing line back to the first dot
      const arr = ph === "lot" ? S.lotClicks : S.nur, col = ph === "lot" ? blue : amber;
      if (arr.length) {
        seg(c, arr[arr.length - 1], hv, col, r * 0.45);
        if (arr.length >= 2) { c.save(); c.setLineDash([r * 1.2, r * 0.9]); seg(c, hv, arr[0], col, r * 0.35); c.restore(); }
      }
      c.strokeStyle = col; c.lineWidth = r * 0.3; c.beginPath(); c.arc(hv[0], hv[1], r * 0.9, 0, 7); c.stroke();
    }
    if (S.nur.length >= 2) seg(c, S.nur[0], S.nur[1], "#5ee38f", r * 0.9);
    S.nur.forEach((p, k) => marker(c, p, k < 2 ? "D" + (k + 1) : "N" + (k + 1), amber, r));
  }
  function drawPreview() {
    const s = S.shot, f = S.fit, P = S.plan, cv = $("preview");
    const pts = S.poly.map(f.toS).concat(S.foot.map(f.toS), P ? P.target.map(f.toS) : []);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    if (!S.pvT || !S.dragging) {
      const pad = Math.max(bx1 - bx0, by1 - by0) * 0.2;
      bx0 -= pad; bx1 += pad; by0 -= pad; by1 += pad;
      const sf = Math.min(4, 900 / (bx1 - bx0));
      S.pvT = { ox: bx0, oy: by0, sf, w: Math.round((bx1 - bx0) * sf), h: Math.round((by1 - by0) * sf) };
    }
    const T = S.pvT; cv.width = T.w; cv.height = T.h;
    const c = cv.getContext("2d");
    c.fillStyle = css("--sunk") || "#555"; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(T.sf, 0, 0, T.sf, -T.ox * T.sf, -T.oy * T.sf);
    c.drawImage(s.img, 0, 0);
    c.fillStyle = "rgba(0,0,0,.45)"; c.fillRect(T.ox, T.oy, T.w / T.sf, T.h / T.sf);
    const w = Math.max(0.6, (T.w / T.sf) / 260);
    S.obstacles.forEach(o => poly(c, o.map(f.toS), "#ff5a8a", w, true, "rgba(255,90,138,.25)"));
    poly(c, S.poly.map(f.toS), css("--blue"), w * 1.4, true);
    if (P) {   // paver grid around the lot, in the nursery's directions
      const nrm = [Math.cos(P.ang), Math.sin(P.ang)], tan = [-Math.sin(P.ang), Math.cos(P.ang)];
      const A = S.poly[P.refI], ext = 90;
      c.save(); c.beginPath(); S.poly.map(f.toS).forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.clip();
      c.strokeStyle = "rgba(255,255,255,.10)"; c.lineWidth = w * 0.5;
      for (let k = -75; k <= 75; k++) {
        const o1 = G.add(A, G.mul(tan, k * PL.GRID)), o2 = G.add(A, G.mul(nrm, k * PL.GRID));
        const a1 = f.toS(G.add(o1, G.mul(nrm, -ext))), b1 = f.toS(G.add(o1, G.mul(nrm, ext)));
        const a2 = f.toS(G.add(o2, G.mul(tan, -ext))), b2 = f.toS(G.add(o2, G.mul(tan, ext)));
        c.beginPath(); c.moveTo(a1[0], a1[1]); c.lineTo(b1[0], b1[1]); c.moveTo(a2[0], a2[1]); c.lineTo(b2[0], b2[1]); c.stroke();
      }
      c.restore();
    }
    c.font = `700 ${w * 10}px "IBM Plex Mono", monospace`; c.textAlign = "center"; c.textBaseline = "middle";
    const cen = f.toS(G.centroid(S.poly));
    S.poly.forEach((p, i) => {
      const m = f.toS(G.mul(G.add(p, S.poly[(i + 1) % N()]), 0.5)), dir = G.sub(m, cen), L = G.len(dir) || 1;
      const q = G.add(m, G.mul(dir, (w * 12) / L));
      c.lineWidth = w * 2; c.strokeStyle = "rgba(0,0,0,.7)"; c.strokeText(LET[i], q[0], q[1]); c.fillStyle = "#fff"; c.fillText(LET[i], q[0], q[1]);
    });
    const Fs = S.foot.map(f.toS);
    poly(c, Fs, css("--amber"), w, true, null, [w * 3, w * 2]);
    seg(c, Fs[0], Fs[1], css("--amber"), w * 2.5);
    if (P) {
      const Ts = P.target.map(f.toS);
      poly(c, Ts, css("--accent"), w * 1.3, true, hexA(css("--accent"), 0.3));
      seg(c, Ts[0], Ts[1], "#ffffff", w * 3);
      const mid = G.mul(G.add(Ts[0], Ts[1]), 0.5), cc = f.toS(P.c), d = G.sub(mid, cc), L = G.len(d) || 1;
      const tip = G.add(mid, G.mul(d, w * 9 / L));
      seg(c, mid, tip, "#ffffff", w * 1.5);
      c.fillStyle = "#fff"; c.font = `700 ${w * 8}px "IBM Plex Sans", sans-serif`;
      const lab = G.add(tip, G.mul(d, w * 7 / L)); c.lineWidth = w * 2; c.strokeStyle = "rgba(0,0,0,.7)"; c.strokeText("door", lab[0], lab[1]); c.fillText("door", lab[0], lab[1]);
    }
    // compass for the arrow buttons
    c.setTransform(1, 0, 0, 1, 0, 0);
    const W2 = cv.width / 260, o = [W2 * 34, W2 * 34], LL = W2 * 22;
    c.fillStyle = "rgba(0,0,0,.6)"; c.beginPath(); c.arc(o[0], o[1], W2 * 31, 0, 7); c.fill();
    [["→", [1, 0], css("--accent")], ["↑", [0, -1], "#ffffff"]].forEach(([lab, v, col]) => {
      const d = screenDir(v), e = [o[0] + d[0] * LL, o[1] + d[1] * LL];
      seg(c, o, e, col, W2 * 1.6);
      c.fillStyle = col; c.font = `700 ${W2 * 11}px "IBM Plex Mono", monospace`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(lab, o[0] + d[0] * (LL + W2 * 6), o[1] + d[1] * (LL + W2 * 6));
    });
  }
  function screenDir(v) { const f = S.fit, c0 = G.centroid(S.poly); const d = G.sub(f.toS(G.add(c0, v)), f.toS(c0)), l = G.len(d) || 1; return [d[0] / l, d[1] / l]; }

  // drag the target on the preview
  const pv = $("preview");
  const pvWorld = (e) => { const T = S.pvT, q = toImg(pv, e, T.w, T.h); return S.fit.toW([q[0] / T.sf + T.ox, q[1] / T.sf + T.oy]); };
  pv.addEventListener("pointerdown", (e) => {
    if (!S.plan) return;
    S.dragging = true; pv.classList.add("drag"); pv.setPointerCapture(e.pointerId);
    const w = pvWorld(e); S.dragOff = G.inPoly(w, S.plan.target) ? G.sub(S.rough, w) : [0, 0];
    S.rough = G.add(w, S.dragOff); solve();
  });
  pv.addEventListener("pointermove", (e) => { if (!S.dragging) return; S.rough = G.add(pvWorld(e), S.dragOff); solve(); });
  const endDrag = () => { if (!S.dragging) return; S.dragging = false; pv.classList.remove("drag"); solve(); };
  pv.addEventListener("pointerup", endDrag); pv.addEventListener("pointercancel", endDrag);

  // ---------- refresh ----------
  function refresh() {
    $("banner").hidden = !S.example;
    const has = !!S.shot, saved = S.src === "saved";
    drop.hidden = has || S.askDoor; $("shotBox").hidden = !has || S.askDoor; $("shotBar").hidden = !has || S.askDoor;
    $("savedRow").hidden = !S.nurM || saved || S.askDoor || S.example || (has && phase() !== "lot");
    $("doorAsk").hidden = !S.askDoor;
    if (S.askDoor && S.nurM) {
      const F = PL.modelFoot(S.nurM, S.fr), c = G.centroid(F);
      $("doors").innerHTML = [0, 1, 2, 3].map(i => { const m = G.mul(G.add(F[i], F[(i + 1) % 4]), 0.5); return `<button type="button" class="ghost" data-door="${i}">Faces ${bearing(G.sub(m, c))}</button>`; }).join("");
    }
    if (has) drawShot();
    const ph = phase(), pr = $("prompt");
    const tag = $("phaseTag");
    tag.hidden = !has || !N() || S.askDoor;
    tag.className = "phase " + (ph === "lot" ? "is-lot" : ph === "nur" ? "is-nur" : "is-done");
    tag.innerHTML = saved ? "Using the spot Upland has saved for the nursery" : ph === "lot" ? "Now outlining the <b>lot</b> (blue dots)" : ph === "nur" ? "Now marking the <b>nursery building</b> (orange dots), not the lot" : "Lot and nursery marked";
    if (!N()) pr.innerHTML = "Pick the lot in step 1 first.";
    else if (saved) pr.innerHTML = "No screenshot needed. If you've moved it in move mode since, use a screenshot instead.";
    else if (ph === "lot") pr.innerHTML = !S.lotClicks.length ? `Press <b>Find outline</b>, or tap lot corner <span class="k">1</span> and go around the lot.` : S.lotClicks.length >= 3 ? `Tap more lot corners, or press <b>Lot done</b> if the blue dots sit on the lot's corners.` : `Tap lot corner <span class="k">${S.lotClicks.length + 1}</span>, going around the lot.`;
    else if (ph === "nur") pr.innerHTML = S.nur.length < 2 ? `<b>Nursery:</b> tap door-side corner <span class="k">D${S.nur.length + 1}</span> (the white entrance side).` : `<b>Nursery:</b> tap back corner <span class="k">N${S.nur.length + 1}</span>, continuing around.`;
    else if (ph === "done") pr.innerHTML = S.autoNur ? "Found the nursery for you (orange). If it's off, press <b>Clear nursery</b> and tap its corners, door side first." : "Done. Now drag the green nursery on the map.";
    pr.classList.toggle("done", ph === "done");
    $("lotDone").hidden = ph !== "lot" || saved; $("lotDone").disabled = S.lotClicks.length < 3;
    $("findBtn").hidden = ph !== "lot" || !N() || saved;
    $("findBtn").className = ph === "lot" && !S.lotClicks.length ? "primary" : "ghost";
    $("findNurBtn").hidden = !(ph === "nur" || ph === "done") || saved;
    $("clearNurBtn").hidden = !S.nur.length || saved;
    $("undoBtn").hidden = saved;
    $("replaceBtn").textContent = saved ? "Use a screenshot instead" : "New screenshot";
    shotCv.style.touchAction = placing() ? "none" : "pan-y";
    shotCv.style.cursor = placing() ? "crosshair" : "default";
    $("undoBtn").disabled = !S.lotClicks.length && !S.nur.length;
    S.fit = null;
    const fm = $("fitMsg");
    if (N() && S.lotDone && S.lotClicks.length >= 3) {
      S.fit = PL.lotClicksMatch(S.lotClicks, S.poly);
      fm.hidden = false;
      const err = S.fit ? S.fit.rms / S.fit.scale : 99;
      S.fitErr = err;
      fm.innerHTML = saved ? `From where Upland has the nursery saved on lot ${esc(S.lots[S.lotIdx].id)}.`
        : !S.fit || err > 0.8 ? `<span class="warn">Those corners don't match lot ${esc(S.lots[S.lotIdx].id)} (off by about ${err.toFixed(1)} m), and no other lot in the map data fits better. Check the lot in step 1, then Undo and tap only the lot's corners, going around in order.</span>`
        : `${S.switched ? `<b>Switched to lot ${esc(S.switched)}</b>, which your outline matches. ` : ""}Outline matched to the map data within ${Math.max(1, Math.round(err * 100))} cm (${S.lotClicks.length} of ${N()} corners).`;
    } else if (S.lotWarn && phase() === "lot") { fm.hidden = false; fm.innerHTML = `<span class="warn">${S.lotWarn}</span>`; }
    else fm.hidden = true;
    accordion();
    solve();
  }
  // ---------- accordion: only the step in progress stays open ----------
  S.userOpen = {};
  document.querySelectorAll(".step h2").forEach((h) => h.addEventListener("click", () => {
    const sec = h.parentElement; S.userOpen[sec.id] = sec.classList.contains("collapsed"); accordion();
  }));
  $("stepper").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]"); if (!b) return;
    S.userOpen[b.dataset.step] = true; accordion();
    try { $(b.dataset.step).scrollIntoView({ behavior: "smooth", block: "start" }); } catch (x) {}
  });
  function accordion() {
    const ph = phase();
    let nurOk = false;
    if (ph === "done" && S.fit) { const di = PL.doorInfo(S.nur.map(S.fit.toW)); nurOk = Math.min(di.w, di.h) >= 9 && Math.max(di.w, di.h) <= 25; }
    const active = !S.lots.length || S.lotIdx < 0 ? "s1" : ph !== "done" || S.fitErr > 0.8 || !nurOk ? "s2" : "s3";
    if (S.lastActive !== active) { S.userOpen = {}; S.lastActive = active; }
    const lot = S.lots[S.lotIdx], n = S.sel && lot && S.sel.prop === lot.id ? S.sel : null;
    const sums = {
      s1: lot ? `${n ? n.name + " · " : "Lot " + lot.id + " · "}${Math.round(PL.area(S.poly)).toLocaleString()} m²` : "Not picked",
      s2: S.src === "saved" ? "Saved spot" : !S.shot ? "No screenshot yet" : ph === "done" ? `Outline ${S.lotClicks.length} corners · nursery marked` : ph === "nur" ? "Marking the nursery" : "Outlining the lot",
      s3: S.plan ? `${$("alignSel").selectedOptions[0] ? $("alignSel").selectedOptions[0].textContent.split(" ·")[0] : ""}${$("cLR").checked && $("cFB").checked ? " · dead centre" : ""}` : ""
    };
    const order = ["s1", "s2", "s3"], ai = order.indexOf(active);
    order.forEach((id, i) => {
      const sec = $(id), open = id === active || S.userOpen[id] || (id === "s2" && S.autoNur && ph === "done");
      sec.classList.toggle("collapsed", !open);
      sec.classList.toggle("current", id === active);
      sec.classList.toggle("ok", i < ai);
      sec.querySelector(".sum").textContent = open ? "" : sums[id];
      const b = document.querySelector(`#stepper [data-step="${id}"]`);
      b.classList.toggle("cur", id === active); b.classList.toggle("done", i < ai);
      if (id === active) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
  }
  PL.lotClicksMatch = (clicks, poly) => clicks.length === poly.length ? PL.matchCorners(clicks, poly) || PL.matchSubset(clicks, poly) : PL.matchSubset(clicks, poly);

  function noPlan(html) {
    $("answer").innerHTML = html; $("pvBox").hidden = $("legend").hidden = true; $("see3d").hidden = true; S.plan = null; dock(null);
  }
  function solve() {
    const ans = $("answer");
    if (!S.fit || S.nur.length !== 4) return noPlan(`<p class="empty">${!S.lots.length ? "Pick the lot and add a screenshot to see the taps." : "Finish step 2 to see the taps."}</p>`);
    if (S.fitErr > 0.8) return noPlan(`<p class="warn">The outline doesn't match the lot yet, so the taps would be wrong. See the note under the screenshot.</p>`);
    S.foot = S.nur.map(S.fit.toW);
    S.cur = PL.doorInfo(S.foot);
    const big = Math.max(S.cur.w, S.cur.h), small = Math.min(S.cur.w, S.cur.h);
    if (small < 9 || big > 25) return noPlan(`<p class="warn">Those nursery corners measure ${S.cur.w.toFixed(1)} × ${S.cur.h.toFixed(1)} m, but a nursery is about 15.6 × 16.3 m. They're probably on the lot, not the building. Press Undo until the orange dots are gone, then tap the corners of the nursery building, door side first.</p>`);
    if (!S.rough) S.rough = S.cur.c.slice();
    const ae = alignEdge();
    const st = Math.max(0.001, parseFloat($("step").value) || 0.05);
    S.plan = PL.manual({ poly: S.poly, obstacles: S.obstacles, cur: S.cur, rough: S.rough, alignEdge: ae, quarter: S.quarter,
      centreLR: $("cLR").checked, centreFB: $("cFB").checked, grid: $("grid").checked, step: st });
    S.plan.refI = ae >= 0 ? ae : 0;
    const P = S.plan;
    const dirE = screenDir([P.east >= 0 ? 1 : -1, 0]), dirN = screenDir([0, P.north >= 0 ? -1 : 1]);
    const rot = (d) => (Math.atan2(d[1], d[0]) * 180 / Math.PI).toFixed(0);
    const tAbs = Math.abs(P.turn), tDir = P.turn > 0 ? "clockwise" : "counter-clockwise";
    const turnTxt = tAbs < 0.3 ? "No turn needed." : `Then turn it <b>${tAbs.toFixed(1)}°</b> ${tDir} on the rotation screen. It turns on its centre, so the taps still hold.`;
    const line = `${P.ewKey} ${P.ew}, ${P.nsKey} ${P.ns}${tAbs >= 0.3 ? `, turn ${tAbs.toFixed(1)}° ${tDir}` : ""}`;
    const g = (v) => isFinite(v) ? `${v.toFixed(2)} m<em>${(v / PL.GRID).toFixed(1)} pavers</em>` : "open";
    const edgeName = ae >= 0 ? `edge ${LET[ae]}` : "its current angle";
    const inPlace = Math.hypot(P.east, P.north) < st * 0.75 && tAbs < 0.3;
    const hint = (d, word) => S.src === "saved" ? `<span class="hint">${word}</span>` : `<span class="hint">goes <i style="transform:rotate(${rot(d)}deg)">→</i> on screen</span>`;
    ans.innerHTML = `
      ${inPlace ? `<div class="isdone">It's already in place. Nothing to tap.</div>` : ""}
      <div class="taps">
        <div class="tap" data-tap="ew"><span class="key">Tap</span><div class="row"><span class="arrow">${P.ewKey}</span><span class="n">${P.ew}</span></div>
          ${hint(dirE, P.east >= 0 ? "east" : "west")}</div>
        <div class="tap" data-tap="ns"><span class="key">Tap</span><div class="row"><span class="arrow">${P.nsKey}</span><span class="n">${P.ns}</span></div>
          ${hint(dirN, P.north >= 0 ? "north" : "south")}</div>
      </div>
      <div class="turn">${turnTxt}</div>
      <div class="line"><span id="lineTxt">${line}</span><button type="button" class="ghost" id="copy">Copy</button></div>
      ${P.inside < 0 ? `<p class="warn">It doesn't fit inside the lot here. Drag it somewhere roomier or turn it.</p>` : ""}
      ${P.obGap < 0.3 ? `<p class="warn">It would touch another building on the lot.</p>` : ""}
      <dl class="facts">
        <dt>Squared to</dt><dd>${edgeName}</dd>
        <dt>Front (door)</dt><dd>${g(P.gaps.front)}</dd>
        <dt>Back</dt><dd>${g(P.gaps.back)}</dd>
        <dt>Left</dt><dd>${g(P.gaps.left)}</dd>
        <dt>Right</dt><dd>${g(P.gaps.right)}</dd>
        <dt>Nursery</dt><dd>${S.cur.w.toFixed(1)} × ${S.cur.h.toFixed(1)} m</dd>
        ${S.src !== "saved" ? `<dt>Outline fit</dt><dd>${Math.max(1, Math.round(S.fitErr * 100))} cm</dd>` : ""}
      </dl>
      <p class="note">Arrows move by compass (→ east, ↑ north), ${(st * 100).toFixed(1)} cm a tap. Gaps run straight out from each side to the lot edge or another building. Screenshot after tapping and run it again to fine-tune.</p>`;
    $("copy").addEventListener("click", (e) => copyLine(e.currentTarget, line));
    drawPreview(); $("pvBox").hidden = $("legend").hidden = false;
    const lot = S.lots[S.lotIdx];
    $("see3d").hidden = S.example || !lot;
    if (lot) $("see3d").href = `nursery3d.html?prop=${encodeURIComponent(lot.id)}&ghost=1`;
    dock({ P, tAbs, tDir, line });
  }
  function copyLine(b, line) {
    const ok = () => { const t = b.textContent; b.textContent = "Copied"; setTimeout(() => { b.textContent = t === "Copied" ? "Copy" : t; }, 1400); };
    const sel = () => { const el = $("lineTxt"); if (!el) return; const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(line).then(ok, sel); else sel();
  }
  // phone: the taps pinned to the bottom of the screen, in reach of a thumb
  function dock(d) {
    S.dockLine = d ? d.line : null;
    $("dock").hidden = !d; document.body.classList.toggle("has-dock", !!d);
    if (d) $("dockTaps").innerHTML = `<span><em>${d.P.ewKey}</em>${d.P.ew}</span><span><em>${d.P.nsKey}</em>${d.P.ns}</span>${d.tAbs >= 0.3 ? `<small>turn ${d.tAbs.toFixed(1)}° ${d.tDir === "clockwise" ? "↻" : "↺"}</small>` : ""}`;
  }
  $("dockCopy").addEventListener("click", (e) => { if (S.dockLine) copyLine(e.currentTarget, S.dockLine); });
  // the planned spot, for the 3D page (nursery3d.html?ghost=1 shows it on the lot)
  $("see3d").addEventListener("click", () => {
    const lot = S.lots[S.lotIdx]; if (!S.plan || !lot) return;
    ls.set("af:alGhost", { prop: lot.id, target: S.plan.target.map(S.fr.fromM), now: S.foot.map(S.fr.fromM), line: "Taps: " + S.dockLine, ms: Date.now() });
  });

  // ---------- example ----------
  function clearExample(keepMap) {
    S.example = false; S.shot = null; S.lotClicks = []; S.lotDone = false; S.nur = []; S.rough = null; S.quarter = 0; S.pvT = null; S.src = "shot";
    if (!keepMap) { S.lots = []; S.lotIdx = -1; S.poly = []; S.obstacles = []; S.nurM = null; $("lotPick").hidden = true; $("mapText").value = ""; $("mapMsg").innerHTML = ""; }
    setHead();
  }
  $("clearEx").addEventListener("click", () => {
    clearExample(false); refresh();
    const n = S.nurs.find(x => x.prop === ls.get("af:alLast", null)) || S.nurs[0];
    if (n) pick(n); else { $("more").open = true; $("userIn").focus(); }
  });
  $("exBtn").addEventListener("click", async () => {
    try { const j = await (await fetch("aligner/example.json")).json(); loadExample({ map: JSON.stringify(j.map), lot: j.lot, ghost: j.ghost }); }
    catch (e) { $("mapMsg").innerHTML = `<span class="err">The example didn't load.</span>`; }
  });
  function loadExample(EX) {
    S.example = true; S.sel = null; S.src = "shot"; S.askDoor = false; renderNurs();
    useMap(EX.map, true);
    const i = S.lots.findIndex(l => l.id === EX.lot);
    selectLot(i);
    const k = 5.7, ph = -105.4 * Math.PI / 180, cvs = document.createElement("canvas"); cvs.width = 960; cvs.height = 640;
    const c0 = G.centroid(S.poly), cc = [k * Math.cos(ph), k * Math.sin(ph)];
    const toS = (w) => G.add([470, 320], G.cmul(G.sub(w, c0), cc));
    const c = cvs.getContext("2d");
    c.fillStyle = "#e7e9ec"; c.fillRect(0, 0, 960, 640);
    S.lots.forEach((l, j) => { if (j === i) return; const r = l.ring.map(S.fr.toM).map(toS); c.beginPath(); r.forEach((p, q) => q ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = "#eff1f3"; c.fill(); c.strokeStyle = "#a9b0b8"; c.lineWidth = 1; c.stroke(); });
    const lotS = S.poly.map(toS);
    c.beginPath(); lotS.forEach((p, q) => q ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = "#f2f3f4"; c.fill(); c.strokeStyle = "#0099ff"; c.lineWidth = 4; c.stroke();
    S.obstacles.forEach(o => { const q = o.map(toS); c.beginPath(); q.forEach((p, z) => z ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = "#ffffff"; c.fill(); c.strokeStyle = "#5b6475"; c.lineWidth = 1.5; c.stroke(); });
    const g = EX.ghost.map(S.fr.toM).map(toS);   // door side first
    c.beginPath(); g.forEach((p, z) => z ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = "#8fa9c8"; c.fill(); c.strokeStyle = "#3f5670"; c.lineWidth = 2; c.stroke();
    const t = (a, b, u) => G.add(a, G.mul(G.sub(b, a), u));
    const band = [g[0], g[1], t(g[1], g[2], 0.3), t(g[0], g[3], 0.3)];
    c.fillStyle = "#5ae35a"; c.beginPath(); band.forEach((p, z) => z ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill();
    c.fillStyle = "#f4f6f8"; const wb = [t(band[0], band[1], 0.3), t(band[0], band[1], 0.7), t(band[3], band[2], 0.7), t(band[3], band[2], 0.3)];
    c.beginPath(); wb.forEach((p, z) => z ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill();
    setShot(cvs, 960, 640);
    S.lotClicks = lotS.map(p => p.slice()); S.lotDone = true;
    S.nur = g.map(p => p.slice()); S.pvT = null;
    $("alignSel").value = "0"; $("cLR").checked = true; $("cFB").checked = true; $("grid").checked = true;
    setHead(); refresh();
  }

  // ---------- start: the nursery from the link, else the last one aligned, else the first ----------
  refresh();
  (async () => {
    await loadKnown();
    renderNurs();
    let n = null;
    if (Q_PROP) n = S.nurs.find(x => x.prop === Q_PROP) || { prop: Q_PROP, shop: null, name: "Lot " + Q_PROP, city: "", st: "" };
    else if (Q_SHOP) n = S.nurs.find(x => x.shop === Q_SHOP) || { prop: null, shop: Q_SHOP, name: "Shop " + Q_SHOP, city: "", st: "" };
    else n = S.nurs.find(x => x.prop && x.prop === ls.get("af:alLast", null)) || S.nurs[0] || null;
    if (n && !S.nurs.includes(n)) { S.nurs.unshift(n); renderNurs(); }
    if (n) pick(n); else { $("more").open = true; refresh(); }
  })();
  new MutationObserver(() => { drawMini(); refresh(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
