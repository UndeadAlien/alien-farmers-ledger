// Alien Farmers Ledger · nursery lot in 3D (v51)
// Builds a lot from Upland's own map data: the lot outline, every model placed on it (same files, positions,
// turns and sizes the game uses) and the neighbouring lots, then lets you orbit, walk or take an automatic tour.
import * as T from "./vendor/three/three-lot.js";

const M_DEG = 111195.08;
const BASE = "https://static.upland.me/";
const HERE = new URL(".", import.meta.url).href;

// ---------- loaders, shared by every view (models are fetched once per session) ----------
let SHARED = null;
function shared(renderer){
  if (!SHARED) {
    const manager = new T.LoadingManager();
    manager.setURLModifier(u => (SHARED.rewrite ? SHARED.rewrite(u) : u));
    const draco = new T.DRACOLoader(manager).setDecoderPath(HERE + "vendor/three/draco/");
    const ktx2 = new T.KTX2Loader(manager).setTranscoderPath(HERE + "vendor/three/basis/");
    const gltf = new T.GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(T.MeshoptDecoder);
    gltf.setCrossOrigin("anonymous");
    const tex = new T.TextureLoader(manager); tex.setCrossOrigin("anonymous");
    SHARED = {gltf, tex, ktx2, models: new Map(), textures: new Map(), rewrite: null};
  }
  if (renderer) { try { SHARED.ktx2.detectSupport(renderer); } catch {} }
  return SHARED;
}
export function setRewrite(fn){ shared(null).rewrite = fn; }
export const fullUrl = p => !p ? null : /^local:/i.test(p) ? new URL(p.slice(6), document.baseURI).href : /^https?:/i.test(p) ? p : BASE + (/^\/?3d-models\//.test(p) ? p.replace(/^\/+/, "") : "3d-models/" + p.replace(/^\/+/, ""));
function loadModel(url){
  const S = shared(null);
  if (!S.models.has(url)) S.models.set(url, S.gltf.loadAsync(url).catch(e => { setTimeout(() => S.models.delete(url), 60e3); throw e; }));   // a file that failed isn't asked for again for a minute
  return S.models.get(url);
}
function loadTex(url){
  const S = shared(null);
  if (!S.textures.has(url)) S.textures.set(url, S.tex.loadAsync(url).then(t => { t.flipY = false; t.colorSpace = T.SRGBColorSpace; return t; }).catch(e => { S.textures.delete(url); throw e; }));
  return S.textures.get(url);
}

// ---------- reading Upland's model list ----------
const lodKeys = m => Object.keys(m.lods || {}).sort((a, b) => +a - +b);
export function lodOf(m, q){   // q: "hi" = most detail (LOD 0), "mid", "lo" = least detail
  const ks = lodKeys(m); if (!ks.length) return m.model ? {url: fullUrl(m.model), tex: null} : null;
  const k = q === "hi" ? ks[0] : q === "lo" ? ks[ks.length - 1] : ks[Math.min(1, ks.length - 1)];
  const L = m.lods[k] || {}; return {url: fullUrl(L.modelUrl || L.model), tex: fullUrl(L.textureUrl || L.texture || null)};
}
const pretty = s => String(s || "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase());
const hashy = s => /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && s.length > 18;
export function plantOf(m){
  const u = (lodOf(m, "hi") || {}).url || m.model || "";
  const g = /\/(?:plants?|trees?|flowers?|shrubs?|seeds?)\/([^/]+?)(?:[_\-](?:phase|stage|lod)[_\-]?\d+.*)?(?:\/|\.gl)/i.exec(u);
  if (g && !hashy(g[1])) return pretty(g[1].replace(/[_\-]?(phase|stage)\d+$/i, ""));
  if (/plant|tree|flower|shrub/i.test(m.modelType || "")) return pretty(m.subType || m.modelType);
  return null;
}
export function nameOf(m){
  if (m.name) return m.name;
  if (m.metadata && m.metadata.name) return m.metadata.name;
  const plant = plantOf(m); if (plant) return plant;
  const t = m.modelType || "", st = m.subType || "";
  if (/nursery/i.test(st)) return "Nursery";
  if (t === "totem") return "Totem";
  if (t === "car") return "Vehicle";
  if (t === "building") {
    const u = ((lodOf(m, "hi") || {}).url || "").replace(BASE + "3d-models/", "").split("/");
    const seg = u.length > 1 ? u[u.length - 2] : "";
    if (seg && !hashy(seg) && !/^(lods?|\d+|ornaments|buildings?)$/i.test(seg)) return pretty(seg.replace(/_?lod\d+$/i, ""));
    return st ? pretty(st) + " building" : "Building";
  }
  if (t === "crate") return "Crate";
  if (t === "decor") return "Decoration";
  return pretty(t || "Item");
}
export const kindOf = m => plantOf(m) ? "plant" : (m.modelType === "building" ? (/nursery/i.test(m.subType || "") ? "nursery" : "building") : m.modelType || "item");

// local metres around the lot centre: x east, z south, y up
const toXZ = (lat, lng, c) => [(lng - c.lng) * M_DEG * Math.cos(c.lat * Math.PI / 180), (c.lat - lat) * M_DEG];
const ringOf = (geo, c) => { try { const g = typeof geo === "string" ? JSON.parse(geo) : geo; const r = g.type === "MultiPolygon" ? g.coordinates[0][0] : g.coordinates[0]; return r.map(([lng, lat]) => toXZ(lat, lng, c)); } catch { return null; } };
const inRing = (x, z, R) => { let ins = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins; } return ins; };

export {toXZ, ringOf};

// ---------- the view ----------
// opt: {still, drag: "map"|"orbit", speed (walk m/s), shadows, labels, light (lower quality)}
export function createLotView(canvas, opt = {}){
  const still = !!opt.still;
  const renderer = new T.WebGLRenderer({canvas, antialias: true, alpha: false, preserveDrawingBuffer: still, powerPreference: still ? "low-power" : "high-performance"});
  const prMax = () => still ? 1 : opt.light ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(prMax());
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4;
  shared(renderer);

  const scene = new T.Scene();
  const pmrem = new T.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new T.RoomEnvironment(), 0.04); scene.environment = envRT.texture;
  if ("environmentIntensity" in scene) scene.environmentIntensity = .55;

  // sky: a big dome coloured by height (vertex colours, so it follows the renderer's colour handling)
  const HORIZON = new T.Color("#cfe2e6"), MID = new T.Color("#7fb2d8"), TOP = new T.Color("#2f67a8");
  const skyGeo = new T.SphereGeometry(2000, 32, 20), cols = [], pos = skyGeo.attributes.position, tmp = new T.Color();
  for (let i = 0; i < pos.count; i++) { const h = pos.getY(i) / 2000; if (h <= 0) tmp.copy(HORIZON); else if (h < .25) tmp.copy(HORIZON).lerp(MID, h / .25); else tmp.copy(MID).lerp(TOP, Math.min(1, (h - .25) / .75)); cols.push(tmp.r, tmp.g, tmp.b); }
  skyGeo.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
  const sky = new T.Mesh(skyGeo, new T.MeshBasicMaterial({vertexColors: true, side: T.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false}));
  sky.renderOrder = -100; sky.frustumCulled = false; scene.add(sky);
  // fog only softens the far horizon; it follows the camera so the lot is always crisp, however far out you zoom
  scene.fog = new T.Fog(HORIZON, 400, 1800);

  const hemi = new T.HemisphereLight(0xdcecff, 0x4a4234, 1.1); scene.add(hemi);
  const sun = new T.DirectionalLight(0xfff0d8, 2.4); sun.castShadow = opt.shadows !== false;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const camera = new T.PerspectiveCamera(48, 1, 0.2, 6000);
  camera.position.set(40, 35, 40);
  let controls = null;
  if (!still) {
    controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = .1; controls.maxPolarAngle = Math.PI * .485; controls.minDistance = 1.5; controls.maxDistance = 900;
    controls.screenSpacePanning = false; controls.zoomToCursor = true; controls.zoomSpeed = 1.2; controls.panSpeed = 1; controls.rotateSpeed = .8;
  }
  function setDrag(style){
    if (!controls) return; st.drag = style === "orbit" ? "orbit" : "map";
    const M = T.MOUSE, H = T.TOUCH;
    controls.mouseButtons = st.drag === "map" ? {LEFT: M.PAN, MIDDLE: M.DOLLY, RIGHT: M.ROTATE} : {LEFT: M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN};
    controls.touches = st.drag === "map" ? {ONE: H.PAN, TWO: H.DOLLY_ROTATE} : {ONE: H.ROTATE, TWO: H.DOLLY_PAN};
  }

  const world = new T.Group(); scene.add(world);
  const made = [];   // materials / geometries / textures this view created (shared model data stays cached)
  const own = x => { made.push(x); return x; };
  const st = {c: null, ring: null, bounds: null, objs: [], stops: [], failed: [], spin: [], signs: [], obstacles: [], mode: "orbit", tour: null, fly: null, drag: "map",
    walk: {yaw: 0, pitch: 0, move: [0, 0], keys: new Set(), run: false, speed: +opt.speed || 4.5}, alive: true, size: [1, 1], onTourEnd: null, onStop: null, onSpeed: null, ghost: null, span: 30, me: null, c0: null, seqId: 0, sel: new Map(), guides: null, edit: false};
  setDrag(opt.drag || "map");

  // ---- ground and lots (drawn first and never hide anything standing on them, so thin pavers show at any distance) ----
  let groundOrder = -50;
  function slab(R, color, opts = {}){
    const sh = new T.Shape(R.map(([x, z]) => new T.Vector2(x, -z)));
    const g = own(new T.ShapeGeometry(sh)); g.rotateX(-Math.PI / 2);
    const m = new T.Mesh(g, own(new T.MeshStandardMaterial({color, roughness: .95, metalness: 0, depthWrite: false, ...opts})));
    m.renderOrder = groundOrder++; m.receiveShadow = true; world.add(m); return m;
  }
  function strip(R, color, w, closed = true, y = 0){
    const verts = [], idx = [], n = closed ? R.length : R.length - 1;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = R[i], [x2, z2] = R[(i + 1) % R.length], dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2, b = verts.length / 3;
      verts.push(x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz, x2 + nx, y, z2 + nz, x2 - nx, y, z2 - nz); idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const g = own(new T.BufferGeometry()); g.setAttribute("position", new T.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, own(new T.MeshBasicMaterial({color, side: T.DoubleSide, toneMapped: false, fog: true, depthWrite: false})));
    m.renderOrder = groundOrder++; world.add(m); return m;
  }

  // ---- one placed model ----
  const fixMat = mt => {   // cut-out leaves and fences stay solid from far away (no thinning in the smaller texture levels)
    if (!mt) return mt;
    if (mt.map) mt.map.anisotropy = Math.max(mt.map.anisotropy || 1, maxAniso);
    if (mt.alphaTest > 0 || (mt.transparent && mt.map)) { mt.alphaToCoverage = true; if (mt.alphaTest > 0) mt.alphaTest = Math.min(mt.alphaTest, .3); }
    return mt;
  };
  // footprint (half sizes across and along, before turning), height and Upland's collision layer
  function footOf(m, inner){
    const size = (m.size || []).map(Number), b = new T.Box3().setFromObject(inner), d = b.getSize(new T.Vector3());
    let hx = d.x / 2, hz = d.z / 2, h = d.y;
    if (size.length >= 2 && size[0] > 0 && size[1] > 0) { hx = size[0] / 2; hz = size[1] / 2; }
    if (size[2] > 0) h = size[2];
    const kind = kindOf(m);
    if (kind === "plant") { const f = h > 1.6 ? 1.4 : .7; hx = hz = Math.min(Math.max(hx, hz), f / 2) || f / 2; }
    return {hx: Math.max(.05, hx), hz: Math.max(.05, hz), h, layer: kind === "plant" ? "plant" : h <= .155 ? "flat" : "default"};
  }
  // one model: an outer holder at its spot (x, z) turned by yaw, and an inner part that sits the model centred on the ground
  async function place(m, q, c, pos){
    const L = lodOf(m, q); if (!L || !L.url) throw new Error("no model file");
    const gl = await loadModel(L.url);
    const obj = gl.scene.clone(true);
    let tex = null; if (L.tex) { try { tex = await loadTex(L.tex); } catch {} }
    const tint = m.meshes && typeof m.meshes === "object" ? m.meshes : null;
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const one = mt => {
        const n = (mt.name || "") + " " + (o.name || "");
        const key = tint && (/primary/i.test(n) ? "primary" : /secondary/i.test(n) ? "secondary" : /detail/i.test(n) ? "detail" : null);
        if (!tex && !key) return fixMat(mt);
        const c2 = own(mt.clone());
        if (tex) { c2.map = tex; if (c2.color) c2.color.set(0xffffff); }
        if (key && tint[key] && c2.color) c2.color.set(tint[key]);
        c2.needsUpdate = true; return fixMat(c2);
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });
    // Upland stores turns for a Z-up map (rotate[0] = π/2 stands a Y-up model upright); the yaw rotate[1] goes on the holder
    const holder = new T.Group(), inner = new T.Group(), r = m.rotate || [Math.PI / 2, 0, 0];
    inner.quaternion.setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)).multiply(new T.Quaternion().setFromEuler(new T.Euler(+r[0] || 0, 0, +r[2] || 0, "XYZ")));
    inner.add(obj); holder.add(inner);
    let s = +m.scale > 0 ? +m.scale : 1;
    const raw = new T.Box3().setFromObject(obj), dims = raw.getSize(new T.Vector3()), size = (m.size || []).map(Number);
    if (size.length === 3 && size.every(v => v > 0)) { const ratio = Math.max(...size) / Math.max(dims.x, dims.y, dims.z, 1e-6); if (ratio > 3 || ratio < 1 / 3) s *= ratio; }
    if (m._fit) {   // seeds from the Ledger's own files: the grown plant is sized to its usual spread, and every growth stage uses that same scale
      let ref = dims;
      if (m._fitRef && fullUrl(m._fitRef) !== L.url) { try { ref = new T.Box3().setFromObject((await loadModel(fullUrl(m._fitRef))).scene).getSize(new T.Vector3()); } catch {} }
      s = m._fit / (Math.max(ref.x, ref.z) || 1);
    }
    inner.scale.setScalar(s); inner.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(inner);
    inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y + .005, -(box.min.z + box.max.z) / 2);
    inner.updateMatrixWorld(true);
    const [x, z] = pos ? [pos.x, pos.z] : toXZ(+m.lat, +m.lng, c);
    holder.position.set(x, 0, z); holder.rotation.y = pos && pos.yaw != null ? pos.yaw : (+r[1] || 0);
    holder.updateMatrixWorld(true);
    const f = footOf(m, inner);
    holder.userData = {m, kind: kindOf(m), name: nameOf(m), ...f, id: pos && pos.id || (m.propModelID ? "o:" + m.propModelID : "o:" + (++st.seqId)), key: L.url};
    world.add(holder);
    return holder;
  }
  function signSprite(text, bg, edge = "#5ee38f", H = 1.6){
    const cv = document.createElement("canvas"), ctx = cv.getContext("2d"), fs = 64;
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 80, h = fs + 56; cv.width = w; cv.height = h;
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const rr = (x, y, ww, hh, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); };
    rr(4, 4, w - 8, h - 8, 22); ctx.fillStyle = bg || "rgba(9,12,19,.88)"; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = edge; ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(text, w / 2, h / 2 + 3);
    const t = own(new T.CanvasTexture(cv)); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    const sp = new T.Sprite(own(new T.SpriteMaterial({map: t, depthWrite: false, toneMapped: false, fog: false})));
    sp.scale.set(H * w / h, H, 1); sp.renderOrder = 10; return sp;
  }

  // ---- build a lot ----
  // spec: {props: [Upland map entries], prop: lot id, lat, lng}, o: {quality, neighbours (their buildings too), onProgress}
  async function load(spec, o = {}){
    const q = o.quality || "hi", props = spec.props || [];
    let me = props.find(p => String(p.prop_id) === String(spec.prop));
    if (!me && spec.lat != null) me = props.find(p => { const R = ringOf(p.boundaries, {lat: +p.centerlat, lng: +p.centerlng}); return R && inRing(...toXZ(+spec.lat, +spec.lng, {lat: +p.centerlat, lng: +p.centerlng}), R); });
    if (!me) throw new Error("lot not found on Upland's map");
    st.me = me; st.props = props;
    const c = {lat: +me.centerlat, lng: +me.centerlng}; st.c = c;
    const R = ringOf(me.boundaries, c) || [[-10, -10], [10, -10], [10, 10], [-10, 10]]; st.ring = R;
    const xs = R.map(p => p[0]), zs = R.map(p => p[1]);
    st.bounds = {x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs)};
    const span = st.span = Math.max(st.bounds.x1 - st.bounds.x0, st.bounds.z1 - st.bounds.z0, 20);

    // ground, the neighbours' lots (outlines only), this lot
    const ground = new T.Mesh(own(new T.CircleGeometry(2400, 64)), own(new T.MeshStandardMaterial({color: "#3b4047", roughness: 1, depthWrite: false})));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.renderOrder = -60; world.add(ground);
    const others = props.filter(p => p !== me).map(p => ({p, R: ringOf(p.boundaries, c)})).filter(x => x.R)
      .map(x => ({...x, d: Math.min(...x.R.map(([a, b]) => Math.hypot(a, b)))})).filter(x => x.d < span * 2.5 + 60).sort((a, b) => a.d - b.d);
    for (const x of others) slab(x.R, "#7d8187");
    for (const x of others) strip(x.R, "#5d636b", .18);
    slab(R, "#6f9f52", {roughness: .9});
    strip(R, "#5ee38f", .35);

    // sun and shadows sized to the lot
    const rad = span * .75 + 25;
    sun.position.set(-rad * .8, rad * 1.4, rad * .6); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, {left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: rad * 4}); sun.shadow.camera.updateProjectionMatrix();

    // models: this lot only, unless asked for the neighbours' buildings too (lighter files)
    const mine = (me.models || []).map(m => ({m, q, mine: true}));
    const nb = !o.neighbours ? [] : others.flatMap(x => (x.p.models || []).filter(m => m.modelType === "building").map(m => ({m, q: "lo", mine: false, d: x.d}))).slice(0, o.maxNeighbours || 60);
    const jobs = [...mine, ...nb], total = jobs.length; let done = 0;
    const tick = txt => o.onProgress && o.onProgress(total ? done / total : 1, txt, done, total);
    tick(`Loading ${mine.length} model${mine.length === 1 ? "" : "s"} on the lot`);
    const run = async j => {
      try {
        const obj = await place(j.m, j.q, c); obj.userData.mine = j.mine; st.objs.push(obj);
        if (j.mine) for (const ex of j.m.extensions || []) await addExtension(ex, obj, c).catch(() => {});
      } catch (e) { if (j.mine) st.failed.push({name: nameOf(j.m), url: (lodOf(j.m, j.q) || {}).url, err: String(e && e.message || e)}); }
      done++; tick(done <= mine.length ? `Lot: ${Math.min(done, mine.length)} of ${mine.length}` : `Neighbours: ${done - mine.length} of ${nb.length}`);
    };
    const queue = jobs.slice(), worker = async () => { while (queue.length && st.alive) await run(queue.shift()); };
    let painting = !still; (async () => { while (painting && st.alive) { await new Promise(r => setTimeout(r, 400)); if (painting) draw(); } })();
    await Promise.all(Array.from({length: 8}, worker)); painting = false;
    buildStops(); obstacles();
    hero(true);
    draw();
    return {stops: st.stops, failed: st.failed, models: mine.length, loaded: st.objs.filter(x => x.userData.mine).length, me};
  }
  async function addExtension(ex, host, c){
    const box = new T.Box3().setFromObject(host), top = box.max.y, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    if (ex.type === "billboard" && ex.content && ex.content.text) {
      const sp = signSprite(ex.content.text, ex.content.backgroundColor && ex.content.backgroundColor !== "#000000" ? ex.content.backgroundColor : null);
      sp.position.set(cx, top + 1.6, cz); sp.visible = opt.labels !== false; world.add(sp); st.signs.push(sp); host.userData.sign = ex.content.text; return;
    }
    if (ex.type === "airpin" && ex.lods) {
      const L = ex.lods[lodKeys(ex)[0]] || {}; if (!L.modelUrl) return;
      const gl = await loadModel(fullUrl(L.modelUrl)), obj = gl.scene.clone(true), g = new T.Group();
      g.add(obj); g.updateMatrixWorld(true);
      const b = new T.Box3().setFromObject(g), h = b.max.y - b.min.y || 1, sc = Math.min(1, 3 / h);
      g.scale.setScalar(sc); g.updateMatrixWorld(true); const b2 = new T.Box3().setFromObject(g);
      g.position.set(cx - (b2.min.x + b2.max.x) / 2, top + 3.4 - b2.min.y, cz - (b2.min.z + b2.max.z) / 2);
      g.visible = opt.labels !== false; world.add(g); st.spin.push(g); st.signs.push(g);
    }
  }

  // ---- tour stops: buildings and the totem one by one, everything else grouped ----
  function buildStops(){
    const mine = st.objs.filter(o => o.userData.mine), groups = new Map(), stops = [];
    for (const o of mine) {
      const u = o.userData, solo = u.kind === "nursery" || u.kind === "building" || u.kind === "totem";
      const key = solo ? "solo:" + o.id : u.kind + ":" + (u.kind === "car" ? "Vehicles" : u.name);
      const g = groups.get(key) || groups.set(key, {name: u.kind === "car" ? "Vehicles" : u.name, kind: u.kind, objs: [], sign: null}).get(key);
      g.objs.push(o); if (u.sign) g.sign = u.sign;
    }
    const order = {nursery: 0, building: 1, totem: 2, plant: 3, car: 5};
    for (const g of groups.values()) {
      const box = new T.Box3(); g.objs.forEach(o => box.expandByObject(o));
      stops.push({name: g.name, kind: g.kind, count: g.objs.length, sign: g.sign, box, m: g.objs[0].userData.m});
    }
    stops.sort((a, b) => (order[a.kind] ?? 4) - (order[b.kind] ?? 4) || b.count - a.count);
    const lotBox = new T.Box3(new T.Vector3(st.bounds.x0, 0, st.bounds.z0), new T.Vector3(st.bounds.x1, 2, st.bounds.z1));
    mine.forEach(o => lotBox.expandByObject(o));
    st.lotBox = lotBox;
    st.stops = [{name: "Overview", kind: "overview", count: mine.length, box: lotBox}, ...stops];
    if (st.ghost) st.stops.push(st.ghost.stop);
  }
  function obstacles(){
    st.obstacles = st.objs.filter(o => /^(nursery|building|totem|car|crate)$/.test(o.userData.kind)).map(o => new T.Box3().setFromObject(o)).filter(b => b.max.y - b.min.y > .6);
  }

  // ---- the planned nursery spot from the aligner: a see-through green building with its door edge lit ----
  function setGhost(g){
    if (st.ghost) { world.remove(st.ghost.group); st.stops = st.stops.filter(s => s !== st.ghost.stop); st.ghost = null; }
    if (!g || !g.target) return;
    const grp = new T.Group(), F = g.target, h = g.h || 5.5;
    const sh = new T.Shape(F.map(([x, z]) => new T.Vector2(x, -z)));
    const geo = own(new T.ExtrudeGeometry(sh, {depth: h, bevelEnabled: false})); geo.rotateX(-Math.PI / 2);
    const box = new T.Mesh(geo, own(new T.MeshBasicMaterial({color: 0x5ee38f, transparent: true, opacity: .22, depthWrite: false, toneMapped: false})));
    box.renderOrder = 5; grp.add(box);
    const edges = new T.LineSegments(own(new T.EdgesGeometry(geo)), own(new T.LineBasicMaterial({color: 0x5ee38f, toneMapped: false})));
    edges.renderOrder = 6; grp.add(edges);
    const foot = strip(F, "#5ee38f", .3, true, .02); world.remove(foot); grp.add(foot);
    const door = strip([F[0], F[1]], "#ffffff", .7, false, .03); world.remove(door); grp.add(door);
    if (g.now) { const cur = strip(g.now, "#f6b552", .25, true, .025); world.remove(cur); grp.add(cur); }
    const mid = [(F[0][0] + F[1][0]) / 2, (F[0][1] + F[1][1]) / 2], cen = F.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const lab = signSprite(g.label || "New spot · door", "rgba(9,12,19,.85)", "#ffffff", 1.2);
    const dx = mid[0] - cen[0], dz = mid[1] - cen[1], L = Math.hypot(dx, dz) || 1;
    lab.position.set(mid[0] + dx / L * 2.2, 2.4, mid[1] + dz / L * 2.2); grp.add(lab);
    world.add(grp);
    const b3 = new T.Box3().setFromObject(box);
    st.ghost = {group: grp, stop: {name: "New spot", kind: "ghost", count: 1, box: b3}};
    if (st.stops.length) st.stops.push(st.ghost.stop);
    draw();
    return st.stops.length - 1;
  }

  // ---- cameras ----
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function frame(box, az, el, pad = 1.15){
    const sph = box.getBoundingSphere(new T.Sphere()), r = Math.max(sph.radius, 2.5);
    const fov = camera.fov * Math.PI / 180, fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * Math.max(.6, camera.aspect)));
    const d = r / Math.sin(fit / 2) * pad;
    const tgt = new T.Vector3(sph.center.x, Math.max(.8, sph.center.y * .7), sph.center.z);
    return {tgt, pos: new T.Vector3(tgt.x + d * Math.cos(el) * Math.sin(az), tgt.y + d * Math.sin(el), tgt.z + d * Math.cos(el) * Math.cos(az))};
  }
  function hero(now){
    const v = frame(st.lotBox || new T.Box3(new T.Vector3(-10, 0, -10), new T.Vector3(10, 4, 10)), Math.PI * .2, .62, 1.05);
    if (now) { camera.position.copy(v.pos); if (controls) { controls.target.copy(v.tgt); controls.update(); } else camera.lookAt(v.tgt); }
    return v;
  }
  function flyTo(v, ms = 1500){
    return new Promise(res => {
      if (!controls) { camera.position.copy(v.pos); camera.lookAt(v.tgt); return res(); }
      if (st.fly) st.fly.res();
      st.fly = {p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos, t1: v.tgt, start: performance.now(), ms, res};
    });
  }
  const azNow = () => controls ? Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) : Math.PI * .2;
  function goStop(i, ms){
    const s = st.stops[i]; if (!s) return;
    if (st.mode === "walk") setMode("orbit");
    const k = s.kind;
    const v = k === "overview" ? frame(s.box, azNow(), .62, 1.05) : frame(s.box, azNow(), k === "plant" || k === "decor" ? .55 : k === "ghost" ? .5 : .35, k === "plant" ? 1.25 : 1.6);
    st.onStop && st.onStop(i, s);
    return flyTo(v, ms);
  }
  // small steps for the on-screen buttons
  function nudge({zoom = 0, turn = 0, tilt = 0}){
    if (!controls || st.mode !== "orbit") return;
    stopTour();
    const off = camera.position.clone().sub(controls.target), sph = new T.Spherical().setFromVector3(off);
    if (zoom) sph.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, sph.radius * (zoom > 0 ? .7 : 1.42)));
    if (turn) sph.theta += turn * Math.PI / 8;
    if (tilt) sph.phi = Math.max(.15, Math.min(controls.maxPolarAngle, sph.phi - tilt * .18));
    const p = new T.Vector3().setFromSpherical(sph).add(controls.target);
    flyTo({pos: p, tgt: controls.target.clone()}, 350);
  }
  // double-click / double-tap: glide to that spot
  const ray = new T.Raycaster(), groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  function focusAt(cx, cy){
    if (!controls || st.mode !== "orbit") return;
    const r = canvas.getBoundingClientRect(), ndc = new T.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(st.objs, true); let p = hits.length ? hits[0].point : ray.ray.intersectPlane(groundPlane, new T.Vector3());
    if (!p) return;
    stopTour();
    const off = camera.position.clone().sub(controls.target), d = Math.max(4, Math.min(off.length() * .55, 60));
    flyTo({tgt: p.clone(), pos: p.clone().add(off.setLength(d))}, 700);
  }

  // ---- automatic tour ----
  function tour(on){
    if (!on) { if (st.tour) { st.tour = null; st.onTourEnd && st.onTourEnd(); } return; }
    if (st.mode === "walk") setMode("orbit");
    const id = {}; st.tour = id;
    (async () => {
      let i = 0;
      while (st.tour === id && st.alive) {
        await goStop(i % st.stops.length, 2200); if (st.tour !== id) break;
        const t0 = performance.now(); while (st.tour === id && performance.now() - t0 < (i % st.stops.length === 0 ? 4500 : 5500)) await new Promise(r => setTimeout(r, 100));
        i++;
      }
    })();
  }
  const stopTour = () => { if (st.tour) tour(false); if (st.fly) { const f = st.fly; st.fly = null; f.res(); } };

  // ---- walking ----
  function setMode(mode){
    if (mode === st.mode) return; st.mode = mode;
    if (mode === "walk") {
      stopTour(); if (controls) controls.enabled = false;
      const tg = controls ? controls.target.clone() : new T.Vector3();
      const b = st.bounds, p = camera.position.clone();
      p.x = Math.max(b.x0 - 6, Math.min(b.x1 + 6, p.x)); p.z = Math.max(b.z0 - 6, Math.min(b.z1 + 6, p.z)); p.y = 1.7;
      camera.position.copy(p); collide();
      st.walk.yaw = Math.atan2(-(tg.x - p.x), -(tg.z - p.z)); st.walk.pitch = -.05; look();
    } else {
      if (controls) {
        const dir = new T.Vector3(); camera.getWorldDirection(dir);
        const tgt = camera.position.clone().addScaledVector(dir, 10); tgt.y = Math.max(.8, Math.min(4, tgt.y));
        camera.position.addScaledVector(dir, -6).y += 6; controls.target.copy(tgt); controls.enabled = true; controls.update();
      }
    }
  }
  function look(){ camera.quaternion.setFromEuler(new T.Euler(st.walk.pitch, st.walk.yaw, 0, "YXZ")); }
  function collide(){
    const p = camera.position, r = .35;
    for (const b of st.obstacles) {
      if (p.x < b.min.x - r || p.x > b.max.x + r || p.z < b.min.z - r || p.z > b.max.z + r) continue;
      const dx1 = p.x - (b.min.x - r), dx2 = (b.max.x + r) - p.x, dz1 = p.z - (b.min.z - r), dz2 = (b.max.z + r) - p.z, m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) p.x = b.min.x - r; else if (m === dx2) p.x = b.max.x + r; else if (m === dz1) p.z = b.min.z - r; else p.z = b.max.z + r;
    }
    const B = st.bounds; p.x = Math.max(B.x0 - 40, Math.min(B.x1 + 40, p.x)); p.z = Math.max(B.z0 - 40, Math.min(B.z1 + 40, p.z));
  }
  // Shift = faster, Ctrl or Alt = slower (both walking and moving the map with the keys)
  const pace = k => (st.walk.run || k.has("ShiftLeft") || k.has("ShiftRight") ? 2.5 : 1) * (k.has("ControlLeft") || k.has("ControlRight") || k.has("AltLeft") || k.has("AltRight") ? .35 : 1);
  function axes(k){
    let f = 0, s = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) f += 1; if (k.has("KeyS") || k.has("ArrowDown")) f -= 1;
    if (k.has("KeyD")) s += 1; if (k.has("KeyA")) s -= 1;
    return [f, s];
  }
  function walkStep(dt){
    const w = st.walk, k = w.keys; let [f, s] = axes(k); f += w.move[1]; s += w.move[0];
    if (k.has("ArrowLeft") || k.has("KeyQ")) w.yaw += dt * 1.8; if (k.has("ArrowRight") || k.has("KeyE")) w.yaw -= dt * 1.8;
    const sp = w.speed * pace(k) * dt, L = Math.hypot(f, s);
    if (L > 0) { const n = Math.min(1, L); f = f / L * n; s = s / L * n;
      camera.position.x += (-Math.sin(w.yaw) * f + Math.cos(w.yaw) * s) * sp; camera.position.z += (-Math.cos(w.yaw) * f - Math.sin(w.yaw) * s) * sp; collide(); }
    look();
  }
  // keys in the map view: W A S D / arrows slide the map, Q E turn, R F (or + −) zoom
  function orbitKeys(dt){
    const k = st.walk.keys; if (!controls || !k.size) return;
    const [f, s0] = axes(k); let s = s0; if (k.has("ArrowLeft")) s -= 1; if (k.has("ArrowRight")) s += 1;
    const turn = (k.has("KeyQ") ? 1 : 0) - (k.has("KeyE") ? 1 : 0), zoom = (k.has("KeyR") || k.has("Equal") || k.has("NumpadAdd") ? 1 : 0) - (k.has("KeyF") || k.has("Minus") || k.has("NumpadSubtract") ? 1 : 0);
    if (!f && !s && !turn && !zoom) return;
    stopTour();
    const off = camera.position.clone().sub(controls.target), dist = off.length(), p = pace(k);
    if (f || s) {
      const fw = new T.Vector3(-off.x, 0, -off.z).normalize(), rt = new T.Vector3(-fw.z, 0, fw.x), v = Math.max(4, dist * .9) * p * dt;
      const mv = fw.multiplyScalar(f * v).add(rt.multiplyScalar(s * v)); controls.target.add(mv); camera.position.add(mv);
    }
    if (turn) { off.applyAxisAngle(new T.Vector3(0, 1, 0), turn * dt * 1.4 * p); camera.position.copy(controls.target).add(off); }
    if (zoom) { const nd = Math.max(controls.minDistance, Math.min(controls.maxDistance, dist * Math.pow(zoom > 0 ? .35 : 2.8, dt * p))); camera.position.copy(controls.target).add(off.setLength(nd)); }
  }

  // ---- input (only for the interactive view) ----
  const cleanups = [];
  if (!still) {
    const on = (el, ev, fn, o2) => { el.addEventListener(ev, fn, o2); cleanups.push(() => el.removeEventListener(ev, fn, o2)); };
    let drag = null, lastTap = 0;
    on(canvas, "pointerdown", e => {
      stopTour();
      if (st.mode === "walk") { drag = {x: e.clientX, y: e.clientY, id: e.pointerId}; canvas.setPointerCapture(e.pointerId); }
      if (e.pointerType !== "mouse") { const now = Date.now(); if (now - lastTap < 300) focusAt(e.clientX, e.clientY); lastTap = now; }
    });
    on(canvas, "dblclick", e => focusAt(e.clientX, e.clientY));
    on(canvas, "pointermove", e => { if (!drag || e.pointerId !== drag.id || st.mode !== "walk") return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      st.walk.yaw -= dx * .0045; st.walk.pitch = Math.max(-1.2, Math.min(1.2, st.walk.pitch - dy * .0045)); });
    on(canvas, "pointerup", () => { drag = null; });
    on(canvas, "wheel", e => {
      stopTour();
      if (st.mode === "walk") { e.preventDefault(); setSpeed(st.walk.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }
    }, {passive: false});
    on(canvas, "contextmenu", e => e.preventDefault());
    on(window, "keydown", e => { if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "")) return;
      if (/^(Key[WASDQERF]|Arrow\w+|Shift\w+|Control\w+|Alt\w+|Equal|Minus|NumpadAdd|NumpadSubtract)$/.test(e.code)) { st.walk.keys.add(e.code); if (/^(Arrow|Alt)/.test(e.code) || st.mode === "walk") e.preventDefault(); } });
    on(window, "keyup", e => st.walk.keys.delete(e.code));
    on(window, "blur", () => st.walk.keys.clear());
  }
  function setSpeed(v){ st.walk.speed = Math.max(1, Math.min(30, v)); st.onSpeed && st.onSpeed(st.walk.speed); }

  // ---- render loop ----
  function resize(){
    const w = canvas.clientWidth || canvas.width || 800, h = canvas.clientHeight || canvas.height || 500;
    if (w === st.size[0] && h === st.size[1]) return; st.size = [w, h];
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function fogFollow(){
    const d = controls && st.mode === "orbit" ? camera.position.distanceTo(controls.target) : 0;
    scene.fog.near = d + st.span * 3 + 150; scene.fog.far = scene.fog.near * 3 + 900;
  }
  function draw(){ resize(); fogFollow(); renderer.render(scene, camera); }
  let last = performance.now(), raf = 0;
  function loop(now){
    if (!st.alive) return; raf = requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (st.fly && controls) { const f = st.fly, t = Math.min(1, (now - f.start) / f.ms), e = ease(t);
      camera.position.lerpVectors(f.p0, f.p1, e); controls.target.lerpVectors(f.t0, f.t1, e); if (t >= 1) { st.fly = null; f.res(); } }
    else if (st.tour && controls && st.mode === "orbit") { const off = camera.position.clone().sub(controls.target); off.applyAxisAngle(new T.Vector3(0, 1, 0), dt * .22); camera.position.copy(controls.target).add(off); }
    if (st.mode === "walk") walkStep(dt); else if (controls) { if (!st.fly) orbitKeys(dt); controls.update(); }
    for (const g of st.spin) g.rotation.y += dt * .9;
    draw();
  }
  if (!still) raf = requestAnimationFrame(loop);

  // ---- picture ----
  function snapshot(w, h, type = "image/png", quality = .9, view = "current"){
    const keep = {pos: camera.position.clone(), q: camera.quaternion.clone(), aspect: camera.aspect, size: st.size.slice(), pr: renderer.getPixelRatio()};
    renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (view === "hero") { const v = hero(false); camera.position.copy(v.pos); camera.lookAt(v.tgt); }
    fogFollow(); renderer.render(scene, camera);
    const url = canvas.toDataURL(type, quality);
    renderer.setPixelRatio(keep.pr); camera.position.copy(keep.pos); camera.quaternion.copy(keep.q); camera.aspect = keep.aspect; camera.updateProjectionMatrix();
    st.size = [0, 0]; if (!still) draw(); else { renderer.setSize(keep.size[0], keep.size[1], false); }
    return url;
  }

  // ---- editing (Build mode) ----
  const editable = () => st.objs.filter(o => o.userData.mine !== false && o.parent);
  async function addItem(m, pos){
    const o = await place(m, "hi", st.c, pos); o.userData.mine = true; o.userData.added = true; st.objs.push(o);
    for (const ex of m.extensions || []) await addExtension(ex, o, st.c).catch(() => {});
    obstacles(); return o;
  }
  function moveItem(o, x, z, yaw){ o.position.x = x; o.position.z = z; if (yaw != null) o.rotation.y = yaw; o.updateMatrixWorld(true); }
  function removeItem(o){ world.remove(o); st.objs = st.objs.filter(x => x !== o); st.sel.delete(o); obstacles(); }
  const ndcOf = (cx, cy) => { const r = canvas.getBoundingClientRect(); return new T.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); };
  function pickAt(cx, cy){
    ray.setFromCamera(ndcOf(cx, cy), camera);
    const vis = editable().filter(o => o.visible), hits = ray.intersectObjects(vis, true);
    for (const h of hits) { let o = h.object; while (o && !(o.userData && o.userData.id && o.parent === world)) o = o.parent; if (o && !o.userData.noPick) return o; }
    return null;
  }
  function surfaceAt(cx, cy){   // the spot under the pointer on whatever is there (the ground if nothing)
    ray.setFromCamera(ndcOf(cx, cy), camera);
    const hits = ray.intersectObjects(editable().filter(o => o.visible), true);
    if (hits.length) return [hits[0].point.x, hits[0].point.z];
    const p = ray.ray.intersectPlane(groundPlane, new T.Vector3()); return p ? [p.x, p.z] : null;
  }
  function groundAt(cx, cy){ ray.setFromCamera(ndcOf(cx, cy), camera); const p = ray.ray.intersectPlane(groundPlane, new T.Vector3()); return p ? [p.x, p.z] : null; }
  // outline + tint on the ground under an item: sel (green), bad (red), hover (white), moved (amber)
  const MARK = {sel: 0x5ee38f, bad: 0xff5a5a, hover: 0xffffff, moved: 0xf6b552, multi: 0x62dcff};
  function mark(o, state){
    let g = o.userData.ring;
    if (!state) { if (g) g.visible = false; return; }
    if (!g) {
      const {hx, hz} = o.userData; g = new T.Group();
      const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]].map(([a, b]) => new T.Vector3(a, .045, b));
      const line = new T.Line(own(new T.BufferGeometry().setFromPoints(pts)), own(new T.LineBasicMaterial({color: 0xffffff, toneMapped: false, depthTest: false})));
      const fill = new T.Mesh(own(new T.PlaneGeometry(hx * 2, hz * 2)), own(new T.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: .22, depthWrite: false, depthTest: false, toneMapped: false})));
      fill.rotation.x = -Math.PI / 2; fill.position.y = .04; line.renderOrder = 20; fill.renderOrder = 19;
      g.add(fill, line); o.add(g); o.userData.ring = g; g.userData.noPick = true;
      g.traverse(x => { x.raycast = () => {}; });
    }
    const col = MARK[state] || MARK.sel; g.children.forEach(c => c.material.color.setHex(col)); g.children[0].material.opacity = state === "bad" ? .45 : .22; g.visible = true;
  }
  // flat overlays: original spots of moved items, removed items, snap guides
  let overlay = null;
  function setOverlays(list){
    if (overlay) { world.remove(overlay); overlay = null; }
    if (!list || !list.length) return draw();
    overlay = new T.Group();
    for (const it of list) {
      if (it.seg) { const g = own(new T.BufferGeometry().setFromPoints(it.seg.map(([x, z]) => new T.Vector3(x, .07, z)))); const l = new T.Line(g, own(new T.LineDashedMaterial({color: it.color || 0x62dcff, dashSize: .35, gapSize: .2, toneMapped: false, depthTest: false}))); l.computeLineDistances(); l.renderOrder = 22; overlay.add(l); continue; }
      const c = Math.cos(it.yaw || 0), sn = Math.sin(it.yaw || 0), P = [[-it.hx, -it.hz], [it.hx, -it.hz], [it.hx, it.hz], [-it.hx, it.hz], [-it.hx, -it.hz]].map(([a, b]) => new T.Vector3(it.x + a * c + b * sn, .05, it.z - a * sn + b * c));
      const l = new T.Line(own(new T.BufferGeometry().setFromPoints(P)), own(new T.LineDashedMaterial({color: it.color || 0xf6b552, dashSize: .3, gapSize: .2, toneMapped: false, depthTest: false})));
      l.computeLineDistances(); l.renderOrder = 21; overlay.add(l);
    }
    world.add(overlay); draw();
  }
  // step numbers floating over items (build list)
  let labels = null;
  function setLabels(list){
    if (labels) { world.remove(labels); labels = null; }
    if (!list || !list.length) return draw();
    labels = new T.Group();
    for (const it of list) { const sp = signSprite(String(it.text), it.bg || "rgba(9,12,19,.88)", it.edge || "#5ee38f", it.size || .9); sp.position.set(it.x, (it.y || 1) + .6, it.z); sp.material.depthTest = false; sp.renderOrder = 30; labels.add(sp); }
    world.add(labels); draw();
  }
  // swap an item's model (a plant's growth stage): same spot, same turn, same id; returns the new object
  async function swapModel(o, m){
    const n = await place(m, "hi", st.c, {x: o.position.x, z: o.position.z, yaw: o.rotation.y, id: o.userData.id});
    Object.assign(n.userData, {mine: o.userData.mine, added: o.userData.added});
    n.visible = o.visible; world.remove(o);
    const i = st.objs.indexOf(o); if (i >= 0) st.objs[i] = n; else st.objs.push(n);
    obstacles(); draw(); return n;
  }
  // where the next item will go: a green (fine) or red (can't go there) patch on the ground
  let preview = null;
  function setPreview(p){   // the patch of ground the next item will take: blue = fine, red = it can't go there
    if (!p) { if (preview) preview.visible = false; draw(); return; }
    if (!preview) {
      preview = new T.Group();
      const mat = c => own(new T.MeshBasicMaterial({color: c, transparent: true, opacity: .5, depthWrite: false, depthTest: false, toneMapped: false, side: T.DoubleSide}));
      const fill = new T.Mesh(own(new T.PlaneGeometry(1, 1)), mat(0x62dcff)); fill.rotation.x = -Math.PI / 2; fill.position.y = .05; fill.renderOrder = 23;
      const edge = new T.LineLoop(own(new T.BufferGeometry().setFromPoints([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([a, b]) => new T.Vector3(a, .055, b)))), own(new T.LineBasicMaterial({color: 0xffffff, toneMapped: false, depthTest: false})));
      edge.renderOrder = 24;
      const box = new T.Group(); box.add(fill, edge);
      const ring = new T.Mesh(own(new T.RingGeometry(1, 1.1, 48)), mat(0x62dcff)); ring.rotation.x = -Math.PI / 2; ring.position.y = .06; ring.renderOrder = 24;
      preview.add(box, ring); preview.userData = {box, ring, fill}; world.add(preview);
    }
    const {box, ring, fill} = preview.userData;
    preview.visible = true; preview.position.set(p.x, 0, p.z); preview.rotation.y = p.yaw || 0; box.scale.set(p.hx * 2, 1, p.hz * 2);
    // a ring around it, kept a few pixels thick whatever the zoom, so a small item still shows from far away
    const r = Math.hypot(p.hx, p.hz) + .25, w = Math.max(.05, camera.position.distanceTo(new T.Vector3(p.x, 0, p.z)) * .006);
    ring.geometry.dispose(); ring.geometry = new T.RingGeometry(r, r + w, 48);
    const col = p.ok ? 0x62dcff : 0xff4d4d; fill.material.color.setHex(col); ring.material.color.setHex(col);
    fill.material.opacity = p.ok ? .55 : .7; ring.material.opacity = p.ok ? .8 : .95;
    draw();
  }
  // a true top-down picture (north up) for the build sheet, plus a way to find any spot on it
  function snapshotTop(w, h, pad = 4){
    const xs = [], zs = [];
    for (const [x, z] of st.ring || []) { xs.push(x); zs.push(z); }
    for (const o of editable()) if (o.visible) { const b = new T.Box3().setFromObject(o); xs.push(b.min.x, b.max.x); zs.push(b.min.z, b.max.z); }
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let vw = x1 - x0, vh = z1 - z0; if (vw / vh > w / h) vh = vw * h / w; else vw = vh * w / h;
    const cam = new T.OrthographicCamera(-vw / 2, vw / 2, vh / 2, -vh / 2, .1, 3000);
    cam.position.set(cx, 800, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.updateProjectionMatrix();
    const keep = {pr: renderer.getPixelRatio(), fog: scene.fog, size: st.size.slice()}, hid = [];
    for (const g of [labels, ...st.signs, ...(st.spin || [])]) if (g && g.visible) { g.visible = false; hid.push(g); }
    if (preview) preview.visible = false;
    scene.fog = null; renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    renderer.render(scene, cam);
    const url = canvas.toDataURL("image/png");
    scene.fog = keep.fog; hid.forEach(g => { g.visible = true; }); renderer.setPixelRatio(keep.pr); st.size = [0, 0]; if (!still) draw(); else renderer.setSize(keep.size[0], keep.size[1], false);
    const left = cx - vw / 2, top = cz - vh / 2;
    return {url, w, h, ppm: w / vw, proj: (x, z) => [(x - left) / vw * w, (z - top) / vh * h]};
  }
  function setControls(on){ if (controls) controls.enabled = !!on && st.mode === "orbit"; }
  function planView(on){
    if (!controls) return;
    if (st.mode === "walk") setMode("orbit");
    const t = controls.target.clone(), d = Math.max(12, camera.position.distanceTo(t));
    return flyTo(on ? {tgt: t, pos: new T.Vector3(t.x, t.y + d, t.z + .001)} : {tgt: t, pos: new T.Vector3(t.x + d * .45, t.y + d * .62, t.z + d * .55)}, 700);
  }
  function focus(o){ const b = new T.Box3().setFromObject(o); return flyTo(frame(b, azNow(), .7, 2.4), 700); }

  function dispose(){
    st.alive = false; cancelAnimationFrame(raf); stopTour();
    cleanups.forEach(f => f()); if (controls) controls.dispose();
    for (const x of made) { try { x.dispose(); } catch {} }
    envRT.dispose(); pmrem.dispose(); skyGeo.dispose(); sky.material.dispose();
    renderer.dispose(); try { renderer.forceContextLoss(); } catch {}
  }

  return {
    load, goStop, tour: on => { if (on) tour(true); else stopTour(); }, setMode, snapshot, dispose, draw, nudge, setGhost, setSpeed,
    addItem, moveItem, removeItem, pickAt, groundAt, surfaceAt, swapModel, setPreview, snapshotTop, mark, setOverlays, setLabels, setControls, planView, focus, editable, refresh: () => { obstacles(); draw(); },
    get ring(){ return st.ring; }, get lotBox(){ return st.lotBox; }, get me(){ return st.me; }, get props(){ return st.props; },
    reset: () => { if (st.mode === "walk") setMode("orbit"); stopTour(); return flyTo(hero(false), 900); },
    intro(){   // swoop down from high above to the lot
      const v = hero(false); if (!controls) return Promise.resolve();
      const p = v.pos.clone().sub(v.tgt).multiplyScalar(2.6).add(v.tgt); p.y += 40;
      camera.position.copy(p); controls.target.copy(v.tgt); controls.update(); return flyTo(v, 2600);
    },
    set(key, val){
      if (key === "drag") setDrag(val);
      else if (key === "shadows") { sun.castShadow = !!val; }
      else if (key === "labels") st.signs.forEach(s => { s.visible = !!val; });
      else if (key === "light") { opt.light = !!val; renderer.setPixelRatio(prMax()); st.size = [0, 0]; }
      else if (key === "speed") setSpeed(+val);
      else if (key === "run") st.walk.run = !!val;
    },
    setMove: (x, y, run) => { st.walk.move = [x, y]; if (run != null) st.walk.run = !!run; },
    get mode(){ return st.mode; }, get touring(){ return !!st.tour; }, get stops(){ return st.stops; }, get speed(){ return st.walk.speed; }, get drag(){ return st.drag; },
    get center(){ return st.c; },
    set onTourEnd(f){ st.onTourEnd = f; }, set onStop(f){ st.onStop = f; }, set onSpeed(f){ st.onSpeed = f; },
    renderer, scene, camera
  };
}

