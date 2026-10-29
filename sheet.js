// Alien Farmers Ledger · build sheet picture (v55)
// One tall picture to keep open next to Upland: the lot from straight above with numbered spots, the 3D view, the steps in order,
// what you need, and how to read it.
const C = {bg: "#07090f", panel: "#0d131d", line: "#1f2a3a", ink: "#e9eef5", muted: "#8c9bb1", dim: "#5f6e84", leaf: "#5ee38f", amber: "#f6b552", red: "#ff6b6b", sky: "#62dcff"};
const KCOL = {add: C.leaf, move: C.amber, pick: C.red};
const F = (w, px, fam = "body") => `${w} ${px}px ${fam === "display" ? '"Bricolage Grotesque","Avenir Next",system-ui,sans-serif' : fam === "mono" ? '"IBM Plex Mono",ui-monospace,Menlo,monospace' : '"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif'}`;
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
function wrap(ctx, text, width){
  const words = String(text).split(/\s+/), lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function rr(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// info: {top:{url,w,h,proj,ppm}, hero, title, sub, design, steps:[{n,kind,name,text,x,z,bad}], needs:[{name,count,wallet}], ring:[[x,z]...], made}
export async function makeSheet(info){
  try { await document.fonts.ready; } catch {}
  const W = 2400, M = 48, PW = 1400, RX = M + PW + 48, RW = W - RX - M;
  const meas = document.createElement("canvas").getContext("2d");
  // right column height
  meas.font = F(400, 25); let rh = 0;
  const heroH = info.hero ? Math.round(RW * .58) : 0; rh += heroH ? heroH + 36 : 0;
  rh += 64;
  const stepLines = info.steps.map(s => { meas.font = F(400, 25); return wrap(meas, s.text, RW - 120); });
  for (const L of stepLines) rh += 46 + L.length * 33 + 16;
  if (!info.steps.length) rh += 60;
  meas.font = F(400, 25);
  const needLines = info.needs.length ? wrap(meas, info.needs.map(n => `${n.count} × ${n.name}${n.wallet != null ? ` (${n.wallet} in wallet${n.wallet < n.count ? `, ${n.count - n.wallet} short` : ""})` : ""}`).join("  ·  "), RW - 40) : [];
  rh += needLines.length ? 70 + needLines.length * 33 + 30 : 0;
  const tips = ["Do the steps in order: every item snaps to one placed before it, so Upland's own snapping puts it in the right spot.",
    "Numbers on the map match the steps. Green = place new, amber = move, red = pick up.", "Letters are the lot's edges. Distances are measured from them, centre to edge."];
  meas.font = F(400, 23); const tipLines = tips.map(t => wrap(meas, t, RW - 62)); rh += 70 + tipLines.reduce((a, l) => a + l.length * 30 + 10, 0);
  const H = Math.max(200 + PW + 150, 200 + rh + 80) + 70;

  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 900); glow.addColorStop(0, "rgba(94,227,143,.12)"); glow.addColorStop(1, "rgba(94,227,143,0)"); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 900);
  // header
  ctx.fillStyle = C.leaf; ctx.font = F(600, 22, "mono"); ctx.fillText("ALIEN FARMERS  ·  BUILD SHEET", M, 62);
  ctx.fillStyle = C.ink; ctx.font = F(800, 56, "display"); ctx.fillText(info.title || "Lot", M, 128);
  ctx.fillStyle = C.muted; ctx.font = F(400, 26); ctx.fillText([info.design, info.sub, info.made].filter(Boolean).join("  ·  "), M, 168);
  const add = info.steps.filter(s => s.kind === "add").length, mv = info.steps.filter(s => s.kind === "move").length, pk = info.steps.filter(s => s.kind === "pick").length;
  ctx.textAlign = "right"; ctx.fillStyle = C.ink; ctx.font = F(700, 30, "mono"); ctx.fillText(`${info.steps.length} step${info.steps.length === 1 ? "" : "s"}`, W - M, 110);
  ctx.fillStyle = C.muted; ctx.font = F(400, 24); ctx.fillText([add && `${add} to place`, mv && `${mv} to move`, pk && `${pk} to pick up`].filter(Boolean).join(" · ") || "no changes", W - M, 146); ctx.textAlign = "left";

  // the plan (straight down, north up)
  const py = 200;
  rr(ctx, M, py, PW, PW, 22); ctx.save(); ctx.clip();
  const top = await loadImg(info.top.url); ctx.drawImage(top, M, py, PW, PW);
  ctx.restore(); rr(ctx, M, py, PW, PW, 22); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
  const sx = PW / info.top.w, P = (x, z) => { const [a, b] = info.top.proj(x, z); return [M + a * sx, py + b * sx]; };
  // edge letters
  const R = info.ring && info.ring.length ? (info.ring[0][0] === info.ring[info.ring.length - 1][0] ? info.ring.slice(0, -1) : info.ring) : [];
  if (R.length) {
    const cx = R.reduce((a, p) => a + p[0], 0) / R.length, cz = R.reduce((a, p) => a + p[1], 0) / R.length;
    R.forEach((p, i) => { const q = R[(i + 1) % R.length], mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, dx = mx - cx, dz = mz - cz, L = Math.hypot(dx, dz) || 1, [X, Y] = P(mx + dx / L * 2.2, mz + dz / L * 2.2);
      ctx.fillStyle = "rgba(7,9,15,.8)"; ctx.beginPath(); ctx.arc(X, Y, 20, 0, 7); ctx.fill(); ctx.strokeStyle = C.sky; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = C.sky; ctx.font = F(700, 22, "mono"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("ABCDEFGHIJKLMNOP"[i], X, Y + 1); });
  }
  // step badges
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const s of info.steps) {
    if (s.x == null) continue; const [X, Y] = P(s.x, s.z), r = s.n > 99 ? 22 : 18, col = KCOL[s.kind] || C.leaf;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = s.bad ? C.red : "rgba(7,9,15,.9)"; ctx.stroke();
    ctx.fillStyle = "#06120c"; ctx.font = F(800, s.n > 99 ? 17 : 19, "mono"); ctx.fillText(String(s.n), X, Y + 1);
  }
  // north arrow + scale bar
  const nx = M + 60, ny = py + 70; ctx.fillStyle = "rgba(7,9,15,.75)"; ctx.beginPath(); ctx.arc(nx, ny, 36, 0, 7); ctx.fill();
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(nx, ny - 26); ctx.lineTo(nx - 12, ny + 4); ctx.lineTo(nx + 12, ny + 4); ctx.closePath(); ctx.fill(); ctx.font = F(700, 20, "mono"); ctx.fillText("N", nx, ny + 20);
  const m5 = [1, 2, 5, 10, 20].find(m => m * info.top.ppm * sx > 120) || 20, bw = m5 * info.top.ppm * sx, bx = M + PW - 40 - bw, by = py + PW - 44;
  ctx.fillStyle = "rgba(7,9,15,.75)"; rr(ctx, bx - 16, by - 34, bw + 32, 56, 12); ctx.fill();
  ctx.fillStyle = C.ink; ctx.fillRect(bx, by, bw, 6); ctx.fillRect(bx, by - 8, 3, 14); ctx.fillRect(bx + bw - 3, by - 8, 3, 14);
  ctx.font = F(600, 18, "mono"); ctx.fillText(`${m5} m · ${Math.round(m5 / 1.2 * 10) / 10} pavers`, bx + bw / 2, by - 18);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  // legend under the plan
  let lx = M, ly = py + PW + 52; ctx.font = F(500, 24);
  for (const [col, t] of [[C.leaf, "Place new"], [C.amber, "Move"], [C.red, "Pick up"], [C.sky, "Lot edge"]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx + 12, ly - 8, 11, 0, 7); ctx.fill(); ctx.fillStyle = C.muted; ctx.fillText(t, lx + 32, ly); lx += ctx.measureText(t).width + 80; }
  ctx.fillStyle = C.dim; ctx.font = F(400, 21); ctx.fillText("Seen from straight above, north at the top. Your design, built from Upland's own models and their real sizes.", M, ly + 44);

  // right column
  let y = py;
  if (info.hero) { const hi = await loadImg(info.hero); rr(ctx, RX, y, RW, heroH, 18); ctx.save(); ctx.clip(); ctx.drawImage(hi, RX, y, RW, heroH); ctx.restore(); y += heroH + 36; }
  ctx.fillStyle = C.ink; ctx.font = F(800, 34, "display"); ctx.fillText("Build list", RX, y + 34); y += 64;
  if (!info.steps.length) { ctx.fillStyle = C.muted; ctx.font = F(400, 25); ctx.fillText("No changes in this design yet.", RX, y + 30); y += 60; }
  info.steps.forEach((s, i) => {
    const L = stepLines[i], h = 46 + L.length * 33 + 16, col = KCOL[s.kind] || C.leaf;
    rr(ctx, RX, y, RW, h - 12, 14); ctx.fillStyle = C.panel; ctx.fill(); ctx.strokeStyle = s.bad ? "rgba(255,107,107,.6)" : C.line; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(RX + 40, y + 34, 22, 0, 7); ctx.fill(); ctx.fillStyle = "#06120c"; ctx.font = F(800, 20, "mono"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(s.n), RX + 40, y + 35);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = col; ctx.font = F(700, 18, "mono"); const tag = s.kind === "add" ? "PLACE" : s.kind === "move" ? "MOVE" : "PICK UP"; ctx.fillText(tag, RX + 80, y + 32);
    const tw = ctx.measureText(tag).width; ctx.fillStyle = C.ink; ctx.font = F(700, 26); ctx.fillText(s.name, RX + 80 + tw + 14, y + 33);
    ctx.fillStyle = s.bad ? C.red : C.muted; ctx.font = F(400, 25); L.forEach((l, k) => ctx.fillText(l, RX + 80, y + 70 + k * 33));
    y += h;
  });
  if (needLines.length) { y += 20; ctx.fillStyle = C.ink; ctx.font = F(800, 30, "display"); ctx.fillText("You'll need", RX, y + 30); y += 56; ctx.fillStyle = C.muted; ctx.font = F(400, 25); needLines.forEach(l => { ctx.fillText(l, RX, y + 25); y += 33; }); y += 20; }
  y += 20; ctx.fillStyle = C.ink; ctx.font = F(800, 30, "display"); ctx.fillText("How to read it", RX, y + 30); y += 52;
  ctx.fillStyle = C.muted; ctx.font = F(400, 23); tipLines.forEach(L => { L.forEach((l, i) => { if (!i) ctx.fillText("•", RX, y + 24); ctx.fillText(l, RX + 22, y + 24); y += 30; }); y += 10; });
  // footer
  ctx.fillStyle = C.dim; ctx.font = F(500, 20, "mono"); ctx.fillText("Made with the Alien Farmers Nursery Ledger", M, H - 30);
  return cv;
}
export function saveCanvas(cv, name){
  return new Promise(res => cv.toBlob(async blob => {
    const file = new File([blob], name, {type: "image/png"});
    if (matchMedia("(pointer: coarse)").matches && navigator.canShare && navigator.canShare({files: [file]})) { try { await navigator.share({files: [file], title: name}); return res(true); } catch (e) { if (e && e.name === "AbortError") return res(false); } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); res(true);
  }, "image/png"));
}
