(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('c'), intro = $('intro'), hud = $('hud'), toastEl = $('toast'), msg = $('msg');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- tuning ----------
  const L = 0.8, PERIOD = 8192;
  const V_MIN = 4, V_MAX = 46, V_START = 13, ACCEL = 11;
  const K_MAX = 0.03;                       // strongest bend
  const DEAD_STEER = 3, MAX_STEER = 28;     // degrees of tilt
  const DEAD_PITCH = 4, MAX_PITCH = 26;

  // ---------- WebGL ----------
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { msg.textContent = 'This browser cannot draw the slide (WebGL2 is missing). Update iOS and try again.'; $('start').disabled = true; return; }
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, window.SLIDE_VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, window.SLIDE_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ['uRes', 'uTime', 'uBase', 'uFrac', 'uSpeed', 'uRoll', 'uYaw', 'uSkyPitch', 'uK', 'uCam', 'uLook']
    .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  let scale = Math.min(window.devicePixelRatio || 1, 1.5);   // lowered automatically if frames run slow
  function resize() {
    const w = Math.max(1, Math.round(canvas.clientWidth * scale)), h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }

  // ---------- sideways mode ----------
  // iOS will not let a page force landscape. When a touch device is upright (for example with
  // rotation lock on), draw everything turned 90 degrees so it is ridden sideways anyway.
  const stage = $('stage');
  const coarse = matchMedia('(pointer: coarse)').matches;
  let rot = 0;             // 0 = normal, 90 / -90 = drawn turned (device-rotation angle it matches)
  let rotPick = 90;        // which way to turn; set from gravity at Start
  let manual = null;       // set by the turn button: 0, 90 or -90. null = automatic
  function layout() {
    const w = innerWidth, h = innerHeight;
    rot = manual !== null ? manual : (coarse && h > w) ? rotPick : 0;
    document.documentElement.classList.toggle('rot', rot !== 0);
    if (!rot) { stage.style.width = '100%'; stage.style.height = '100%'; stage.style.transform = 'none'; return; }
    stage.style.width = h + 'px'; stage.style.height = w + 'px';
    stage.style.transform = rot === 90 ? 'translateX(' + w + 'px) rotate(90deg)' : 'translateY(' + h + 'px) rotate(-90deg)';
  }
  addEventListener('resize', layout);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', layout);
  layout();

  // ---------- state ----------
  const S = { running: false, speed: V_START, dist: 290, steer: 0, pitch: 0, yaw: 0, time: 0, tilt: false, input: 'none' };
  window.__slide = S;

  // ---------- input: tilt ----------
  const tilt = { x: 0, y: 0, live: false, zero: null, raw: null };
  let invX = false, invY = false;
  try { invX = localStorage.getItem('slide.invx') === '1'; invY = localStorage.getItem('slide.invy') === '1'; } catch (e) {}
  $('invx').checked = invX; $('invy').checked = invY;
  $('invx').onchange = (e) => { invX = e.target.checked; try { localStorage.setItem('slide.invx', invX ? '1' : '0'); } catch (x) {} };
  $('invy').onchange = (e) => { invY = e.target.checked; try { localStorage.setItem('slide.invy', invY ? '1' : '0'); } catch (x) {} };

  function screenAngle() {
    if (typeof window.orientation === 'number') return window.orientation;
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return 0;
  }
  function onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null || g.z == null) return;
    if (rot && manual === null && !tilt.zero) {
      // Work out which long edge is down so the picture is drawn the right way up.
      const sgn = Math.abs(g.z) > 2 ? (g.z > 0 ? -1 : 1) : 1;
      const pick = g.x * sgn < 0 ? 90 : -90;
      if (pick !== rotPick && Math.abs(g.x) > 3) { rotPick = pick; layout(); }
    }
    const th = (rot || screenAngle()) * Math.PI / 180;
    let sx = g.x * Math.cos(th) - g.y * Math.sin(th);
    let sy = g.x * Math.sin(th) + g.y * Math.cos(th);
    let sz = g.z;
    const n = Math.hypot(sx, sy, sz);
    if (n < 1) return;
    sx /= n; sy /= n; sz /= n;
    // Low-pass the raw vector to take out hand shake.
    if (!tilt.raw) tilt.raw = [sx, sy, sz];
    else { tilt.raw[0] += (sx - tilt.raw[0]) * 0.25; tilt.raw[1] += (sy - tilt.raw[1]) * 0.25; tilt.raw[2] += (sz - tilt.raw[2]) * 0.25; }
    if (!tilt.zero) {
      // Browsers disagree on the sign of this reading. The screen is never facing the floor
      // while someone is looking at it, so use that to pick the sign, then remember neutral.
      const sign = (tilt.raw[1] + tilt.raw[2]) > 0 ? -1 : 1;
      const z = angles(tilt.raw, sign);
      tilt.zero = { sign, steer: z.steer, pitch: z.pitch };
    }
    const a = angles(tilt.raw, tilt.zero.sign);
    let ds = (a.steer - tilt.zero.steer) * 180 / Math.PI;
    let dp = a.pitch - tilt.zero.pitch;
    dp = Math.atan2(Math.sin(dp), Math.cos(dp)) * 180 / Math.PI;
    tilt.x = shape(ds, DEAD_STEER, MAX_STEER) * (invX ? -1 : 1);
    tilt.y = shape(dp, DEAD_PITCH, MAX_PITCH) * (invY ? -1 : 1);
    tilt.live = true; S.tilt = true;
  }
  // Gravity direction in screen axes (x right, y up, z toward the viewer).
  function angles(v, sign) {
    const gx = v[0] * sign, gy = v[1] * sign, gz = v[2] * sign;
    return { steer: Math.asin(clamp(gx, -1, 1)), pitch: Math.atan2(-gz, -gy) };
  }
  function shape(deg, dead, max) {
    const m = Math.abs(deg);
    if (m <= dead) return 0;
    return Math.sign(deg) * clamp((m - dead) / (max - dead), 0, 1);
  }
  function recenter() { tilt.zero = null; toast(tilt.live ? 'Re-centered' : 'Tilt is not active on this device'); }

  // ---------- input: touch drag and keys ----------
  const ptr = { down: false, id: null, x0: 0, y0: 0, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    if (ptr.down) return;
    ptr.down = true; ptr.id = e.pointerId; ptr.x0 = e.clientX; ptr.y0 = e.clientY; ptr.x = 0; ptr.y = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptr.down || e.pointerId !== ptr.id) return;
    let dx = e.clientX - ptr.x0, dy = e.clientY - ptr.y0;
    if (rot === 90) { const t = dx; dx = dy; dy = -t; } else if (rot === -90) { const t = dx; dx = -dy; dy = t; }
    ptr.x = clamp(dx / (stage.clientWidth * 0.22), -1, 1);
    ptr.y = clamp(-dy / (stage.clientHeight * 0.28), -1, 1);
  });
  const up = (e) => { if (e.pointerId === ptr.id) { ptr.down = false; ptr.x = ptr.y = 0; } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  ['touchmove', 'gesturestart', 'contextmenu'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));

  const keys = {};
  const KEYMAP = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'f', ArrowDown: 'b', a: 'l', d: 'r', w: 'f', s: 'b' };
  addEventListener('keydown', (e) => { const k = KEYMAP[e.key]; if (k) { keys[k] = true; e.preventDefault(); } if (e.key === 'm') toggleMute(); });
  addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });

  function readInput() {
    if (ptr.down) { S.input = 'touch'; return [ptr.x, ptr.y]; }
    const kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), ky = (keys.f ? 1 : 0) - (keys.b ? 1 : 0);
    if (kx || ky) { S.input = 'keys'; return [kx, ky]; }
    if (tilt.live) { S.input = 'tilt'; return [tilt.x, tilt.y]; }
    S.input = 'none'; return [0, 0];
  }

  // ---------- UI ----------
  let toastTimer = 0;
  function toast(text, ms) {
    toastEl.textContent = text; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2600);
  }
  function toggleMute() {
    SlideAudio.setMuted(!SlideAudio.muted);
    $('muteIcon').setAttribute('d', SlideAudio.muted ? 'M15.5 9.5l5 5M20.5 9.5l-5 5' : 'M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11');
  }
  $('mute').onclick = toggleMute;
  // Pause: freezes the ride and the sound; the same button resumes.
  function setPaused(p) {
    if (!S.started) return;
    S.running = !p;
    $('paused').hidden = !p;
    $('pauseIcon').setAttribute('d', p ? 'M8 5l11 7-11 7z' : 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z');
    $('pause').setAttribute('aria-label', p ? 'Resume' : 'Pause');
    SlideAudio.pause(p);
    if (!p) keepAwake();
    lastT = 0;
  }
  $('pause').onclick = () => setPaused(S.running);
  $('recenter').onclick = recenter;
  // Turn button: each tap turns the picture a quarter turn, then re-centers tilt for the new grip.
  $('turn').onclick = () => {
    const order = [0, 90, -90];
    manual = order[(order.indexOf(rot) + 1) % 3];
    layout();
    tilt.zero = null;
    toast(manual === 0 ? 'View: upright' : 'View: turned sideways. Hold it how you want, then tap re-center.');
  };

  const root = document.documentElement;
  const reqFS = root.requestFullscreen || root.webkitRequestFullscreen;
  const standalone = navigator.standalone === true || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  if (reqFS && !standalone && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    $('fs').hidden = false;
    $('fs').onclick = () => {
      const el = document.fullscreenElement || document.webkitFullscreenElement;
      if (el) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const p = reqFS.call(root); if (p && p.catch) p.catch(() => toast('Full screen is not available here')); }
    };
  }

  let wake = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState !== 'visible';
    SlideAudio.pause(hidden || !S.running);
    if (!hidden && S.running) keepAwake();
    lastT = 0;
  });

  async function start() {
    let denied = false;
    // iOS only allows these two requests from inside a tap.
    try {
      if (window.SLIDE_NO_TILT) { /* host blocks motion sensors */ }
      else if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') denied = true;
      }
    } catch (e) { denied = true; }
    if (!denied && !window.SLIDE_NO_TILT) addEventListener('devicemotion', onMotion);
    SlideAudio.init();
    keepAwake();
    tilt.zero = null;
    intro.hidden = true; S.running = true; S.started = true; $('pause').hidden = false;
    if (window.SLIDE_NO_TILT) toast('Drag on the screen to steer: up to dive and speed up, down to climb and slow down.', 7000);
    else if (denied) toast('Tilt was not allowed. Drag on the screen to steer. To turn tilt on, reload the page, tap Start, then Allow.', 9000);
    else setTimeout(() => { if (S.running && !tilt.live) toast('No tilt sensor found. Drag on the screen or use the arrow keys.', 6000); }, 1500);
  }
  $('start').onclick = start;

  // ---------- main loop ----------
  let lastT = 0, slow = 0, frames = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016;
    if (lastT && S.running) {
      // Drop resolution a step if the device cannot hold the frame rate.
      frames++; if (t - lastT > 24) slow++;
      if (frames >= 90) { if (slow > 45 && scale > 0.6) scale = Math.max(0.6, scale * 0.8); frames = slow = 0; }
    }
    lastT = t;
    resize();

    const inp = S.running ? readInput() : [0, 0];
    const ease = 1 - Math.exp(-dt * 5);
    S.steer += (inp[0] - S.steer) * ease;
    S.pitch += (inp[1] - S.pitch) * ease;
    if (S.running) S.speed = clamp(S.speed + inp[1] * ACCEL * dt, V_MIN, V_MAX);
    const v = S.running ? S.speed : S.started ? 0 : 6;   // slow drift behind the start screen, still when paused
    S.dist += v * dt;
    if (S.running || !S.started) S.time += dt;
    const kx = S.steer * K_MAX, ky = -S.pitch * K_MAX;
    S.yaw += 2 * kx * v * dt;

    const rings = S.dist / L, base = Math.floor(rings);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, S.time % 3600);
    gl.uniform1f(U.uBase, base % PERIOD);
    gl.uniform1f(U.uFrac, (rings - base) * L);
    gl.uniform1f(U.uSpeed, v);
    gl.uniform1f(U.uRoll, S.steer * 0.2);
    gl.uniform1f(U.uYaw, S.yaw % (Math.PI * 2));
    gl.uniform1f(U.uSkyPitch, -S.pitch * 0.25);
    gl.uniform2f(U.uK, kx, ky);
    gl.uniform2f(U.uCam, -S.steer * 0.22, -0.5);
    gl.uniform2f(U.uLook, kx * 7, ky * 7 + 0.06);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (S.running) SlideAudio.setSpeed((S.speed - V_MIN) / (V_MAX - V_MIN));
  }
  requestAnimationFrame(frame);
})();