// a still picture of a lot, for the Nurseries cards
export async function lotPicture(spec, o = {}){
  const cv = document.createElement("canvas"), w = o.w || 960, h = o.h || 600; cv.width = w; cv.height = h;
  cv.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px`; document.body.appendChild(cv);
  const v = createLotView(cv, {still: true});
  try {
    const r = await v.load(spec, {quality: o.quality || "mid", neighbours: false, onProgress: o.onProgress});
    return {url: v.snapshot(w, h, "image/jpeg", .84, "hero"), loaded: r.loaded, models: r.models, failed: r.failed.length, kinds: r.stops.map(s => s.kind)};
  } finally { v.dispose(); cv.remove(); }
}

// a small picture of one model, for the Build library (one shared offscreen renderer)
let THUMB = null;
export async function modelThumb(m, px = 128){
  if (!THUMB) {
    const cv = document.createElement("canvas"); cv.width = cv.height = px;
    const r = new T.WebGLRenderer({canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true});
    r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.setPixelRatio(1); r.setSize(px, px, false); shared(r);
    const sc = new T.Scene(), pm = new T.PMREMGenerator(r); sc.environment = pm.fromScene(new T.RoomEnvironment(), .04).texture;
    sc.add(new T.HemisphereLight(0xffffff, 0x445566, 1.2)); const dl = new T.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 2); sc.add(dl);
    THUMB = {cv, r, sc, cam: new T.PerspectiveCamera(30, 1, .01, 5000)};
  }
  const {cv, r, sc, cam} = THUMB, L = lodOf(m, "lo"); if (!L || !L.url) throw new Error("no model");
  const gl = await loadModel(L.url), obj = gl.scene.clone(true);
  if (L.tex) { try { const t = await loadTex(L.tex); obj.traverse(o => { if (o.isMesh) { const one = mt => { const c = mt.clone(); c.map = t; if (c.color) c.color.set(0xffffff); return c; }; o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material); } }); } catch {} }
  const g = new T.Group(), rr = m.rotate || [Math.PI / 2, 0, 0];
  g.quaternion.setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)).multiply(new T.Quaternion().setFromEuler(new T.Euler(+rr[0] || 0, 0, +rr[2] || 0, "XYZ")));
  g.add(obj); sc.add(g); g.updateMatrixWorld(true);
  const sph = new T.Box3().setFromObject(g).getBoundingSphere(new T.Sphere()), d = Math.max(.01, sph.radius) / Math.sin(15 * Math.PI / 180) * 1.02;
  cam.position.set(sph.center.x + d * .55, sph.center.y + d * .5, sph.center.z + d * .67); cam.lookAt(sph.center); cam.near = d / 100; cam.far = d * 10; cam.updateProjectionMatrix();
  r.setClearColor(0x000000, 0); r.render(sc, cam);
  const url = cv.toDataURL("image/webp", .85); sc.remove(g); return url;
}
