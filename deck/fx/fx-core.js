/* =========================================================
   fx-core.js — LÕI thư viện hiệu ứng high-tech (skill slide-making v2)
   Nạp SAU deck.js (và gsap nếu dùng), TRƯỚC các module deck/fx/*.js.
   Cho window.FX: đọc màu/biến phong cách · canvas theo toạ độ sân khấu 1920×1080 ·
   vòng lặp khung hình tự tạm dừng · số ngẫu nhiên có hạt giống · đăng ký module ·
   tự khởi tạo [data-fx] và gắn vào nhịp bấm (data-fx-step).
   Không cần thư viện nào. Hướng dẫn: references/motion/README.md
   ========================================================= */
(() => {
  'use strict';
  if (window.FX && window.FX.version) return;            // lỡ nạp 2 lần → giữ bản đầu

  // deck.js khai báo `const Deck` (không nằm trên window) → phải đọc qua typeof
  const deck = () => (typeof Deck !== 'undefined' ? Deck : null);
  const $ = el => (typeof el === 'string' ? document.querySelector(el) : el);
  const varRoot = () => (deck() && deck().stage) || document.documentElement;   // biến CSS kế thừa từ :root
  const warned = new Set();
  const warnOnce = msg => { if (!warned.has(msg)) { warned.add(msg); console.warn('[FX] ' + msg); } };

  const FX = window.FX = { version: '2.0', instances: [] };
  FX.reduced = !!((deck() && deck().reduced) || matchMedia('(prefers-reduced-motion: reduce)').matches);
  Object.defineProperty(FX, 'gsap', { get: () => window.gsap || null, enumerable: true });   // GSAP: có thì dùng, không bắt buộc

  // ---------- Biến phong cách (đọc lúc khởi tạo, KHÔNG đọc trong vòng lặp) ----------
  const norm = n => (n.startsWith('--') ? n : '--' + n);
  FX.prop = (name, el) => getComputedStyle($(el) || varRoot()).getPropertyValue(norm(name)).trim();
  FX.num = (name, fallback = 0, el) => { const v = parseFloat(FX.prop(name, el)); return Number.isFinite(v) ? v : fallback; };
  FX.ms = (name, fallback = 0, el) => {                  // '.8s' → 800 · '400ms' → 400
    const s = FX.prop(name, el), v = parseFloat(s);
    return Number.isFinite(v) ? (/ms$/.test(s) ? v : /s$/.test(s) ? v * 1000 : v) : fallback;
  };

  // ---------- Màu: FX.color('accent') → [r,g,b]; thử --accent-rgb rồi --accent ----------
  let probe;
  function parseColor(s) {
    s = (s || '').trim(); if (!s) return null;
    let m = s.match(/^(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)$/);   // "245,166,35"
    if (m) return [m[1], m[2], m[3]].map(x => Math.round(+x));
    m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) { let h = m[1]; if (h.length < 6) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
    m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) return [m[1], m[2], m[3]].map(x => Math.round(+x));
    // kiểu khác (tên màu, hsl, oklch, color-mix…) → nhờ canvas 1×1 quy đổi
    probe = probe || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.fillStyle = '#010203'; probe.fillStyle = s;
    if (probe.fillStyle === '#010203' && !/^#010203$/i.test(s)) return null;   // chuỗi không phải màu
    probe.clearRect(0, 0, 1, 1); probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  const colors = new Map();
  FX.color = name => {
    if (Array.isArray(name)) return name.slice(0, 3);
    if (!colors.has(name)) {
      const n = String(name).replace(/^--/, '');
      let c = parseColor(FX.prop(n + '-rgb')) || parseColor(FX.prop(n));
      if (!c && !/^[a-z][a-z0-9-]*$/i.test(n)) c = parseColor(n);   // cho phép mã màu thật (vd màu app Zalo)
      if (!c) { warnOnce(`Phong cách chưa có màu "${n}" (thiếu --${n}-rgb/--${n}) → tạm dùng --fg`); c = n === 'fg' ? [255, 255, 255] : FX.color('fg'); }
      colors.set(name, c);
    }
    return colors.get(name).slice();
  };
  FX.rgba = (name, a = 1) => { const [r, g, b] = FX.color(name); return `rgba(${r},${g},${b},${a})`; };
  FX.mix = (a, b, t) => { const x = FX.color(a), y = FX.color(b); return x.map((v, i) => Math.round(v + (y[i] - v) * t)); };
  FX.refresh = () => colors.clear();                     // gọi sau khi đổi theme lúc đang chạy

  // ---------- CSS của module: FX.css(id, text) chèn <style id="fx-css-id"> một lần ----------
  // Chèn TRƯỚC mọi stylesheet của trang → CSS riêng của slide luôn ghi đè được mặc định của module
  FX.css = (id, css) => {
    let s = document.getElementById('fx-css-' + id);
    if (!s) {
      s = document.createElement('style'); s.id = 'fx-css-' + id; s.textContent = css;
      const head = document.head || document.documentElement;
      head.insertBefore(s, head.querySelector('link[rel="stylesheet"],style:not([id^="fx-css-"])'));
    }
    return s;
  };
  FX.css('core', `
.fx-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;contain:layout paint}
.fx-canvas{position:absolute;left:0;top:0;display:block;pointer-events:none}
[data-fx-avoid=left]{-webkit-mask-image:linear-gradient(90deg,transparent 30%,#000 64%);mask-image:linear-gradient(90deg,transparent 30%,#000 64%)}
[data-fx-avoid=right]{-webkit-mask-image:linear-gradient(270deg,transparent 30%,#000 64%);mask-image:linear-gradient(270deg,transparent 30%,#000 64%)}
[data-fx-avoid=top]{-webkit-mask-image:linear-gradient(180deg,transparent 22%,#000 55%);mask-image:linear-gradient(180deg,transparent 22%,#000 55%)}
[data-fx-avoid=bottom]{-webkit-mask-image:linear-gradient(0deg,transparent 22%,#000 55%);mask-image:linear-gradient(0deg,transparent 22%,#000 55%)}
[data-fx-avoid=center]{-webkit-mask-image:radial-gradient(ellipse 48% 44% at 50% 50%,transparent 45%,#000 100%);mask-image:radial-gradient(ellipse 48% 44% at 50% 50%,transparent 45%,#000 100%)}`);

  // ---------- Canvas đo theo PX SÂN KHẤU (không đổi khi deck.js co giãn .stage) ----------
  FX.canvas = (host, opts = {}) => {
    host = $(host);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const cv = document.createElement('canvas');
    cv.className = 'fx-canvas' + (opts.className ? ' ' + opts.className : '');
    cv.setAttribute('aria-hidden', 'true');
    if (opts.z != null) cv.style.zIndex = opts.z;
    if (opts.before) host.prepend(cv); else host.appendChild(cv);
    const type = opts.context || '2d';
    const c = { cv, ctx: cv.getContext(type, type === '2d' ? { alpha: opts.alpha !== false } : opts.attrs), w: 0, h: 0,
      dpr: Math.min(window.devicePixelRatio || 1, opts.dpr || 1.5) };
    c.resize = () => {                                   // trả về true nếu kích thước đổi (canvas bị xoá trắng)
      const w = host.offsetWidth || opts.w || 1, h = host.offsetHeight || opts.h || 1;
      if (w === c.w && h === c.h) return false;
      c.w = w; c.h = h; cv.width = Math.round(w * c.dpr); cv.height = Math.round(h * c.dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      if (c.ctx && c.ctx.setTransform) c.ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);   // vẽ bằng px sân khấu
      if (opts.onResize) opts.onResize(c);
      return true;
    };
    c.clear = () => c.ctx.clearRect(0, 0, c.w, c.h);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => c.resize()) : null;
    if (ro) ro.observe(host);
    c.destroy = () => { if (ro) ro.disconnect(); cv.remove(); };
    c.resize();
    return c;
  };

  // ---------- Vòng lặp: MỘT requestAnimationFrame chung cho mọi hiệu ứng ----------
  // fn(t, dt): t = ms đã chạy (không tính lúc tạm dừng), dt = ms từ khung trước (≤ 50)
  const loops = new Set(), stats = { frames: 0, avg: 0, max: 0 };
  let raf = 0, idle = 0, last = 0;
  const paused = () => document.hidden || (deck() && deck().active === false);
  function tick(now) {
    raf = 0;
    if (!loops.size) return;
    if (paused()) { last = 0; idle = setTimeout(wake, 250); return; }   // slide ẩn → ngủ, hỏi lại sau 1/4 giây
    const dt = last ? Math.min(now - last, 50) : 16.7; last = now;
    const t0 = performance.now();
    for (const L of loops) {
      L.t += dt;
      try { L.fn(L.t, dt); } catch (e) { console.error('[FX] vòng lặp lỗi → dừng', e); L.stop(); }
    }
    const cost = performance.now() - t0;
    stats.frames++; stats.avg += (cost - stats.avg) * .05; stats.max = Math.max(stats.max, cost);
    raf = requestAnimationFrame(tick);
  }
  function wake() { clearTimeout(idle); idle = 0; if (!raf && loops.size) raf = requestAnimationFrame(tick); }
  document.addEventListener('visibilitychange', wake);
  FX.loop = fn => {
    const L = { fn, t: 0, running: true, stop() { L.running = false; loops.delete(L); } };
    if (FX.reduced) {                                    // giảm chuyển động: vẽ đúng 1 khung tĩnh rồi thôi
      requestAnimationFrame(() => { if (!L.running) return; L.running = false; try { fn(0, 0); } catch (e) { console.error('[FX]', e); } });
      return L;
    }
    loops.add(L); wake(); return L;
  };
  FX.stats = (resetMax) => {                             // đo tải: avgMs/maxMs của mọi vòng lặp mỗi khung
    const s = { loops: loops.size, instances: FX.instances.length, frames: stats.frames, avgMs: +stats.avg.toFixed(3), maxMs: +stats.max.toFixed(3) };
    if (resetMax) stats.max = 0;
    return s;
  };

  // ---------- Số ngẫu nhiên có hạt giống (cùng seed → cùng hình → ảnh chụp ổn định) ----------
  FX.rand = (seed = 1) => {
    let a = typeof seed === 'number' ? seed >>> 0
      : [...String(seed)].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
    const r = () => {                                    // mulberry32
      a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
    r.pick = arr => arr[Math.floor(r() * arr.length)];
    return r;
  };

  // Tách chữ theo cụm ký tự (không tách dấu tiếng Việt khỏi chữ cái)
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('vi', { granularity: 'grapheme' }) : null;
  FX.graphemes = s => (seg ? Array.from(seg.segment(String(s).normalize('NFC')), x => x.segment) : Array.from(String(s).normalize('NFC')));

  // ---------- Đăng ký module: FX.register('ten', (el, opts, ctx) => ({play, reset, stop})) ----------
  const registry = {}, bound = [];
  const parseOpts = el => {
    const s = el.dataset && el.dataset.fxOpts; if (!s) return {};
    try { return JSON.parse(s); } catch (e) { console.warn('[FX] data-fx-opts không phải JSON hợp lệ:', s, el); return {}; }
  };
  const safe = (inst, k) => { try { inst[k](); } catch (e) { console.error(`[FX] ${inst.name}.${k}() lỗi`, e); } };
  FX.register = (name, factory) => {
    registry[name] = factory;
    return (FX[name] = (el, opts) => {
      el = $(el);
      if (!el) { warnOnce(`${name}: không tìm thấy phần tử`); return { name, play() {}, reset() {}, stop() {} }; }
      if (el._fx && el._fx[name]) el._fx[name].stop();   // tạo lại trên cùng phần tử → dọn bản cũ (không rò canvas)
      opts = Object.assign({}, parseOpts(el), opts);
      const ctx = { name, deck: deck(), reduced: FX.reduced, rand: FX.rand(opts.seed != null ? opts.seed : name + (el.id || '')),
        density: FX.num('--fx-density', 1, el), speed: FX.num('--fx-speed', 1, el), step: +el.dataset.fxStep || 0 };
      let inst;
      try { inst = factory(el, opts, ctx) || {}; } catch (e) { console.error(`[FX] ${name}: lỗi khi khởi tạo`, e); inst = {}; }
      for (const k of ['play', 'reset']) if (typeof inst[k] !== 'function') inst[k] = () => {};
      if (typeof inst.stop !== 'function') warnOnce(`module "${name}" thiếu stop() — không dọn được khi tạo lại`);
      const stop0 = typeof inst.stop === 'function' ? inst.stop : () => {};
      inst.stop = function () {
        const i = FX.instances.indexOf(inst); if (i < 0) return;   // gọi stop() nhiều lần vẫn an toàn
        FX.instances.splice(i, 1);
        const j = bound.findIndex(b => b.inst === inst); if (j >= 0) bound.splice(j, 1);
        if (el._fx && el._fx[name] === inst) delete el._fx[name];
        try { stop0.call(inst); } catch (e) { console.error(`[FX] ${name}.stop() lỗi`, e); }
      };
      if (!inst.name) inst.name = name;
      if (!inst.el) inst.el = el;
      (el._fx = el._fx || {})[name] = inst;
      FX.instances.push(inst);
      return inst;
    });
  };
  FX.get = (el, name) => { el = $(el); const m = el && el._fx; return m ? (name ? m[name] : Object.values(m)[0]) || null : null; };
  FX.stopAll = () => [...FX.instances].forEach(i => i.stop());

  // ---------- Gắn hiệu ứng vào nhịp trình chiếu ----------
  // Không có step: play() mỗi lần slide chạy (Deck.onPlay). data-fx-step="k": reset() lúc đầu,
  // play() khi tới nhịp bấm thứ k, reset() khi lùi về dưới k. deck.js cũ (chưa có onStep) → coi như không có step.
  let hooked = false;
  const curStep = () => (deck() && deck().step) || 0;
  const played = () => { const D = deck(); return !D || !D.stage || D.stage.classList.contains('play'); };
  function sync(n, replay) {
    for (const b of bound.slice()) {
      if (!replay && !b.step) continue;                  // đổi nhịp bấm không đụng hiệu ứng chạy theo slide
      const on = !b.step || n >= b.step;
      if (on && (replay || !b.on)) safe(b.inst, 'play');
      else if (!on && b.on) safe(b.inst, 'reset');       // chưa bật thì vốn đã ở trạng thái reset
      b.on = on;
    }
  }
  function hook() {
    const D = deck(); if (hooked || !D) return; hooked = true;
    D.onPlay(() => { wake(); sync(curStep(), true); });
    if (typeof D.onStep === 'function') D.onStep(n => sync(n, false));
  }
  FX.bind = (inst, step) => {                            // dùng cho hiệu ứng tạo bằng JS: FX.bind(FX.chart(el, {...}), 2)
    hook();
    if (!inst || bound.some(b => b.inst === inst)) return inst;   // đã gắn rồi → không gắn 2 lần
    const D = deck(), k =D && typeof D.onStep === 'function' ? Math.max(0, parseInt(step, 10) || 0) : 0;
    const b = { inst, step: k, on: false };
    bound.push(b);
    if (k) safe(inst, 'reset');
    if (played()) { b.on = !k || curStep() >= k; if (b.on) safe(inst, 'play'); }
    return inst;
  };

  // ---------- Khởi tạo tự động: <div class="fx-layer" data-fx="ten" data-fx-opts='{"…":…}' data-fx-step="2"> ----------
  FX.auto = (scope = document) => {
    scope = $(scope); const made = [];
    const els = [...scope.querySelectorAll('[data-fx]')];
    if (scope.matches && scope.matches('[data-fx]')) els.unshift(scope);
    for (const el of els) {
      const name = el.dataset.fx.trim();
      if (el._fx && el._fx[name]) continue;              // đã khởi tạo rồi
      if (!registry[name]) { warnOnce(`chưa có module "${name}" — thiếu <script src="deck/fx/….js">?`); continue; }
      made.push(FX.bind(FX[name](el), el.dataset.fxStep));
    }
    return made;
  };
  const start = () => { if (document.body && document.body.dataset.fxAuto === 'off') return; FX.auto(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);

  // ---------- Dòng thời gian nhỏ (không cần GSAP), tự huỷ khi slide chạy lại ----------
  // FX.timeline().add(fn, 1200).to('.the', [{opacity:0},{opacity:1}], {duration:600, delay:800, stagger:80}).play()
  FX.timeline = () => {
    const items = []; let timers = [], anims = [];
    const tl = {
      add(fn, at = 0) { items.push({ at, fn }); return tl; },
      to(target, keyframes, o = {}) { items.push({ at: o.delay || 0, target, keyframes, o }); return tl; },
      play() {
        tl.kill();
        const D = deck(), ease = FX.prop('--ease-out') || 'cubic-bezier(.16,1,.3,1)', dur = FX.ms('--dur-2', 800);
        const list = FX.reduced ? items.slice().sort((a, b) => a.at - b.at) : items;
        for (const it of list) {
          if (it.fn) {
            if (FX.reduced) it.fn(); else timers.push(D ? D.later(it.fn, it.at) : setTimeout(it.fn, it.at));
            continue;
          }
          const t = it.target, els = typeof t === 'string' ? [...document.querySelectorAll(t)] : t && !t.animate && t.length != null ? [...t] : [t];
          els.forEach((el, i) => {
            const a = el.animate(it.keyframes, { duration: FX.reduced ? 0 : (it.o.duration != null ? it.o.duration : dur),
              delay: FX.reduced ? 0 : it.at + i * (it.o.stagger || 0), easing: it.o.easing || ease, fill: 'both' });
            anims.push(D ? D.track(a) : a);
          });
        }
        return tl;
      },
      kill() { timers.forEach(clearTimeout); anims.forEach(a => a.cancel()); timers = []; anims = []; return tl; }
    };
    return tl;
  };
})();
