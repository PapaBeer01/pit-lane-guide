// Bakes the car model's own wing livery (paint + decals, CC BY model) onto the CAD wings: each livery triangle on the
// model's front/rear wing is snapped along its normal onto the nearest CAD wing surface and stored in that CAD mesh's
// local frame, so it moves with the flaps.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({args:['--ignore-gpu-blocklist','--enable-webgl']});
  const p = await (await b.newContext({ viewport: { width: 400, height: 300 } })).newPage();
  p.on('console', (m) => console.log('>', m.text()));
  await p.goto('http://localhost:8765/teardown/explore.html?noskin');
  await p.waitForSelector('.load', {state: 'detached', timeout: 240000});
  await p.evaluate((sp) => (window.__SPEC = sp), JSON.parse(fs.readFileSync(process.argv[3] || __dirname + '/wingskin-spec.json', 'utf8')));
  const out = await p.evaluate(() => {
    const {st} = window.EXPLORE; const car = st.car; const root = car.root; const {fwing, rwing} = car.wings();
    for (const f of fwing.flaps) f.o.quaternion.copy(f.base);
    rwing.flap.quaternion.copy(rwing.base);
    root.updateMatrixWorld(true);
    const THREE_V = root.position.constructor; const V = () => new THREE_V();
    const inv = root.matrixWorld.clone().invert();
    const Ray = (() => { let R = null; root.traverse((o) => { if (!R && o.raycast) R = o; }); return null; })();
    const targets = {};
    for (const [tag, g] of [['fw', fwing.g], ['rw', rwing.g]]) { const list = []; let i = 0; g.traverse((o) => { if (o.isMesh) { o.userData.skinId = `${tag}:${i}`; list.push(o); } i++; }); targets[tag] = list; }
    const rc = new (window.EXPLORE.Raycaster)(); rc.near = 0; rc.far = 0.24;
    const res = {};
    let srcs = []; root.traverse((o) => { if (o.isMesh && o.userData.real) { const bm = Array.isArray(o.userData.base) ? o.userData.base[0] : o.userData.base; const n = bm.name || ''; if (/redbull_paint/.test(n)) srcs.push([o, 'paint']); if (/redbull_decals/.test(n)) window.__dec = o; } });
    let kept = 0, drop = 0;
    for (const [o, kind] of srcs) {
      const pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal, uv = o.geometry.attributes.uv, idx = o.geometry.index;
      const nm = new (o.normalMatrix.constructor)().getNormalMatrix(o.matrixWorld);
      const cache = new Map();
      const hit = (i, reg) => { const k = i + reg; if (cache.has(k)) return cache.get(k);
        const P = V().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const N = V().fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        rc.set(P.clone().addScaledVector(N, 0.12), N.clone().negate());
        const hs = rc.intersectObjects(targets[reg], false); let best = null;
        for (const h of hs) { const d = Math.abs(h.distance - 0.12); if (!best || d < best.d) best = {d, h}; }
        let r = null;
        if (best && best.d < 0.1) { const fn = best.h.face.normal.clone().transformDirection(best.h.object.matrixWorld); if (fn.dot(N) < 0) fn.negate();
          r = {m: best.h.object, p: best.h.point.clone().addScaledVector(fn, 0.0015), s: best.h.distance - 0.12, u: uv.getX(i), v: uv.getY(i)}; }
        cache.set(k, r); return r; };
      for (let t = 0; t < idx.count; t += 3) {
        const ia = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        const c = V(); ia.forEach((i) => c.add(V().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld))); c.multiplyScalar(1 / 3).applyMatrix4(inv);
        const reg = c.x > 3.66 ? 'fw' : (c.x < -0.30 && c.y > 0.66) ? 'rw' : null; if (!reg) continue;
        const hs = ia.map((i) => hit(i, reg));
        if (hs.some((h) => !h) || hs[1].m !== hs[0].m || hs[2].m !== hs[0].m || Math.max(...hs.map((h) => h.s)) - Math.min(...hs.map((h) => h.s)) > 0.04) { drop++; continue; }
        const m = hs[0].m; const key = m.userData.skinId + '|' + kind;
        const e = res[key] || (res[key] = []);
        const li = m.matrixWorld.clone().invert();
        for (const h of hs) { const q = h.p.clone().applyMatrix4(li); e.push(q.x, q.y, q.z, h.u, h.v); }
        kept++;
      }
    }
    console.log('kept', kept, 'dropped', drop);
    // decals: the RB22's sponsor logos from the car model's own decal sheet, each projected flat onto the CAD
    // surface that faces it (placed like the model's own wings: Red Bull across the front wing, Mobil on its
    // endplates, Oracle on the rear wing's top flap, Gate on its main plane, Mobil 1 on its endplates)
    // rect: pixels in the 1024 sheet; ccw / cw: the logo lies rotated a quarter turn anticlockwise / clockwise in the sheet
    const SPEC = window.__SPEC;
    let np = 0;
    for (const sp of SPEC) {
      const n = V().set(...sp.n).normalize(); const r = V().set(...sp.r); r.addScaledVector(n, -r.dot(n)).normalize(); const up = V().crossVectors(n, r);
      const c = V().set(...sp.c).applyMatrix4(root.matrixWorld);
      const nW = n.clone().transformDirection(root.matrixWorld), rW = r.clone().transformDirection(root.matrixWorld), upW = up.clone().transformDirection(root.matrixWorld);
      const [x0, y0, x1, y1] = sp.rect; const u0 = x0 / 1024, u1 = x1 / 1024, v0 = y0 / 1024, v1 = y1 / 1024;
      const st = (q) => { const d = V().subVectors(q, c); return [d.dot(rW) / sp.w + 0.5, d.dot(upW) / sp.h + 0.5, d.dot(nW)]; };
      const uvOf = ([s1, t1]) => sp.ccw ? [u1 - t1 * (u1 - u0), v1 - s1 * (v1 - v0)] : sp.cw ? [u0 + t1 * (u1 - u0), v0 + s1 * (v1 - v0)] : [u0 + s1 * (u1 - u0), v1 - t1 * (v1 - v0)];
      for (const m of targets[sp.reg]) {
        const g2 = m.geometry; const mp = g2.attributes.position; const mi = g2.index; const cnt = mi ? mi.count : mp.count;
        const W = []; for (let i = 0; i < mp.count; i++) W.push(V().fromBufferAttribute(mp, i).applyMatrix4(m.matrixWorld));
        const li = m.matrixWorld.clone().invert(); const out = [];
        for (let t = 0; t < cnt; t += 3) {
          const ia = mi ? [mi.getX(t), mi.getX(t + 1), mi.getX(t + 2)] : [t, t + 1, t + 2];
          const q = ia.map((i) => st(W[i]));
          if (q.every((x) => x[0] < -0.02) || q.every((x) => x[0] > 1.02) || q.every((x) => x[1] < -0.02) || q.every((x) => x[1] > 1.02)) continue;
          if (q.every((x) => Math.abs(x[2]) > 0.1)) continue;
          const cen = V().add(W[ia[0]]).add(W[ia[1]]).add(W[ia[2]]).multiplyScalar(1 / 3);
          const fn = V().subVectors(W[ia[1]], W[ia[0]]).cross(V().subVectors(W[ia[2]], W[ia[0]])).normalize();
          if (Math.abs(fn.dot(nW)) < 0.3) continue;
          rc.set(cen.clone().addScaledVector(nW, 0.2), nW.clone().negate());
          const h = rc.intersectObjects(targets[sp.reg], false)[0];
          if (!h || h.object !== m || Math.abs(h.distance - 0.2) > 0.002) continue;
          out.push(t / 3);
        }
        if (!out.length) continue;
        const uvAt = (L) => uvOf(st(L.clone().applyMatrix4(m.matrixWorld)));
        const o0 = uvAt(V()); const ax = [V().set(1, 0, 0), V().set(0, 1, 0), V().set(0, 0, 1)].map((e) => uvAt(e));
        const map = [ax[0][0] - o0[0], ax[1][0] - o0[0], ax[2][0] - o0[0], o0[0], ax[0][1] - o0[1], ax[1][1] - o0[1], ax[2][1] - o0[1], o0[1]];
        const off = nW.clone().multiplyScalar(0.002).add(V().setFromMatrixPosition(m.matrixWorld)).applyMatrix4(li);
        res[`${m.userData.skinId}|decal|${np}|${JSON.stringify({b: [u0, v0, u1, v1], map, nrm: off.toArray()})}`] = out;
      }
      np++;
    }
    console.log('decal patches', np);
    return res;
  });
  // binary: u32 header length, header JSON, padding to 4, float32 [x y z u v] per vertex
  const keys = Object.keys(out); const header = []; const arrs = [];
  let off = 0; for (const k of keys) { const [id, kind, , js] = k.split('|'); const ex = js ? JSON.parse(js) : null; header.push({id, kind, n: ex ? out[k].length : out[k].length / 5, off, ...(ex || {})}); off += out[k].length; arrs.push(out[k]); }
  let hb = Buffer.from(JSON.stringify(header)); const pad = (4 - ((4 + hb.length) % 4)) % 4; hb = Buffer.concat([hb, Buffer.alloc(pad, 32)]);
  const data = new Float32Array(off); let o = 0; for (const a of arrs) { data.set(a, o); o += a.length; }
  const len = Buffer.alloc(4); len.writeUInt32LE(hb.length);
  fs.writeFileSync(process.argv[2], Buffer.concat([len, hb, Buffer.from(data.buffer)]));
  console.log(header.map((h) => `${h.id} ${h.kind} ${h.n / 3}`).join('\n'), '\nbytes', 4 + hb.length + data.byteLength);
  await b.close();
})();
