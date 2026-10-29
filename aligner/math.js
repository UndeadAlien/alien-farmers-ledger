// ---- geometry (pure; tested in node) ----
const G = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  len: (a) => Math.hypot(a[0], a[1]),
  // complex helpers for a 2-point similarity transform
  cmul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  cdiv: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
  // map points from screenshot k into the base screenshot using two shared lot corners
  simT(Ak, Bk, A0, B0) {
    const r = G.cdiv(G.sub(B0, A0), G.sub(Bk, Ak));
    return (z) => G.add(A0, G.cmul(G.sub(z, Ak), r));
  },
  centroid(pts) { let x = 0, y = 0; pts.forEach(p => { x += p[0]; y += p[1]; }); return [x / pts.length, y / pts.length]; },
  inPoly(q, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > q[1]) !== (yj > q[1]) && q[0] < (xj - xi) * (q[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  },
  segDist(q, a, b) {
    const ab = G.sub(b, a), aq = G.sub(q, a);
    const t = Math.max(0, Math.min(1, (aq[0] * ab[0] + aq[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1] || 1)));
    return G.len(G.sub(q, G.add(a, G.mul(ab, t))));
  },
  edgeDist(q, poly) {
    let m = Infinity;
    for (let i = 0; i < poly.length; i++) m = Math.min(m, G.segDist(q, poly[i], poly[(i + 1) % poly.length]));
    return m;
  },
  samples(F, per = 8) {
    const out = [];
    for (let i = 0; i < F.length; i++) {
      const a = F[i], b = F[(i + 1) % F.length];
      for (let k = 0; k < per; k++) out.push(G.add(a, G.mul(G.sub(b, a), k / per)));
    }
    return out;
  },
  // smallest gap between footprint and lot edge; negative = overhangs
  clearance(F, lot) {
    let m = Infinity;
    for (const q of G.samples(F)) {
      const d = G.edgeDist(q, lot);
      m = Math.min(m, G.inPoly(q, lot) ? d : -d);
    }
    for (const v of lot) if (G.inPoly(v, F)) m = Math.min(m, -G.edgeDist(v, F));
    return m;
  },
  shift: (F, d) => F.map(p => G.add(p, d)),
  // offset d that puts the footprint as far from every lot edge as possible
  bestOffset(F, lot) {
    const xs = lot.map(p => p[0]), ys = lot.map(p => p[1]);
    const c = G.centroid(F);
    const x0 = Math.min(...xs) - c[0], x1 = Math.max(...xs) - c[0];
    const y0 = Math.min(...ys) - c[1], y1 = Math.max(...ys) - c[1];
    let best = [0, 0], bv = G.clearance(F, lot);
    const N = 48;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const d = [x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N];
      const v = G.clearance(G.shift(F, d), lot);
      if (v > bv) { bv = v; best = d; }
    }
    let step = Math.max(x1 - x0, y1 - y0) / N;
    while (step > 0.02) {
      let moved = false;
      for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const d = [best[0] + s[0] * step, best[1] + s[1] * step];
        const v = G.clearance(G.shift(F, d), lot);
        if (v > bv + 1e-9) { bv = v; best = d; moved = true; }
      }
      if (!moved) step /= 2;
    }
    return { d: best, clearance: bv };
  },
  angDeg: (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI,
  // full solve from the user's clicks
  solve(s) {
    const { lot, nur, s1, s2, n } = s;
    const A0 = lot[0], B0 = lot[1];
    const T1 = G.simT(s1[0], s1[1], A0, B0), T2 = G.simT(s2[0], s2[1], A0, B0);
    const P0 = nur[0], P1 = T1(s1[2]), P2 = T2(s2[2]);
    const L = G.mul(G.sub(P1, P0), 1 / n);   // one tap of the left arrow
    const U = G.mul(G.sub(P2, P1), 1 / n);   // one tap of the up arrow
    const det = L[0] * U[1] - L[1] * U[0];
    const tapLen = (G.len(L) + G.len(U)) / 2;
    if (tapLen < 1e-6 || Math.abs(det) < 0.05 * G.len(L) * G.len(U)) return { error: "parallel" };
    const F = G.shift(nur, G.sub(P2, P0));    // where the nursery is now
    const before = G.clearance(F, lot);
    const opt = G.bestOffset(F, lot);
    const d = opt.d;
    const a = (d[0] * U[1] - d[1] * U[0]) / det;   // taps of the left arrow
    const b = (L[0] * d[1] - L[1] * d[0]) / det;   // taps of the up arrow
    const ar = Math.round(a), br = Math.round(b);
    const landed = G.add(G.mul(L, ar), G.mul(U, br));
    const after = G.clearance(G.shift(F, landed), lot);
    let off = G.angDeg(nur[0], nur[1]) - G.angDeg(lot[0], lot[1]);
    off = ((off % 90) + 135) % 90 - 45;
    return { L, U, F, target: G.shift(F, landed), a, b, ar, br, before, after, best: opt.clearance, tapLen, off };
  }
};
if (typeof module !== "undefined") module.exports = G;
