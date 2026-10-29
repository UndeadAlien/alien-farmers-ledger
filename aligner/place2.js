// ---- manual placement: subset corner matching, door-aware rectangle, exact centring, paver grid ----
Object.assign(PL, {
  GRID: 1.2,
  // clicks: k>=3 screen points in order around the lot (any subset of its corners)
  matchSubset(clicks, poly) {
    const n = poly.length, k = Math.min(clicks.length, 9), pts = clicks.slice(0, k);
    if (k < 2 || k > n) return null;
    let best = null;
    const combo = (start, need, from, acc, cb) => {
      if (need === 0) { cb(acc); return; }
      for (let i = from; i <= n - need; i++) { acc.push(i); combo(start, need - 1, i + 1, acc, cb); acc.pop(); }
    };
    for (const dir of [1, -1]) for (let s = 0; s < n; s++) {
      combo(s, k - 1, 1, [0], (offs) => {
        const pairs = pts.map((p, i) => [p, poly[((s + dir * offs[i]) % n + n) % n]]);
        const f = PL.fitSim(pairs);
        if (!best || f.rms < best.rms) best = Object.assign(f, { map: offs.map(o => ((s + dir * o) % n + n) % n) });
      });
    }
    // refit using every clicked point as a check of scale sanity
    return best;
  },
  rayHit(p, d, poly) {
    let t = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const e = G.sub(b, a), den = d[0] * e[1] - d[1] * e[0];
      if (Math.abs(den) < 1e-12) continue;
      const ap = G.sub(a, p);
      const u = (ap[0] * e[1] - ap[1] * e[0]) / den, v = (ap[0] * d[1] - ap[1] * d[0]) / den;
      if (u > 1e-9 && v >= 0 && v <= 1) t = Math.min(t, u);
    }
    return t;
  },
  // open space from the footprint's side facing `dir` to the lot boundary, measured along `dir`
  dirGap(F, poly, dir, obstacles) {
    const c = G.centroid(F), pr = F.map(p => (p[0] - c[0]) * dir[0] + (p[1] - c[1]) * dir[1]);
    const mx = Math.max(...pr), side = F.filter((p, i) => pr[i] > mx - 1e-6);
    let from = side;
    if (side.length === 1) { const i = F.indexOf(side[0]); from = [F[(i + F.length - 1) % F.length], side[0], F[(i + 1) % F.length]]; }
    const samples = [];
    for (let i = 0; i < from.length - 1; i++) {
      const a = from[i], b = from[(i + 1) % from.length];
      for (let k = 0; k <= 10; k++) samples.push(G.add(a, G.mul(G.sub(b, a), k / 10)));
    }
    let g = Infinity;
    for (const p of samples) {
      if (!G.inPoly(p, poly)) return -G.edgeDist(p, poly);
      g = Math.min(g, PL.rayHit(p, dir, poly));
      for (const ob of obstacles || []) g = Math.min(g, PL.rayHit(p, dir, ob));
    }
    return g;
  },
  rect(c, ang, w, h) {   // ang = direction the door faces; w = door side length, h = depth
    const n = [Math.cos(ang), Math.sin(ang)], t = [-Math.sin(ang), Math.cos(ang)];
    const f = G.add(c, G.mul(n, h / 2)), b = G.sub(c, G.mul(n, h / 2));
    return [G.sub(f, G.mul(t, w / 2)), G.add(f, G.mul(t, w / 2)), G.add(b, G.mul(t, w / 2)), G.sub(b, G.mul(t, w / 2))];
  },
  doorInfo(F) {   // F: clicked corners, first two on the door side
    const c = G.centroid(F), m = G.mul(G.add(F[0], F[1]), 0.5), d = G.sub(m, c);
    return { c, ang: Math.atan2(d[1], d[0]), w: G.len(G.sub(F[1], F[0])), h: (G.len(G.sub(F[2], F[1])) + G.len(G.sub(F[3], F[0]))) / 2 };
  },
  wrap180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; },
  // o: {poly, obstacles, cur:{c,ang,w,h}, rough:[x,y], alignEdge (-1 = keep angle), quarter (int), centreLR, centreFB, grid, step}
  manual(o) {
    const n = o.poly.length;
    let base;
    if (o.alignEdge >= 0) base = PL.edgeAngle(o.poly, o.alignEdge);
    else base = o.cur.ang;
    // nearest quarter turn to the current door direction, plus the user's extra quarter turns
    const k0 = o.alignEdge >= 0 ? Math.round(PL.wrap180((o.cur.ang - base) * 180 / Math.PI) / 90) : 0;
    const ang = base + (k0 + (o.quarter || 0)) * Math.PI / 2;
    const nrm = [Math.cos(ang), Math.sin(ang)], tan = [-Math.sin(ang), Math.cos(ang)];
    let c = o.rough.slice();
    const R = () => PL.rect(c, ang, o.cur.w, o.cur.h);
    const centreOn = (dir) => {   // shift along dir until the gaps on both sides match
      const g = (s) => { const F = PL.rect(G.add(c, G.mul(dir, s)), ang, o.cur.w, o.cur.h); return PL.dirGap(F, o.poly, dir, o.obstacles) - PL.dirGap(F, o.poly, G.mul(dir, -1), o.obstacles); };
      // balance point nearest to where it was dropped: step outwards until the sign flips, then bisect
      const g0 = g(0);
      if (Math.abs(g0) < 1e-4) return;
      const sgn = Math.sign(g0), stp = 0.25;
      let lo = null, hi = null;
      for (let k = 1; k <= 400 && lo === null; k++) {
        for (const s of [k * stp * sgn, -k * stp * sgn]) {
          if (Math.sign(g(s)) !== sgn) { lo = s - Math.sign(s) * stp; hi = s; break; }
        }
      }
      if (lo === null) return;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Math.sign(g(m)) === sgn) lo = m; else hi = m; }
      c = G.add(c, G.mul(dir, (lo + hi) / 2));
    };
    // paver grid: measured from the reference edge line and its start corner
    const refI = o.alignEdge >= 0 ? o.alignEdge : 0, A = o.poly[refI];
    const snapAxis = (dir) => {
      const F = R(), pr = F.map(p => (p[0] - A[0]) * dir[0] + (p[1] - A[1]) * dir[1]);
      const near = Math.min(...pr);
      let snapped = Math.round(near / PL.GRID) * PL.GRID;
      if (Math.abs(snapped) < PL.GRID - 1e-9) snapped = (near >= 0 ? 1 : -1) * PL.GRID;   // never flush against the edge
      c = G.add(c, G.mul(dir, snapped - near));
    };
    // first pull it fully inside the lot and clear of other buildings, as little as possible
    const obGapOf = (F) => o.obstacles.length ? Math.min(...o.obstacles.map(ob => PL.gapToPoly(F, ob))) : Infinity;
    const fitInside = () => {
      const F = R();
      if (Math.min(G.clearance(F, o.poly), obGapOf(F)) >= 0.05) return;
      const d = PL.optimize((dd) => {
        const Fd = G.shift(F, dd), cl = Math.min(G.clearance(Fd, o.poly), obGapOf(Fd));
        return -G.len(dd) - (cl < 0.1 ? 1000 + (0.1 - cl) * 100 : 0);
      }, F, o.poly);
      c = G.add(c, d);
    };
    fitInside();
    for (let it = 0; it < 4; it++) {
      if (o.centreLR) centreOn(tan);
      if (o.centreFB) centreOn(nrm);
      if (o.grid) { if (!o.centreLR) snapAxis(tan); if (!o.centreFB) snapAxis(nrm); }
    }
    if (o.centreLR) centreOn(tan);
    if (o.centreFB) centreOn(nrm);
    const T = R();
    const gaps = {
      front: PL.dirGap(T, o.poly, nrm, o.obstacles), back: PL.dirGap(T, o.poly, G.mul(nrm, -1), o.obstacles),
      left: PL.dirGap(T, o.poly, G.mul(tan, -1), o.obstacles), right: PL.dirGap(T, o.poly, tan, o.obstacles)
    };
    const d = G.sub(c, o.cur.c), east = d[0], north = -d[1], st = o.step || 0.05;
    const turn = PL.wrap180((ang - o.cur.ang) * 180 / Math.PI);
    const obGap = o.obstacles.length ? Math.min(...o.obstacles.map(ob => PL.gapToPoly(T, ob))) : Infinity;
    return { target: T, c, ang, turn, east, north, gaps, inside: G.clearance(T, o.poly), obGap,
      ew: Math.round(Math.abs(east) / st), ewKey: east >= 0 ? "→" : "←", ns: Math.round(Math.abs(north) / st), nsKey: north >= 0 ? "↑" : "↓",
      edgeGaps: o.poly.map((_, i) => PL.edgeGap(T, o.poly, i)) };
  },
  // a starting point: the most open spot for a rectangle at this angle
  openSpot(o, ang) {
    const F0 = PL.rect(o.cur.c, ang, o.cur.w, o.cur.h);
    const obGap = (F) => o.obstacles.length ? Math.min(...o.obstacles.map(ob => PL.gapToPoly(F, ob))) : Infinity;
    const d = PL.optimize((dd) => { const F = G.shift(F0, dd); return Math.min(G.clearance(F, o.poly), obGap(F)); }, F0, o.poly);
    return G.add(o.cur.c, d);
  }
});

