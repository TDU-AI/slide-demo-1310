/* =========================================================
   ambient.js — KHÔNG KHÍ cho nền ảnh AI (skill slide-making v2)
     FX.aurora  3–5 vùng màu lớn, mềm, trôi rất chậm (chạy bằng GPU: transform/opacity)
     FX.sweep   vệt sáng quét chéo định kỳ — qua cả lớp (band) hoặc chỉ trên mặt chữ (text)
     FX.grid    lưới kỹ thuật tự vẽ ra (nét chính/phụ, dấu +, chấm) hoặc sàn phối cảnh trôi (floor)
     FX.blob    khối hữu cơ biến hình chậm: loang mềm (soft) hoặc đường đồng mức (contour)
   Cần deck/fx/fx-core.js nạp trước. Hướng dẫn đủ tùy chọn: references/motion/ambient.md
   ========================================================= */
(() => {
  'use strict';
  const FX = window.FX;
  if (!FX || !FX.register) { console.warn('[FX] ambient.js: cần nạp deck/fx/fx-core.js trước'); return; }

  FX.css('ambient', `
.fx-amb{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity var(--dur-3,1.4s) ease}
.fx-amb.on{opacity:var(--fx-o,1)}
.fx-aur>i{position:absolute;left:0;top:0;border-radius:50%;will-change:transform,opacity}
.fx-swp{overflow:hidden;border-radius:inherit}
.fx-swp>i{position:absolute;left:0;will-change:transform}
.fx-sheen{position:absolute;inset:0;box-sizing:border-box;pointer-events:none;user-select:none;
  color:transparent;-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;background-repeat:no-repeat}
.fx-sheen *{color:transparent!important;-webkit-text-fill-color:transparent!important;background:none!important;text-shadow:none!important}
.fx-grd svg{position:absolute;left:0;top:0;overflow:visible}
.fx-grd .fl{position:absolute;left:0;right:0;bottom:0;overflow:hidden}
.fx-grd .pl{position:absolute;top:0;transform-origin:50% 0;will-change:transform}
@media (prefers-reduced-motion:reduce){.fx-amb{transition:none}}`);

  // ---------- Tiện ích chung ----------
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const isLight = () => lum(FX.color('bg')) > 0.5;
  const colorList = v => (Array.isArray(v) && typeof v[0] !== 'number' ? v : [v]);
  // danh sách màu dùng được; rỗng/sai kiểu → báo và dùng mặc định (không tô "undefined")
  const colorsOr = (v, d, who) => {
    const a = v == null ? [] : colorList(v).filter(n => n != null && n !== '');
    if (!a.length && v != null) console.warn(`[FX] ${who}: color rỗng → dùng mặc định`, d);
    return a.length ? a : colorList(d);
  };
  // điểm [x,y] (%) hợp lệ, không thì báo và dùng mặc định
  const pair = (v, d, what) => {
    if (Array.isArray(v) && v.length > 1 && Number.isFinite(+v[0]) && Number.isFinite(+v[1])) return [+v[0], +v[1]];
    if (v != null) console.warn(`[FX] ${what} không hợp lệ:`, v, '→ dùng', d);
    return d;
  };
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);
  const deck = () => (typeof Deck !== 'undefined' ? Deck : null);
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const FADES = {
    left: 'linear-gradient(90deg,transparent 0,transparent 30%,rgba(0,0,0,.45) 48%,#000 68%)',
    right: 'linear-gradient(270deg,transparent 0,transparent 30%,rgba(0,0,0,.45) 48%,#000 68%)',
    top: 'linear-gradient(180deg,transparent 0,transparent 20%,rgba(0,0,0,.5) 40%,#000 62%)',
    bottom: 'linear-gradient(0deg,transparent 0,transparent 20%,rgba(0,0,0,.5) 40%,#000 62%)',
    center: 'radial-gradient(ellipse 50% 46% at 50% 50%,transparent 38%,rgba(0,0,0,.5) 68%,#000 100%)',
    edges: 'radial-gradient(ellipse 60% 58% at 50% 50%,#000 42%,rgba(0,0,0,.5) 72%,transparent 100%)'
  };
  const setMask = (node, f) => {
    const m = !f || f === 'none' ? '' : FADES[f] || (/gradient\(/.test(f) ? f : '');
    if (f && f !== 'none' && !m) console.warn('[FX] fade không hợp lệ:', f, '→ dùng left|right|top|bottom|center|edges|none');
    node.style.webkitMaskImage = node.style.maskImage = m;
  };

  // R / bộ trình chiếu vào lại slide: lõi gọi reset() NGAY trong lúc Deck chạy lại → tắt tức thì (chữ cũng về nhịp 0 tức thì).
  // Chỉ khi lùi nhịp (←) mới mờ dần. Đăng ký lúc nạp file → luôn chạy TRƯỚC móc onPlay của lõi (lõi móc khi FX.bind/FX.auto)
  let replaying = false;
  if (deck() && deck().onPlay) deck().onPlay(() => { replaying = true; Promise.resolve().then(() => { replaying = false; }); });

  // Khung chung của mọi hiệu ứng trong file: hộp .fx-amb (hiện dần), hoà trộn ở lớp chứa, tạm dừng khi slide ẩn
  function shell(el, ctx, D, cls) {
    const light = isLight();
    const box = document.createElement('div');
    box.className = 'fx-amb ' + cls; box.setAttribute('aria-hidden', 'true');
    box.style.setProperty('--fx-o', clamp(+D.opacity, 0, 1));
    setMask(box, D.fade);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(box);
    // Hoà trộn: lớp trang trí .fx-layer bị "cô lập" (contain:paint) → đặt lên chính lớp để hoà với ảnh nền.
    // Gắn lên phần tử nội dung (thẻ kính, khung SP) → đặt lên hộp hiệu ứng, hoà với nội dung thẻ, không đổi cách thẻ hiện
    const host = el.classList.contains('fx-layer') ? el : box, blend0 = host.style.mixBlendMode;
    const blend = D.blend === 'auto' ? D.autoBlend(light) : D.blend;
    if (blend && blend !== 'normal') host.style.mixBlendMode = blend;
    const S = { box, light, anims: [], dead: false, seed: (ctx.rand() * 4294967296) >>> 0 };
    let offT = 0;
    const fade = FX.reduced ? 0 : FX.ms('--dur-3', 1400, el);   // = thời gian hộp mờ đi (transition của .fx-amb)
    S.anim = (node, kf, opt) => { const a = node.animate(kf, opt); S.anims.push(a); return a; };
    S.kill = () => { clearTimeout(offT); offT = 0; S.anims.forEach(a => a.cancel()); S.anims = []; };
    S.show = () => { box.classList.remove('on'); void box.offsetWidth; box.classList.add('on'); };
    S.hide = () => box.classList.remove('on');
    // Lùi nhịp: hộp mờ đi trong khi hiệu ứng VẪN chạy; hết mờ mới huỷ animation (fn: dọn thêm, vd dừng vòng lặp).
    // Huỷ ngay thì lưới đang vẽ dở hiện đủ, vùng màu nhảy về chỗ cũ, vệt sáng hiện đứng — trong lúc đang mờ dần
    S.off = fn => {
      clearTimeout(offT);
      const done = () => { offT = 0; S.kill(); if (fn) fn(); };
      if (fade && !replaying) { S.hide(); offT = setTimeout(done, fade + 60); return; }
      box.style.transition = 'none'; S.hide(); void box.offsetWidth; box.style.transition = '';   // tắt ngay, không mờ dần
      done();
    };
    S.destroy = () => { S.dead = true; S.kill(); box.remove(); host.style.mixBlendMode = blend0; };
    const Dk = deck();                                    // deck.js v2: slide bị ẩn → dừng hẳn animation (đỡ tốn máy)
    if (Dk && typeof Dk.onHide === 'function') Dk.onHide(() => { if (!S.dead) S.anims.forEach(a => a.pause()); });
    return S;
  }

  // =====================================================================
  // FX.aurora — vùng màu mềm trôi chậm. Không vẽ lại từng khung: trình duyệt chỉ dịch/xoay lớp (GPU).
  // =====================================================================
  const AREAS = {
    edges: [[88, 16], [10, 90], [72, 96], [97, 58], [42, 2], [4, 34]],
    full: [[25, 25], [75, 30], [55, 75], [15, 70], [88, 82], [48, 45]],
    top: [[15, 6], [50, 0], [85, 8], [32, 14], [68, 12], [100, 2]],
    bottom: [[15, 96], [50, 102], [85, 94], [32, 88], [68, 90], [0, 100]],
    left: [[4, 20], [10, 62], [0, 96], [18, 40], [8, 82], [22, 6]],
    right: [[96, 20], [90, 62], [100, 96], [82, 40], [92, 82], [78, 6]],
    center: [[50, 50], [38, 42], [62, 58], [56, 38], [44, 62], [50, 30]]
  };
  FX.register('aurora', (el, o, ctx) => {
    const D = Object.assign({ count: 4, color: null, opacity: null, alpha: .5, area: 'edges', shape: 'field', size: 1, speed: 1,
      drift: 90, breathe: .3, blend: 'auto', fade: 'none', autoBlend: L => (L ? 'multiply' : 'screen') }, o);
    const S = shell(el, ctx, Object.assign({}, D, { opacity: D.opacity != null ? D.opacity : isLight() ? .45 : .6 }), 'fx-aur');
    const cols = colorsOr(D.color, S.light ? ['accent', 'accent-2'] : ['accent', 'accent-2', 'accent-hi'], 'aurora');
    if (Array.isArray(D.area)) D.area = pair(D.area, [50, 50], 'aurora area');
    else if (!AREAS[D.area]) { console.warn('[FX] aurora: area không có', D.area, '→ dùng "edges" (edges|full|top|bottom|left|right|center|[x,y])'); D.area = 'edges'; }
    for (const [k, d] of [['size', 1], ['drift', 90], ['breathe', .3], ['speed', 1]]) D[k] = num(D[k], d);
    let fields = [];

    function build() {
      S.box.textContent = ''; fields = [];
      const r = FX.rand(S.seed), W = el.offsetWidth || 1920, H = el.offsetHeight || 1080;
      const n = clamp(Math.round(num(D.count, 4)), 1, 6), ribbon = D.shape === 'ribbon', a = clamp(num(D.alpha, .5), 0, 1);
      const anchors = Array.isArray(D.area) ? null : AREAS[D.area].slice();
      for (let i = anchors ? anchors.length - 1 : 0; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [anchors[i], anchors[j]] = [anchors[j], anchors[i]]; }
      for (let i = 0; i < n; i++) {
        const [ax, ay] = anchors ? anchors[i % anchors.length] : [D.area[0] + (r() - .5) * 30, D.area[1] + (r() - .5) * 26];
        const w = W * (ribbon ? .85 + .35 * r() : .42 + .26 * r()) * D.size, h = H * (ribbon ? .16 + .1 * r() : .5 + .3 * r()) * D.size;
        const cx = W * (ax + (r() - .5) * 8) / 100, cy = H * (ay + (r() - .5) * 8) / 100;
        const [cr, cg, cb] = FX.color(cols[i % cols.length]), c = k => `rgba(${cr},${cg},${cb},${(a * k).toFixed(3)})`;
        const f = document.createElement('i');
        f.style.cssText = `width:${w.toFixed(0)}px;height:${h.toFixed(0)}px;left:${(cx - w / 2).toFixed(0)}px;top:${(cy - h / 2).toFixed(0)}px;` +
          `background:radial-gradient(closest-side,${c(1)} 0%,${c(.8)} 22%,${c(.5)} 44%,${c(.22)} 66%,${c(.06)} 85%,${c(0)} 100%)`;
        S.box.appendChild(f);
        const rot = ribbon ? -22 + 16 * r() : -30 + 60 * r();
        const m = D.drift, q = () => ((r() - .5) * 2 * m).toFixed(0);
        const T = (dx, dy, dr, sc, sk) => `translate(${dx}px,${dy}px) rotate(${(rot + dr).toFixed(1)}deg) skewX(${sk}deg) scale(${sc})`;
        const sk = () => (ribbon ? ((r() - .5) * 16).toFixed(1) : 0);
        fields.push({ f, base: T(0, 0, 0, 1, 0),
          kf: [{ transform: T(0, 0, 0, 1, 0) }, { transform: T(q(), q(), (r() - .5) * 14, (.92 + .2 * r()).toFixed(3), sk()) },
            { transform: T(q(), q(), (r() - .5) * 14, (.92 + .2 * r()).toFixed(3), sk()) }, { transform: T(0, 0, 0, 1, 0) }],
          dur: (24 + 22 * r()) * 1000, ph: r(), bdur: (8 + 7 * r()) * 1000, bph: r() });
      }
    }

    function start() {
      S.kill();
      const sp = Math.max(.05, ctx.speed * D.speed);
      for (const F of fields) {
        if (FX.reduced) { F.f.style.transform = F.kf[1].transform; continue; }   // giảm chuyển động: đứng yên ở thế đẹp
        S.anim(F.f, F.kf, { duration: F.dur / sp, iterations: Infinity, easing: 'ease-in-out', delay: -F.ph * F.dur / sp });
        if (D.breathe > 0) S.anim(F.f, [{ opacity: 1 }, { opacity: 1 - clamp(D.breathe, 0, .9) }, { opacity: 1 }],
          { duration: F.bdur / sp, iterations: Infinity, easing: 'ease-in-out', delay: -F.bph * F.bdur / sp });
      }
    }
    build();
    return {
      play() { if (!fields.length || fields[0].f.parentNode !== S.box) build(); start(); S.show(); },
      reset() { S.off(); },
      stop() { S.destroy(); }
    };
  });

  // =====================================================================
  // FX.sweep — vệt sáng quét chéo. mode "band": dải sáng qua cả lớp/thẻ · mode "text": ánh kim chạy trên mặt chữ
  // =====================================================================
  FX.register('sweep', (el, o, ctx) => {
    const L0 = isLight();
    // text: delay mặc định 2300 ms = sau khi 2 dòng tiêu đề (.line, trễ .8/.95s + 1,15s) đã hiện xong —
    // trong lúc dòng chữ còn đang trồi lên, Chrome cắt nền theo vị trí CUỐI của chữ → ánh kim sẽ lệch khỏi chữ
    const D = Object.assign({ mode: 'band', angle: 20, width: 320, color: null, alpha: null, opacity: 1, duration: 1700, every: 9000,
      delay: o.mode === 'text' ? 2300 : 1200,
      direction: 1, easing: 'cubic-bezier(.45,.05,.25,1)', blend: 'auto', fade: 'none',
      autoBlend: L => (o.mode === 'text' ? 'normal' : L ? 'soft-light' : 'screen') }, o);
    for (const [k, d] of [['angle', 20], ['width', 320], ['duration', 1700], ['every', 9000], ['delay', o.mode === 'text' ? 2300 : 1200], ['direction', 1]]) D[k] = num(D[k], d);
    const text = D.mode === 'text';
    const S = shell(el, ctx, D, 'fx-swp');
    const col = D.color || (text ? 'accent-hi' : L0 ? 'surface' : 'fg');   // chữ trắng + ánh trắng thì không thấy → chữ dùng màu nhấn
    const al = D.alpha != null ? +D.alpha : text ? (L0 ? .75 : .9) : L0 ? .55 : el.classList.contains('fx-layer') ? .26 : .4;   // trên thẻ: đậm hơn chút
    const [cr, cg, cb] = FX.color(col), c = k => `rgba(${cr},${cg},${cb},${clamp(al * k, 0, 1).toFixed(3)})`;
    let band = null, sheen = null;

    function build() {
      S.box.textContent = ''; if (sheen) sheen.remove(); sheen = band = null;
      if (text) {                                          // bản sao chữ trong suốt, nền là dải sáng cắt theo nét chữ
        S.box.style.display = 'none';
        sheen = document.createElement('span'); sheen.className = 'fx-sheen'; sheen.setAttribute('aria-hidden', 'true');
        el.childNodes.forEach(n => { if (n !== S.box) sheen.appendChild(n.cloneNode(true)); });
        sheen.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
        // bản sao không được tự khởi tạo hiệu ứng lần nữa (FX.auto sau này) — giữ data-step để ẩn/hiện cùng chữ gốc
        sheen.querySelectorAll('[data-fx],[data-fx-opts],[data-fx-step]').forEach(n => { n.removeAttribute('data-fx'); n.removeAttribute('data-fx-opts'); n.removeAttribute('data-fx-step'); });
        const cs = getComputedStyle(el);
        sheen.style.padding = cs.padding;
        // phần tử chữ dàn bằng flex/grid (vd "23,6 tỷ" căn đáy): bản sao phải dàn y hệt, không thì ánh kim lệch khỏi chữ
        const disp = { flex: 'flex', 'inline-flex': 'flex', grid: 'grid', 'inline-grid': 'grid' }[cs.display];
        if (disp) {
          sheen.style.display = disp;
          for (const k of ['flexDirection', 'flexWrap', 'alignItems', 'alignContent', 'justifyContent', 'justifyItems', 'rowGap', 'columnGap',
            'gridTemplateColumns', 'gridTemplateRows', 'gridAutoFlow', 'gridAutoColumns', 'gridAutoRows']) sheen.style[k] = cs[k];
        }
        // nền rộng 300%, dải sáng hẹp ở giữa → lúc nghỉ (0% / 100%) dải nằm HẲN ngoài chữ
        sheen.style.backgroundImage = `linear-gradient(${90 + D.angle}deg,transparent 0,transparent 44.5%,${c(.3)} 47.5%,${c(1)} 50%,${c(.3)} 52.5%,transparent 55.5%,transparent 100%)`;
        sheen.style.backgroundSize = '300% 100%'; sheen.style.backgroundPosition = '100% 0';
        el.appendChild(sheen);
        return;
      }
      const W = el.offsetWidth || 1920, H = el.offsetHeight || 1080, tan = Math.tan(D.angle * Math.PI / 180), bw = D.width;
      band = document.createElement('i');
      const bh = H * 1.25 + Math.abs(tan) * bw;
      band.style.cssText = `width:${bw}px;height:${bh.toFixed(0)}px;top:${((H - bh) / 2).toFixed(0)}px;` +
        `background:linear-gradient(90deg,transparent 0,${c(.12)} 22%,${c(.38)} 40%,${c(.8)} 48.5%,${c(1)} 50%,${c(.8)} 51.5%,${c(.38)} 60%,${c(.12)} 78%,transparent 100%)`;
      S.box.appendChild(band);
      const reach = Math.abs(tan) * bh / 2 + bw;
      band._x = [-reach, W + reach - bw].map(v => v.toFixed(0));
      // chỗ nghỉ = ngoài phần tử: giảm chuyển động / vừa huỷ animation / trước lần quét đầu → không có vệt đứng giữa hình
      band.style.transform = `translateX(${band._x[D.direction < 0 ? 1 : 0]}px) rotate(${D.angle}deg)`;
    }

    // bản sao chữ là khối định vị tuyệt đối → lề âm của con đầu (vd .mask) không "gộp" như bản gốc → đo và bù lệch
    function align() {
      sheen.style.transform = '';
      const a = [...el.children].find(n => n !== S.box && n !== sheen), b = sheen.firstElementChild;
      if (!a || !b) return;
      const k = (el.offsetWidth || 1) / (el.getBoundingClientRect().width || 1), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const dx = (ra.left - rb.left) * k, dy = (ra.top - rb.top) * k;
      if (Math.abs(dx) > .5 || Math.abs(dy) > .5) sheen.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    }

    function start() {
      S.kill();
      if (sheen) align();
      if (FX.reduced) return;                              // giảm chuyển động: không quét (trạng thái cuối = không có vệt)
      const dur = Math.max(200, D.duration / Math.max(.05, ctx.speed)), per = D.every > 0 ? Math.max(D.every, dur + 300) : dur;
      const opt = { duration: per, iterations: D.every > 0 ? Infinity : 1, delay: D.delay, fill: 'both' };
      const f = dur / per;
      if (text) {
        const [p0, p1] = D.direction < 0 ? ['0% 0', '100% 0'] : ['100% 0', '0% 0'];
        S.anim(sheen, [{ backgroundPosition: p0, easing: D.easing }, { backgroundPosition: p1, offset: f }, { backgroundPosition: p1 }], opt);
        return;
      }
      const [x0, x1] = D.direction < 0 ? [band._x[1], band._x[0]] : band._x, T = x => `translateX(${x}px) rotate(${D.angle}deg)`;
      S.anim(band, [{ transform: T(x0), easing: D.easing }, { transform: T(x1), offset: f }, { transform: T(x1) }], opt);
    }
    build();
    return {
      play() { if (!band && !sheen) build(); start(); S.show(); },
      reset() { if (sheen) S.kill(); else S.off(); },   // ánh kim trên chữ: tắt ngay (bản sao không nằm trong hộp mờ dần)
      stop() { S.destroy(); if (sheen) sheen.remove(); }
    };
  });

  // =====================================================================
  // FX.grid — lưới kỹ thuật tự vẽ (SVG nét đứt chạy) · style lines | cross | dots · mode flat | floor
  // =====================================================================
  FX.register('grid', (el, o, ctx) => {
    const D = Object.assign({ mode: 'flat', style: 'lines', cell: 40, major: 3, minor: true, offset: [0, 0], color: 'fg', majorColor: null,
      alpha: null, majorAlpha: null, opacity: 1, draw: true, duration: 1200, spread: 1000, origin: [0, 0], pulse: .35, period: 7000,
      labels: false, horizon: .58, tilt: 74, scroll: .35, fade: 'none', blend: 'normal', autoBlend: L => (L ? 'multiply' : 'screen') }, o);
    const S = shell(el, ctx, D, 'fx-grd');
    D.origin = pair(D.origin, [0, 0], 'grid origin'); D.offset = pair(D.offset, [0, 0], 'grid offset');
    for (const [k, d] of [['cell', 40], ['major', 3], ['duration', 1200], ['spread', 1000], ['pulse', .35], ['period', 7000],
      ['horizon', .58], ['tilt', 74], ['scroll', .35]]) D[k] = num(D[k], d);
    if (!['lines', 'cross', 'dots'].includes(D.style)) { console.warn('[FX] grid: style không có', D.style, '→ dùng "lines"'); D.style = 'lines'; }
    const la = D.alpha != null ? num(D.alpha, .08) : clamp(FX.num('--line-alpha', .16, el) * .6, .035, .13);
    const ma = D.majorAlpha != null ? num(D.majorAlpha, .2) : clamp(la * 2.3, .08, .3);
    const rgba = (n, a) => FX.rgba(n, +a.toFixed(3));
    const cMin = rgba(D.color, la), cMaj = rgba(D.majorColor || D.color, ma);
    let parts = null;

    function build() {
      S.box.textContent = '';
      const W = el.offsetWidth || 1920, H = el.offsetHeight || 1080;
      parts = { lines: [], marks: [], labels: [], minorSvg: null, majorSvg: null, plane: null, step: 0 };
      if (D.mode === 'floor') return buildFloor(W, H);
      const cell = Math.max(12, D.cell), maj = Math.max(0, D.major | 0);   // ô < 12px: thành nhiễu, và hàng nghìn nét SVG
      const ox = W * D.origin[0] / 100, oy = H * D.origin[1] / 100, far = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy)) || 1;
      const mk = () => svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, S.box);
      const sMin = parts.minorSvg = mk(), sMaj = parts.majorSvg = mk();
      const xs = [], ys = [];
      for (let k = Math.ceil(-D.offset[0] / cell); D.offset[0] + k * cell <= W + .5; k++) xs.push([D.offset[0] + k * cell, maj && k % maj === 0]);
      for (let k = Math.ceil(-D.offset[1] / cell); D.offset[1] + k * cell <= H + .5; k++) ys.push([D.offset[1] + k * cell, maj && k % maj === 0]);
      const px = v => Math.round(v) + .5;                   // nét 1px sắc
      if (D.style === 'lines') {
        const seg = (x1, y1, x2, y2, isMaj, dist) => {
          const len = Math.hypot(x2 - x1, y2 - y1); if (len < 1) return;
          if (!isMaj && !D.minor) return;
          const l = svg('line', { x1, y1, x2, y2, 'stroke-width': 1, style: `stroke:${isMaj ? cMaj : cMin}` }, isMaj ? sMaj : sMin);
          parts.lines.push({ l, len, at: D.spread * dist / far });
        };
        for (const [x, m] of xs) { const X = px(x), d = Math.abs(x - ox); if (oy > 0) seg(X, oy, X, 0, m, d); if (oy < H) seg(X, oy, X, H, m, d); }
        for (const [y, m] of ys) { const Y = px(y), d = Math.abs(y - oy); if (ox > 0) seg(ox, Y, 0, Y, m, d); if (ox < W) seg(ox, Y, W, Y, m, d); }
      } else {                                              // cross: dấu + ở giao điểm nét chính · dots: chấm ở mọi giao điểm
        let dMin = '', dMaj = '', dX = '';
        const nBig = xs.filter(q => q[1]).length * ys.filter(q => q[1]).length;
        const each = nBig <= 400;                             // nhiều dấu + quá → gộp thành 1 nét (không tạo hàng nghìn animation)
        for (const [x, mx] of xs) for (const [y, my] of ys) {
          const X = px(x), Y = px(y), big = mx && my;
          if (D.style === 'cross' && big) {
            const d = `M${X - 7} ${Y}H${X + 7}M${X} ${Y - 7}V${Y + 7}`;
            if (!each) { dX += d; continue; }
            const g = svg('path', { d, 'stroke-width': 1, style: `stroke:${cMaj}` }, sMaj);
            parts.marks.push({ g, at: D.spread * Math.hypot(x - ox, y - oy) / far });
          } else if (big) dMaj += `M${X} ${Y}h.01`;
          else if (D.minor) dMin += `M${X} ${Y}h.01`;
        }
        if (dMin) svg('path', { d: dMin, 'stroke-width': D.style === 'dots' ? 2.2 : 1.6, 'stroke-linecap': 'round', style: `stroke:${D.style === 'dots' ? cMaj : cMin}` }, sMin);
        if (dMaj) svg('path', { d: dMaj, 'stroke-width': 3.2, 'stroke-linecap': 'round', style: `stroke:${cMaj}` }, sMaj);
        if (dX) svg('path', { d: dX, 'stroke-width': 1, style: `stroke:${cMaj}` }, sMaj);
      }
      if (D.labels && maj && cell * maj >= 48) {            // nhãn toạ độ kiểu bản vẽ: 01 02 … theo cột, A B … theo hàng (nét chính thưa ≥ 48px)
        const font = `font:500 11px ${FX.prop('--mono') || 'monospace'};letter-spacing:.08em;fill:${rgba(D.majorColor || D.color, clamp(ma * 2.2, .3, .7))}`;
        const label = (x, y, txt) => { const t = svg('text', { x, y, style: font }, sMaj); t.textContent = txt; parts.labels.push(t); };
        let ci = 0, ri = 0;
        for (const [x, m] of xs) if (m && x > 8 && x < W - 30) label(x + 6, 18, String(++ci).padStart(2, '0'));
        for (const [y, m] of ys) if (m && y > 24 && y < H - 8) label(6, y - 6, String.fromCharCode(65 + (ri++ % 26)));
      }
    }

    function buildFloor(W, H) {                             // sàn phối cảnh: mặt phẳng nghiêng (CSS 3D) trôi về phía người xem
      const top = H * clamp(D.horizon, .1, .95), fh = H - top, step = Math.max(20, D.cell * Math.max(1, D.major));
      const tilt = clamp(D.tilt, 30, 86), per = 560, depth = per * .96 / Math.sin(tilt * Math.PI / 180);
      const fl = document.createElement('div'); fl.className = 'fl';
      fl.style.cssText = `top:${top}px;perspective:${per}px;perspective-origin:50% 0;` +
        '-webkit-mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.35) 14%,#000 60%);mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.35) 14%,#000 60%)';
      const pl = document.createElement('div'); pl.className = 'pl';
      const PW = W * 2, PH = Math.ceil(depth / step) * step + step;
      pl.style.cssText = `left:${-W / 2}px;width:${PW}px;height:${PH}px;transform:rotateX(${tilt}deg)`;
      const s = svg('svg', { width: PW, height: PH, viewBox: `0 0 ${PW} ${PH}` }, pl);
      let d = '';
      for (let x = (PW / 2) % step; x <= PW; x += step) d += `M${Math.round(x) + .5} 0V${PH}`;
      for (let y = 0; y <= PH; y += step) d += `M0 ${y + .5}H${PW}`;
      svg('path', { d, 'stroke-width': 1.2, style: `stroke:${cMaj}` }, s);
      fl.appendChild(pl); S.box.appendChild(fl);
      Object.assign(parts, { plane: pl, step, tilt, fh });
    }

    function start() {
      S.kill();
      const sp = Math.max(.05, ctx.speed);
      if (D.mode === 'floor') {
        const T = y => `rotateX(${parts.tilt}deg) translateY(${y}px)`;
        if (!FX.reduced && D.scroll > 0) S.anim(parts.plane, [{ transform: T(-parts.step) }, { transform: T(0) }],
          { duration: 1000 / (D.scroll * sp), iterations: Infinity, easing: 'linear' });
        return;
      }
      const draw = D.draw && !FX.reduced, dur = D.duration / sp;
      for (const L of parts.lines) {
        L.l.style.strokeDasharray = L.len.toFixed(1);
        if (draw) S.anim(L.l, [{ strokeDashoffset: L.len.toFixed(1) }, { strokeDashoffset: 0 }],
          { duration: dur, delay: L.at / sp, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'both' });
        else L.l.style.strokeDashoffset = 0;
      }
      for (const M of parts.marks) if (draw) S.anim(M.g, [{ opacity: 0 }, { opacity: 1 }], { duration: dur * .6, delay: M.at / sp, easing: 'ease-out', fill: 'both' });
      if (draw && !parts.lines.length && parts.minorSvg) {  // chấm: hiện dần + co nhẹ về gốc
        const tf = `${D.origin[0]}% ${D.origin[1]}%`;
        parts.minorSvg.style.transformOrigin = parts.majorSvg.style.transformOrigin = tf;
        for (const s of [parts.minorSvg, parts.majorSvg]) S.anim(s, [{ opacity: 0, transform: 'scale(1.04)' }, { opacity: 1, transform: 'none' }],
          { duration: dur * 1.4, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
      }
      const tEnd = (D.spread + D.duration) / sp;
      for (const t of parts.labels) if (draw) S.anim(t, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: tEnd * .6, fill: 'both' });
      if (D.pulse > 0 && !FX.reduced && parts.majorSvg) {   // nét chính "thở" rất chậm (chỉ đổi opacity → GPU)
        const lo = 1 - clamp(D.pulse, 0, .9);
        S.anim(parts.majorSvg, [{ opacity: 1 }, { opacity: lo }, { opacity: 1 }],
          { duration: D.period / sp, delay: tEnd, iterations: Infinity, easing: 'ease-in-out' });
      }
    }
    build();
    return {
      play() { if (!parts) build(); start(); S.show(); },
      reset() { S.off(); },
      stop() { S.destroy(); }
    };
  });

  // =====================================================================
  // FX.blob — khối hữu cơ biến hình. soft: canvas 1/4 độ phân giải + làm mờ (loang mềm, không mép cứng)
  //           contour: các đường đồng mức mảnh (sinh học số) · both: cả hai
  // =====================================================================
  FX.register('blob', (el, o, ctx) => {
    const L0 = isLight();
    const D = Object.assign({ style: 'soft', x: 70, y: 50, size: .27, wobble: .22, morph: 1, speed: 1, drift: 36, spin: 3,
      color: ['accent', 'accent-2'], opacity: null, count: null, rings: 7, gap: 18, lineWidth: 1.2,
      blur: 34, fade: 'none', blend: 'auto', autoBlend: L => (L ? 'multiply' : 'screen') }, o);
    const S = shell(el, ctx, Object.assign({}, D, { opacity: D.opacity != null ? D.opacity : L0 ? .35 : .55 }), 'fx-blb');
    const cols = colorsOr(D.color, ['accent', 'accent-2'], 'blob');
    if (!['soft', 'contour', 'both'].includes(D.style)) { console.warn('[FX] blob: style không có', D.style, '→ dùng "soft" (soft|contour|both)'); D.style = 'soft'; }
    for (const [k, d] of [['x', 70], ['y', 50], ['size', .27], ['wobble', .22], ['morph', 1], ['speed', 1], ['drift', 36], ['spin', 3],
      ['rings', 7], ['gap', 18], ['lineWidth', 1.2], ['blur', 34]]) D[k] = num(D[k], d);
    D.rings = clamp(D.rings | 0, 1, 24);                  // > 24 vòng: rối, và mỗi vòng là một đường cong vẽ lại mỗi khung
    const soft = D.style === 'soft' || D.style === 'both', cont = D.style === 'contour' || D.style === 'both';
    const cs = soft ? FX.canvas(S.box, { dpr: .25 }) : null;          // 1/4 độ phân giải: phóng to tự mềm, rất nhẹ máy
    const cc = cont ? FX.canvas(S.box, { dpr: D.dpr || 1.25 }) : null;               // nét mảnh: 1.25 đủ sắc, nhẹ GPU hơn 1.5
    let blobs = [], loop = null, fc = 0;

    function build() {
      const r = FX.rand(S.seed), c = cs || cc, W = c.w, H = c.h, base = D.size > 2 ? D.size : D.size * Math.min(W, H);
      const n = clamp((D.count != null ? D.count : cont ? 1 : 2) | 0, 1, 4);   // loang mềm: 2 khối chồng nhau trông hữu cơ hơn 1
      blobs = Array.from({ length: n }, (_, k) => {
        const c0 = FX.color(cols[k % cols.length]), c1 = FX.color(cols[(k + 1) % cols.length]);
        const an = r() * 6.283, dist = k ? base * (.55 + .3 * r()) : 0;   // khối phụ lệch chéo, chồng một phần lên khối chính
        return {
          x: W * D.x / 100 + Math.cos(an) * dist, y: H * D.y / 100 + Math.sin(an) * dist * .8,
          R: base * (k ? .5 + .25 * r() : 1), c0, c1,
          h: [2, 3, 5].map((n, i) => ({ n, a: [.55, .3, .15][i], p: r() * 6.283, w: (.35 + .3 * r()) * (r() < .5 ? -1 : 1) / (n * .6) })),
          dx: r() * 6.283, dy: r() * 6.283, fx: .03 + .03 * r(), fy: .025 + .03 * r(), rot: r() * 6.283,
          grad: [0, .5, 1].map(t => FX.mix(c0, c1, t))
        };
      });
    }
    // bán kính theo góc: tổng 3 sóng hài (2, 3, 5 múi) lệch pha theo thời gian → biến hình mềm, không lặp lộ
    function shape(g, b, s, scale, tOff) {
      const K = 30, pts = [], R = b.R * scale, rot = b.rot + D.spin * Math.PI / 180 * s;
      const cx = b.x + D.drift * Math.sin(b.fx * 6.283 * s + b.dx), cy = b.y + D.drift * .7 * Math.cos(b.fy * 6.283 * s + b.dy);
      for (let i = 0; i < K; i++) {
        const th = i / K * 6.283;
        let m = 0; for (const q of b.h) m += q.a * Math.sin(q.n * th + q.p + q.w * D.morph * (s + tOff));
        const rr = R * (1 + D.wobble * m);
        pts.push(cx + rr * Math.cos(th + rot), cy + rr * Math.sin(th + rot));
      }
      g.beginPath();                                        // đường cong khép kín qua trung điểm (mượt, không gãy)
      g.moveTo((pts[0] + pts[2 * K - 2]) / 2, (pts[1] + pts[2 * K - 1]) / 2);
      for (let i = 0; i < K; i++) {
        const j = (i + 1) % K;
        g.quadraticCurveTo(pts[2 * i], pts[2 * i + 1], (pts[2 * i] + pts[2 * j]) / 2, (pts[2 * i + 1] + pts[2 * j + 1]) / 2);
      }
      g.closePath();
      return [cx, cy, R];
    }
    const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1).toFixed(3)})`;
    function frame(t, dt) {
      if (dt && (++fc & 1)) return;                         // biến hình rất chậm → vẽ 30 khung/giây là đủ, đỡ nửa tải GPU
      const s = t / 1000 * ctx.speed * D.speed;
      if (cs) {
        const g = cs.ctx; cs.clear();
        g.filter = `blur(${Math.max(1, D.blur * cs.dpr).toFixed(1)}px)`;   // bán kính mờ tính theo điểm ảnh canvas (1/4)
        for (const b of blobs) {
          const [cx, cy, R] = shape(g, b, s, 1, 0);
          const gr = g.createRadialGradient(cx - R * .28, cy - R * .32, R * .05, cx, cy, R * 1.25);
          gr.addColorStop(0, rgb(b.grad[0], .95)); gr.addColorStop(.55, rgb(b.grad[1], .7)); gr.addColorStop(1, rgb(b.grad[2], .3));
          g.fillStyle = gr; g.fill();
        }
        g.filter = 'none';
      }
      if (cc) {
        const g = cc.ctx, n = Math.max(1, D.rings | 0); cc.clear(); g.lineWidth = D.lineWidth;
        for (const b of blobs) for (let i = 0; i < n; i++) {
          const k = n > 1 ? i / (n - 1) : 0, sc = Math.max(.05, 1 + (cont && soft ? .18 : 0) - i * D.gap / b.R);
          shape(g, b, s, sc, i * .9);
          g.strokeStyle = rgb(FX.mix(b.c0, b.c1, k), .75 - .5 * k); g.stroke();
        }
      }
    }
    const halt = () => { if (loop) loop.stop(); loop = null; };
    build();
    return {
      play() { S.kill(); halt(); build(); loop = FX.loop(frame); S.show(); },
      reset() { S.off(() => { halt(); if (cs) cs.clear(); if (cc) cc.clear(); }); },   // vẫn biến hình trong lúc mờ đi
      stop() { halt(); if (cs) cs.destroy(); if (cc) cc.destroy(); S.destroy(); }
    };
  });
})();
