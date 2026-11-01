// Bakes the car model's own wing livery (paint + decals, CC BY model) onto the CAD wings: each livery triangle on the
// model's front/rear wing is snapped along its normal onto the nearest CAD wing surface and stored in that CAD mesh's
// local frame, so it moves with the flaps.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({args:['--ignore-gpu-blocklist','--enable-webgl']});
  const p = await (await b.newContext({ viewport: { width: 400, height: 300 } })).newPage();
  p.on('console', (m) => console.log('>', m.text()));
  await p.goto('http://localhost:8765/teardown/explore.html');
  await p.waitForSelector('.load', {state: 'detached', timeout: 240000});
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
    let srcs = []; root.traverse((o) => { if (o.isMesh && o.userData.real) { const bm = Array.isArray(o.userData.base) ? o.userData.base[0] : o.userData.base; const n = bm.name || ''; if (/redbull_decals|redbull_paint/.test(n)) srcs.push([o, /decals/.test(n) ? 'decal' : 'paint']); } });
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
        if (hs.some((h) => !h) || hs[1].m !== hs[0].m || hs[2].m !== hs[0].m || Math.max(...hs.map((h) => h.s)) - Math.min(...hs.map((h) => h.s)) > 0.025) { drop++; continue; }
        const m = hs[0].m; const key = m.userData.skinId + '|' + kind;
        const e = res[key] || (res[key] = []);
        const li = m.matrixWorld.clone().invert();
        for (const h of hs) { const q = h.p.clone().applyMatrix4(li); e.push(q.x, q.y, q.z, h.u, h.v); }
        kept++;
      }
    }
    console.log('kept', kept, 'dropped', drop);
    return res;
  });
  // binary: u32 header length, header JSON, padding to 4, float32 [x y z u v] per vertex
  const keys = Object.keys(out); const header = []; const arrs = [];
  let off = 0; for (const k of keys) { const [id, kind] = k.split('|'); header.push({id, kind, n: out[k].length / 5, off}); off += out[k].length; arrs.push(out[k]); }
  let hb = Buffer.from(JSON.stringify(header)); const pad = (4 - ((4 + hb.length) % 4)) % 4; hb = Buffer.concat([hb, Buffer.alloc(pad, 32)]);
  const data = new Float32Array(off); let o = 0; for (const a of arrs) { data.set(a, o); o += a.length; }
  const len = Buffer.alloc(4); len.writeUInt32LE(hb.length);
  fs.writeFileSync(process.argv[2], Buffer.concat([len, hb, Buffer.from(data.buffer)]));
  console.log(header.map((h) => `${h.id} ${h.kind} ${h.n / 3}`).join('\n'), '\nbytes', 4 + hb.length + data.byteLength);
  await b.close();
})();