// ---- find the nursery ghost: two bright-green door tabs + the glass greenhouse behind them ----
PL.detectNursery = function (data, w, h) {
  const px = (x, y) => { const k = (y * w + x) * 4; return [data[k], data[k + 1], data[k + 2]]; };
  const isGreen = (r, g, b) => g > 150 && g - r > 70 && g - b > 70;
  const isGlass = (r, g, b) => r > 80 && r < 150 && b > 150 && b < 215 && b - r > 40 && g > 100 && g < 170;
  const seen = new Uint8Array(w * h), blobs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (seen[i]) continue;
    const [r, g, b] = px(x, y); if (!isGreen(r, g, b)) continue;
    const pts = [], st = [i]; seen[i] = 1;
    while (st.length) {
      const j = st.pop(), jx = j % w, jy = (j - jx) / w; pts.push([jx, jy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx; if (seen[k]) continue;
        const c = px(nx, ny); if (isGreen(c[0], c[1], c[2])) { seen[k] = 1; st.push(k); }
      }
    }
    if (pts.length >= 20) blobs.push({ pts, n: pts.length, c: G.centroid(pts) });
  }
  blobs.sort((a, b) => b.n - a.n);
  const top = blobs.slice(0, 8);
  let pair = null, best = -1;
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const A = top[i], B = top[j], ratio = Math.max(A.n, B.n) / Math.min(A.n, B.n);
    const sep = G.len(G.sub(A.c, B.c)), s = Math.sqrt(Math.max(A.n, B.n));
    if (ratio > 2.2 || sep < 1.4 * s || sep > 6 * s) continue;
    if (A.n + B.n > best) { best = A.n + B.n; pair = [A, B]; }
  }
  if (!pair) return null;
  const [A, B] = pair, mid = G.mul(G.add(A.c, B.c), 0.5);
  const u = G.mul(G.sub(B.c, A.c), 1 / G.len(G.sub(B.c, A.c)));
  let nv = [-u[1], u[0]];
  // the glass sits behind the door: check which side has it
  const sep = G.len(G.sub(A.c, B.c)), L = sep / 0.75;
  const glassCount = (sg) => {
    let c = 0;
    for (let a = 0.25; a <= 0.95; a += 0.07) for (let t = -0.4; t <= 0.4; t += 0.08) {
      const p = G.add(mid, G.add(G.mul(nv, sg * a * L), G.mul(u, t * L)));
      const x = Math.round(p[0]), y = Math.round(p[1]); if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const q = px(x, y); if (isGlass(q[0], q[1], q[2])) c++;
    }
    return c;
  };
  const cPos = glassCount(1), cNeg = glassCount(-1);
  if (Math.max(cPos, cNeg) < 5) return null;
  if (cNeg > cPos) nv = G.mul(nv, -1);
  const gp = A.pts.concat(B.pts);
  const pu = gp.map(p => (p[0] - mid[0]) * u[0] + (p[1] - mid[1]) * u[1]);
  const pn = gp.map(p => (p[0] - mid[0]) * nv[0] + (p[1] - mid[1]) * nv[1]);
  const u0 = Math.min(...pu), u1 = Math.max(...pu), door = Math.min(...pn);
  const width = u1 - u0;
  // depth: the far edge of the glass in the nursery's band, else the usual 16.5 : 15.6 shape
  let far = -Infinity;
  for (let a = 0; a <= 1.6 * width; a += 1) for (let t = 0.15; t <= 0.85; t += 0.1) {
    const p = G.add(mid, G.add(G.mul(nv, door + a), G.mul(u, u0 + t * width)));
    const x = Math.round(p[0]), y = Math.round(p[1]); if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const q = px(x, y); if (isGlass(q[0], q[1], q[2])) far = Math.max(far, a);
  }
  let depth = width * 16.5 / 15.6;
  if (far > 0.85 * width && far < 1.3 * width) depth = far + width * 0.03;
  const P = (uu, nn) => G.add(mid, G.add(G.mul(u, uu), G.mul(nv, nn)));
  return [P(u0, door), P(u1, door), P(u1, door + depth), P(u0, door + depth)];
};
