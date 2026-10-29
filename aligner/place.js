// ---- placement math (pure; tested in node) ----
const PL = {
  M: 111195.0802335329,
  // accept a raw /api/map response, or text with headers around it
  parseMap(text) {
    const t = String(text || "").trim();
    const i = t.indexOf("[");
    if (i < 0) throw new Error("no-json");
    let data;
    try { data = JSON.parse(t.slice(i)); }
    catch (e) {
      const j = t.lastIndexOf("]");
      data = JSON.parse(t.slice(i, j + 1));
    }
    if (!Array.isArray(data)) data = data.data || [];
    const lots = [];
    for (const p of data) {
      if (!p || !p.boundaries) continue;
      let b = p.boundaries;
      if (typeof b === "string") b = JSON.parse(b);
      let ring = b.type === "MultiPolygon" ? b.coordinates[0][0] : b.coordinates[0];
      ring = ring.slice();
      const f = ring[0], l = ring[ring.length - 1];
      if (f[0] === l[0] && f[1] === l[1]) ring.pop();
      lots.push({ id: String(p.prop_id), status: p.status || "", ring, models: p.models || [],
        cLat: +p.centerlat || ring.reduce((a, q) => a + q[1], 0) / ring.length,
        cLng: +p.centerlng || ring.reduce((a, q) => a + q[0], 0) / ring.length });
    }
    if (!lots.length) throw new Error("no-lots");
    return lots;
  },
  frame(lot) {
    const M = PL.M, cl = lot.cLat, cg = lot.cLng, K = M * Math.cos(cl * Math.PI / 180);
    return { toM: ([g, a]) => [(g - cg) * K, (cl - a) * M], fromM: ([x, y]) => [cg + x / K, cl - y / M] };
  },
  // a model's footprint in lot metres (x east, y south); verified against UpLytics obstacles
  modelFoot(m, fr) {
    const c = fr.toM([m.lng, m.lat]), a = (m.rotate && m.rotate[1]) || 0;
    const sx = (m.size && m.size[0]) || 1, sz = (m.size && m.size[1]) || 1;
    return [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [sx / 2, sz / 2], [-sx / 2, sz / 2]]
      .map(([lx, lz]) => [c[0] + Math.cos(a) * lx + Math.sin(a) * lz, c[1] - Math.sin(a) * lx + Math.cos(a) * lz]);
  },
  area(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; },
  // least-squares similarity: screen = c * world + t (complex), from [screen, world] pairs
  fitSim(pairs) {
    const S = pairs.map(p => p[0]), W = pairs.map(p => p[1]);
    const mw = G.centroid(W), ms = G.centroid(S);
    let num = [0, 0], den = 0;
    for (let i = 0; i < pairs.length; i++) {
      const w = G.sub(W[i], mw), s = G.sub(S[i], ms);
      num = G.add(num, G.cmul(s, [w[0], -w[1]])); den += w[0] * w[0] + w[1] * w[1];
    }
    const c = [num[0] / den, num[1] / den];
    const toS = (w) => G.add(ms, G.cmul(G.sub(w, mw), c));
    const toW = (s) => G.add(mw, G.cdiv(G.sub(s, ms), c));
    let e = 0; for (let i = 0; i < pairs.length; i++) e += G.len(G.sub(toS(W[i]), S[i])) ** 2;
    return { c, toS, toW, rms: Math.sqrt(e / pairs.length), scale: G.len(c) };
  },
  // corners clicked in order around the lot (null = hidden), any start, either direction
  matchCorners(clicks, poly) {
    const n = poly.length;
    if (clicks.length !== n) return null;
    let best = null;
    for (const dir of [1, -1]) for (let k = 0; k < n; k++) {
      const pairs = [];
      clicks.forEach((s, i) => { if (s) pairs.push([s, poly[((k + dir * i) % n + n) % n]]); });
      if (pairs.length < 2) return null;
      const f = PL.fitSim(pairs);
      if (!best || f.rms < best.rms) best = f;
    }
    return best;
  },
  gapToPoly(F, ob) {
    let d = Infinity;
    for (const q of G.samples(F)) d = Math.min(d, G.inPoly(q, ob) ? -G.edgeDist(q, ob) : G.edgeDist(q, ob));
    for (const v of ob) if (G.inPoly(v, F)) d = Math.min(d, -G.edgeDist(v, F));
    return d;
  },
  edgeGap(F, poly, i) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    let d = Infinity; for (const q of F) d = Math.min(d, G.segDist(q, a, b));
    return d;
  },
  rotateAbout(F, ang) {
    const c = G.centroid(F), co = Math.cos(ang), si = Math.sin(ang);
    return F.map(p => { const v = G.sub(p, c); return [c[0] + v[0] * co - v[1] * si, c[1] + v[0] * si + v[1] * co]; });
  },
  optimize(score, F, poly, basis) {
    const B = basis || [[1, 0], [0, 1]];
    const toD = (a, b) => [a * B[0][0] + b * B[1][0], a * B[0][1] + b * B[1][1]];
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), c = G.centroid(F);
    const x0 = Math.min(...xs) - c[0], x1 = Math.max(...xs) - c[0], y0 = Math.min(...ys) - c[1], y1 = Math.max(...ys) - c[1];
    let best = [0, 0], bv = score([0, 0]);
    const N = 50;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const d = [x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N], v = score(d);
      if (v > bv) { bv = v; best = d; }
    }
    // refine in the basis directions (e.g. along / across an edge)
    let step = Math.max(x1 - x0, y1 - y0) / N;
    while (step > 0.005) {
      let moved = false;
      for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const dd = toD(s[0] * step, s[1] * step), d = [best[0] + dd[0], best[1] + dd[1]], v = score(d);
        if (v > bv + 1e-9) { bv = v; best = d; moved = true; }
      }
      if (!moved) step /= 2;
    }
    return best;
  },
  normDeg(a) { return ((a % 90) + 135) % 90 - 45; },
  edgeAngle(poly, i) { const a = poly[i], b = poly[(i + 1) % poly.length]; return Math.atan2(b[1] - a[1], b[0] - a[0]); },
  // opts: {poly, obstacles, foot, mode:'auto'|'edge'|'spot', edge, gap, align (edge index or -1), spot:[x,y], step}
  plan(o) {
    let F = o.foot, turn = 0;
    if (o.align >= 0) {
      const fa = Math.atan2(F[1][1] - F[0][1], F[1][0] - F[0][0]);
      turn = PL.normDeg((PL.edgeAngle(o.poly, o.align) - fa) * 180 / Math.PI);
      F = PL.rotateAbout(F, turn * Math.PI / 180);
    }
    const n = o.poly.length;
    const obGap = (Fd) => o.obstacles.length ? Math.min(...o.obstacles.map(ob => PL.gapToPoly(Fd, ob))) : Infinity;
    const allGap = (Fd) => Math.min(G.clearance(Fd, o.poly), obGap(Fd));
    let d;
    if (o.mode === "spot") d = G.sub(o.spot, G.centroid(F));
    else if (o.mode === "edge") {
      const e = o.edge, prev = (e - 1 + n) % n, next = (e + 1) % n;
      d = PL.optimize((dd) => {
        const Fd = G.shift(F, dd), inside = G.clearance(Fd, o.poly), og = obGap(Fd);
        let s = -10 * Math.abs(PL.edgeGap(Fd, o.poly, e) - o.gap) - Math.abs(PL.edgeGap(Fd, o.poly, prev) - PL.edgeGap(Fd, o.poly, next));
        if (inside < 0) s -= 1000 - inside * 100;
        if (og < 1) s -= 500 + (1 - og) * 100;
        return s;
      }, F, o.poly, (() => { const a = PL.edgeAngle(o.poly, e); return [[Math.cos(a), Math.sin(a)], [-Math.sin(a), Math.cos(a)]]; })());
    } else d = PL.optimize((dd) => allGap(G.shift(F, dd)), F, o.poly);
    const T = G.shift(F, d);
    const east = d[0], north = -d[1], st = o.step || 0.05;
    const gaps = o.poly.map((_, i) => PL.edgeGap(T, o.poly, i));
    return {
      target: T, turned: F, turn, east, north,
      ew: Math.round(Math.abs(east) / st), ewKey: east >= 0 ? "→" : "←",
      ns: Math.round(Math.abs(north) / st), nsKey: north >= 0 ? "↑" : "↓",
      gaps, inside: G.clearance(T, o.poly), obGap: obGap(T),
      gapsNow: o.poly.map((_, i) => PL.edgeGap(o.foot, o.poly, i)), insideNow: G.clearance(o.foot, o.poly)
    };
  },
  // find the blue selected-lot outline in a screenshot and reduce it to n corners
  detectOutline(data, w, h, n) {
    const pts = [];
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const k = (y * w + x) * 4, r = data[k], g = data[k + 1], b = data[k + 2];
      if (r < 40 && g > 120 && g < 185 && b > 225) pts.push([x, y]);
    }
    if (pts.length < 30) return null;
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    let hull = lo.slice(0, -1).concat(up.slice(0, -1));
    const triA = (a, b, c) => Math.abs(cross(a, b, c)) / 2;
    if (!n) {   // keep the corners that are really there: drop points within 4 px of the line past them
      for (;;) {
        let mi = -1, mv = Infinity;
        for (let i = 0; i < hull.length; i++) {
          const a = hull[(i - 1 + hull.length) % hull.length], b = hull[i], c = hull[(i + 1) % hull.length];
          const dev = 2 * triA(a, b, c) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1);
          if (dev < mv) { mv = dev; mi = i; }
        }
        if (mv > 4 || hull.length <= 3) break;
        hull.splice(mi, 1);
      }
      // merge corners closer than 6 px (thick line ends)
      hull = hull.filter((p, i) => { const q = hull[(i + 1) % hull.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 6; });
      return hull;
    }
    while (hull.length > n) {
      let mi = 0, mv = Infinity;
      for (let i = 0; i < hull.length; i++) {
        const v = triA(hull[(i - 1 + hull.length) % hull.length], hull[i], hull[(i + 1) % hull.length]);
        if (v < mv) { mv = v; mi = i; }
      }
      hull.splice(mi, 1);
    }
    return hull;
  }
};
if (typeof module !== "undefined") module.exports = PL;
