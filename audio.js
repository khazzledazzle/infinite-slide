// All sound is generated in the browser: a wind whoosh that follows speed,
// plus slow evolving pad chords and sparse bell notes.
window.SlideAudio = (function () {
  let ctx = null, master, musicBus, whooshGain, whooshFilter, hissGain, padFilter, delay;
  let muted = false, timer = null;
  let nextChord = 0, nextNote = 0, chordIdx = 0, melodyPos = 2;

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // D major family. Each chord: bass note, then pad voicing.
  const CHORDS = [
    { bass: 38, notes: [57, 62, 66, 69, 73] },  // Dmaj7
    { bass: 35, notes: [57, 59, 62, 66, 69] },  // Bm7
    { bass: 43, notes: [55, 59, 62, 66, 69] },  // Gmaj7
    { bass: 45, notes: [57, 61, 64, 66, 71] },  // A6/9
    { bass: 42, notes: [57, 61, 64, 66, 69] },  // F#m7
    { bass: 40, notes: [55, 59, 62, 66, 71] },  // Em9
  ];
  const NEXT = [[1, 2, 4], [2, 5, 0], [0, 3, 5], [0, 1, 4], [1, 2], [3, 0, 2]];
  const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86];  // D major pentatonic

  function init() {
    if (ctx) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(comp).connect(ctx.destination);

    // Whoosh: looped noise through a band-pass that opens with speed.
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.6 + w * 0.4; data[i] = last * 1.6; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    whooshFilter = ctx.createBiquadFilter(); whooshFilter.type = 'bandpass'; whooshFilter.Q.value = 0.7;
    whooshGain = ctx.createGain(); whooshGain.gain.value = 0;
    const hissFilter = ctx.createBiquadFilter(); hissFilter.type = 'highpass'; hissFilter.frequency.value = 3500;
    hissGain = ctx.createGain(); hissGain.gain.value = 0;
    noise.connect(whooshFilter).connect(whooshGain).connect(master);
    noise.connect(hissFilter).connect(hissGain).connect(master);
    noise.start();

    // Music bus with a soft echo.
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55;
    padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900; padFilter.Q.value = 0.5;
    delay = ctx.createDelay(1.5); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
    delay.connect(dlp).connect(fb).connect(delay);
    dlp.connect(wet).connect(musicBus);
    padFilter.connect(musicBus);
    musicBus.connect(master);

    nextChord = ctx.currentTime + 0.1;
    nextNote = ctx.currentTime + 3;
    timer = setInterval(schedule, 200);
  }

  function voice(dest, type, freq, t, attack, hold, release, peak, detune) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune || 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + attack + hold + release + 0.1);
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const horizon = ctx.currentTime + 0.6;
    while (nextChord < horizon) {
      const c = CHORDS[chordIdx], dur = 9 + Math.random() * 4;
      c.notes.forEach((n, i) => {
        if (Math.random() < 0.15) return;                       // leave notes out now and then
        const f = midi(n + (Math.random() < 0.2 ? 12 : 0));
        voice(padFilter, 'sawtooth', f, nextChord + i * 0.3, 3.5, dur - 4, 5.5, 0.030, -7);
        voice(padFilter, 'triangle', f, nextChord + i * 0.3, 3.5, dur - 4, 5.5, 0.045, 6);
      });
      voice(musicBus, 'sine', midi(c.bass), nextChord, 2.5, dur - 3, 4, 0.16, 0);
      const opts = NEXT[chordIdx];
      chordIdx = opts[Math.floor(Math.random() * opts.length)];
      nextChord += dur;
    }
    while (nextNote < horizon) {
      melodyPos += Math.floor(Math.random() * 5) - 2;
      melodyPos = Math.max(0, Math.min(SCALE.length - 1, melodyPos));
      const f = midi(SCALE[melodyPos]), g = 0.05 + Math.random() * 0.04;
      [musicBus, delay].forEach((dst) => {
        voice(dst, 'sine', f, nextNote, 0.02, 0.05, 2.2, g, 0);
        voice(dst, 'triangle', f * 2, nextNote, 0.01, 0.02, 0.9, g * 0.25, 3);
      });
      const r = Math.random();
      nextNote += r < 0.25 ? 0.42 : r < 0.6 ? 0.84 : r < 0.85 ? 1.68 : 3.4 + Math.random() * 3;
    }
  }

  // n: speed from 0 (floor) to 1 (ceiling).
  function setSpeed(n) {
    if (!ctx) return;
    const t = ctx.currentTime;
    whooshFilter.frequency.setTargetAtTime(200 + n * 900, t, 0.12);
    whooshGain.gain.setTargetAtTime(0.008 + n * n * 0.07, t, 0.12);
    hissGain.gain.setTargetAtTime(n * n * n * 0.006, t, 0.12);
    padFilter.frequency.setTargetAtTime(750 + n * 900, t, 0.5);
  }
  function setMuted(m) {
    muted = m;
    if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
  }
  function pause(p) { if (ctx) (p ? ctx.suspend() : ctx.resume()); }
  return { init, setSpeed, setMuted, pause, get muted() { return muted; }, get state() { return ctx ? ctx.state : 'none'; } };
})();
