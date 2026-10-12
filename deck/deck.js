/* =========================================================
   deck.js — phần dùng chung cho mọi slide (v2)
   - Co giãn sân khấu 1920×1080
   - Nạp nền: <body data-video="..." data-image="..."> (video trước, ảnh dự phòng)
   - Nhịp bấm ("nhịp nói"): phần tử data-step="1|2|3…" hiện ra ở lần bấm thứ 1, 2, 3… (thêm lớp "step-on")
     → / Space / bấm chuột: nhịp sau · ←: lùi một nhịp · hết nhịp mới sang slide sau
   - R chạy lại (về nhịp 0) · F toàn màn hình · <body data-autostep="2500"> tự tăng nhịp (kiosk)
   - Slide đăng ký phần chuyển động riêng bằng Deck.onPlay(fn), theo nhịp bằng Deck.onStep(fn)
   Hướng dẫn: references/design-system.md mục 6 · references/motion/steps.md
   ========================================================= */
const Deck = (() => {
  const stage = document.getElementById('stage');
  const body = document.body;
  const embedded = location.hash === '#embed';          // nằm trong bộ trình chiếu index.html
  const hooks = [], stepHooks = [], hideHooks = [];
  let timers = [], anims = [];
  let step = 0;                                          // nhịp hiện tại (0 = chưa hiện nhịp nào)
  let active = !embedded;                                // slide đang được chiếu? (mở lẻ: luôn đúng)
  const safe = (fn, ...a) => { try { fn(...a); } catch (e) { console.error('[Deck]', e); } };

  // Co giãn sân khấu vừa mọi màn hình
  const scale = () => Math.min(innerWidth / 1920, innerHeight / 1080);
  const fit = () => { stage.style.transform = `translate(-50%,-50%) scale(${scale()})`; };
  addEventListener('resize', fit); fit();

  // Nạp nền: thử lần lượt từng file, hết thì gọi onFail
  function tryLoad(el, srcs, readyEvt, flag, onFail){
    let i = 0;
    const next = () => { if (i < srcs.length) el.src = srcs[i++]; else if (onFail) onFail(); };
    el.addEventListener('error', next);
    el.addEventListener(readyEvt, () => {
      el.classList.add('ready'); body.classList.add('has-bg', flag);
      if (el.play) el.play().catch(() => {});
    });
    next();
  }
  const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
  const bgVid = document.getElementById('bgVid'), bgImg = document.getElementById('bgImg');
  const loadImage = () => bgImg && tryLoad(bgImg, list(body.dataset.image), 'load', 'has-img');
  if (bgVid && list(body.dataset.video).length) tryLoad(bgVid, list(body.dataset.video), 'loadeddata', 'has-vid', loadImage);
  else loadImage();

  // Chrome tạm dừng video khi tab bị ẩn → tự phát lại khi slide hiện ra (chỉ slide đang chiếu)
  const resumeVideo = () => { if (bgVid && bgVid.classList.contains('ready') && bgVid.paused) bgVid.play().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && active) resumeVideo(); });

  // Hẹn giờ / animation JS có theo dõi để huỷ sạch khi chạy lại
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const track = a => (anims.push(a), a);
  const clearAll = () => { timers.forEach(clearTimeout); timers = []; anims.forEach(a => safe(() => a.cancel())); anims = []; };

  // Đếm số: Deck.countTo(el, 0, 23689740, {delay, dur, fmt})
  const vnd = n => Math.round(n).toLocaleString('vi-VN');
  function countTo(el, from, to, { delay = 0, dur = 1400, fmt = n => Math.round(n) } = {}){
    const tok = el._tok = (el._tok || 0) + 1;
    el.textContent = fmt(from);
    later(() => {
      const t0 = performance.now();
      const tick = t => {
        if (el._tok !== tok) return;
        const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(from + (to - from) * e);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
  }

  // Gõ chữ từng ký tự từ mốc t0 (ms); trả về thời điểm gõ xong
  function type(el, text, t0, step = 55){
    el.textContent = '';
    [...text].forEach((ch, i) => later(() => { el.textContent += ch; }, t0 + i * step));
    return t0 + text.length * step;
  }

  // Toạ độ của một phần tử trong hệ 1920×1080 của sân khấu
  function toStage(el){
    const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect(), s = sr.width / 1920;
    return { x: (r.left - sr.left) / s, y: (r.top - sr.top) / s, w: r.width / s, h: r.height / s };
  }

  // ---------- Gửi tin lên bộ trình chiếu index.html (chỉ khi nằm trong nó) ----------
  const send = msg => { if (embedded) parent.postMessage(Object.assign({ deck: 1 }, msg), '*'); };

  // ---------- Nhịp bấm: data-step="k" (k ≥ 1) hiện khi nhịp hiện tại ≥ k ----------
  // data-step rỗng/0 = luôn hiện. Đếm lại mỗi lần cần → phần tử data-step do JS thêm sau vẫn được tính.
  const stepOf = el => parseInt(el.dataset.step, 10) || 0;
  const stepEls = () => document.querySelectorAll('[data-step]');
  function countSteps(){ let m = 0; for (const el of stepEls()) m = Math.max(m, stepOf(el)); return m; }
  function paint(n){ for (const el of stepEls()) el.classList.toggle('step-on', stepOf(el) <= n); }
  const report = () => send({ step, steps: countSteps() });

  // Tự tăng nhịp (kiosk): <body data-autostep="2500"> — bấm tay thì đếm lại từ đầu
  const autoMs = parseInt(body.dataset.autostep, 10) || 0;
  let autoT = 0;
  function armAuto(){
    clearTimeout(autoT); autoT = 0;
    if (autoMs > 0 && active && step < countSteps()) autoT = setTimeout(() => { autoT = 0; next(); }, autoMs);
  }

  function goStep(n){
    n = Math.max(0, Math.min(countSteps(), Math.round(+n) || 0));
    if (n === step) return false;
    const dir = n > step ? 1 : -1;
    step = n; paint(n);
    stepHooks.forEach(fn => safe(fn, n, dir));
    report(); armAuto();
    return true;
  }
  const next = () => step < countSteps() && goStep(step + 1);   // true = đã dùng một nhịp
  const prev = () => step > 0 && goStep(step - 1);               // true = đã lùi một nhịp

  // Chạy (lại) slide. play({end:true}) = vào theo chiều lùi → hiện sẵn mọi nhịp
  function play(o){
    const end = !!(o && o.end === true);
    clearAll();
    stage.classList.add('step-instant');                 // về nhịp 0 tức thì, không chạy chuyển tiếp ngược
    step = 0; paint(0);
    stage.classList.remove('play'); void stage.offsetWidth; stage.classList.add('play');
    stage.classList.remove('step-instant');
    if (end) { step = countSteps(); paint(step); }
    resumeVideo();
    hooks.forEach(fn => safe(fn));
    stepHooks.forEach(fn => safe(fn, step, 0));          // dir 0 = đặt lại nhịp khi slide chạy
    report(); armAuto();
  }

  // Bộ trình chiếu ẩn slide này: dừng hẹn giờ, video; vòng lặp hiệu ứng FX tự dừng theo Deck.active
  function hide(){
    active = false; early = null;
    clearTimeout(autoT); autoT = 0;
    clearAll();
    if (bgVid && !bgVid.paused) bgVid.pause();
    hideHooks.forEach(fn => safe(fn));
  }

  // Mọi thao tác điều khiển xếp hàng SAU lần chạy đang chờ (phím đến trước lệnh play thì không bị đặt lại mất)
  let pending = Promise.resolve();
  const queue = fn => { pending = pending.then(fn).catch(e => console.error('[Deck]', e)); };

  // Phím/bấm tới lúc slide CHƯA được chiếu (bộ trình chiếu vừa đổi sang, lệnh play còn trên đường tới):
  // không xử lý trên nhịp cũ của lần chiếu trước (dễ nhảy cóc slide) → giữ thao tác cuối, làm ngay sau khi slide chạy
  let early = null;

  // Tiến/lùi: dùng nhịp trước; hết nhịp → xin bộ trình chiếu đổi slide (mở lẻ thì thôi)
  function advance(dir, skip){
    if (embedded && !active) { early = [dir, skip]; return; }
    if (!skip && (dir > 0 ? next() : prev())) return;
    send({ nav: dir });
  }

  // Parallax nhẹ theo chuột: data-parallax="x,y" (số âm = lùi ra sau)
  const layers = [...document.querySelectorAll('[data-parallax]')].map(el => [el, el.dataset.parallax.split(',').map(Number)]);
  addEventListener('mousemove', e => {
    const nx = e.clientX / innerWidth * 2 - 1, ny = e.clientY / innerHeight * 2 - 1;
    for (const [el, [kx, ky]] of layers) el.style.transform = `translate(${nx * kx}px,${ny * ky}px)`;
  });

  const toggleFs = () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => {});
  };
  const NEXT = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'], PREV = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
  // Gõ/bấm vào ô nhập, link, hoặc phần tử có data-nonav → không chuyển nhịp/slide
  const noNav = t => !!(t && t.closest && t.closest('[data-nonav],a[href],input,select,textarea,[contenteditable]'));

  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || noNav(e.target)) return;
    const k = e.key;
    if (k === 'r' || k === 'R') return queue(() => play());
    if (k === 'f' || k === 'F') return embedded ? send({ fs: 1 }) : toggleFs();
    if (embedded && (k === 'Home' || k === 'End')) { e.preventDefault(); return send({ jump: k === 'Home' ? 0 : -1 }); }
    const dir = NEXT.includes(k) ? 1 : PREV.includes(k) ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    queue(() => advance(dir, e.shiftKey));               // Shift + mũi tên: bỏ qua nhịp, sang slide luôn
  });
  if (embedded) document.addEventListener('click', e => { if (!noNav(e.target)) queue(() => advance(1)); });
  else stage.addEventListener('click', e => { if (!noNav(e.target)) queue(() => { if (!next()) play(); }); });   // không còn nhịp → chạy lại như cũ

  // Chờ font tải xong (chữ tiếng Việt không nhảy) VÀ trang đọc xong (script riêng của slide đã kịp đăng ký Deck.onPlay), rồi chạy
  const domReady = new Promise(r => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r()));
  const fontsReady = Promise.all([domReady, Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))])]);
  const frame = () => new Promise(r => requestAnimationFrame(r));

  // Trong bộ trình chiếu (index.html nạp slide với #embed): slide chờ lệnh "play", báo số nhịp,
  // tự xử lý phím/bấm/vuốt theo nhịp; hết nhịp thì xin đổi slide bằng tin {nav: ±1}
  if (embedded) {
    addEventListener('message', e => {
      const d = e.data;
      if (!d || e.source !== parent) return;
      if (d.deck === 'play') {
        active = true;
        pending = pending.then(() => fontsReady).then(frame).then(() => {
          if (!active) return;
          play({ end: d.end === true });
          const q = early; early = null;
          if (q) advance(q[0], q[1]);                     // thao tác đến sớm (xem advance)
        }).catch(err => console.error('[Deck]', err));
      } else if (d.deck === 'key') queue(() => advance(d.dir < 0 ? -1 : 1, !!d.skip));
      else if (d.deck === 'hide') hide();
    });
    let tx = null, lastMove = 0;
    addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    addEventListener('touchend', e => {
      if (tx === null) return;
      const dx = e.changedTouches[0].clientX - tx; tx = null;
      if (Math.abs(dx) > 40) queue(() => advance(dx < 0 ? 1 : -1));
    }, { passive: true });
    addEventListener('mousemove', () => { const t = Date.now(); if (t - lastMove > 400) { lastMove = t; send({ move: 1 }); } });
    fontsReady.then(() => send({ ready: 1, v: 2, steps: countSteps() }));
  } else pending = fontsReady.then(frame).then(() => play());

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    stage, embedded, reduced,
    onPlay: fn => hooks.push(fn), onStep: fn => stepHooks.push(fn), onHide: fn => hideHooks.push(fn),
    later, track, countTo, vnd, type, toStage, play,
    next, prev, goStep,
    get active(){ return active; },                       // slide này đang được chiếu?
    get step(){ return step; },                           // nhịp hiện tại (0 = chưa hiện nhịp nào)
    get steps(){ return countSteps(); }                   // tổng số nhịp (data-step lớn nhất; 0 = không có)
  };
})();
