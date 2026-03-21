/* ============================================================
   BITBI — Experiments section: card rendering, synth, game overlays
   ============================================================ */

import { makeTags } from '../../shared/make-tags.js';

const TAG_COLORS = {
    WebGL: '0,240,255', AI: '192,38,211', 'Three.js': '255,179,0',
    Python: '0,240,255', WebXR: '255,179,0', 'A-Frame': '0,240,255',
    Canvas: '0,240,255', 'Audio API': '192,38,211'
};

export function initExperiments(revealObserver) {
    const grid = document.getElementById('experimentsGrid');
    if (!grid) return;

    /* Card 1: Cosmic VR */
    const vrCard = document.createElement('div');
    vrCard.className = 'tilt-card rounded-2xl overflow-hidden reveal';
    vrCard.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06)';
    vrCard.innerHTML = `<div style="height:180px;position:relative;overflow:hidden"><img src="/assets/images/1.jpg" alt="Cosmic Dreamscape" loading="lazy" decoding="async" width="600" height="180" style="width:100%;height:100%;object-fit:cover;display:block"><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.7),transparent)"></div></div><div style="padding:20px"><div style="display:flex;gap:6px;margin-bottom:10px">${makeTags(['WebXR', 'A-Frame'], TAG_COLORS)}</div><h3 style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:rgba(255,255,255,0.9);margin-bottom:8px">Cosmic Dreamscape VR</h3><p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.6;margin-bottom:14px">Immersive WebXR experience transforming space imagery into 3D worlds for Quest 3. Navigate cosmic spider webs and animated nebulae.</p><a href="experiments/cosmic.html" style="color:#00F0FF;font-size:11px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:4px">View Live <span style="font-size:14px">\u2192</span></a></div>`;
    grid.appendChild(vrCard);

    /* Card 2: Sound & Color — synth */
    const klangCard = document.createElement('div');
    klangCard.className = 'tilt-card rounded-2xl overflow-hidden reveal';
    klangCard.id = 'klangCard';
    klangCard.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:all 0.5s cubic-bezier(0.23,1,0.32,1)';
    klangCard.innerHTML = `<div id="klangPreview" style="height:180px;background:rgba(10,14,18,0.9);position:relative;overflow:hidden"><canvas id="sinePreviewCanvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.5),transparent)"></div></div><div style="padding:20px"><div style="display:flex;gap:6px;margin-bottom:10px">${makeTags(['Audio API', 'Canvas'], TAG_COLORS)}</div><h3 style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:rgba(255,255,255,0.9);margin-bottom:8px">Sound & Color</h3><p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.6;margin-bottom:14px">Interactive audiovisual synth \u2014 click to play notes, each key triggers a unique tone with real-time waveform visualization. Keyboard keys A\u2013K supported.</p><span id="klangToggle" style="color:#00F0FF;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;cursor:pointer">Open Synth <span style="font-size:14px">\u2192</span></span></div><div id="klangSynth" style="display:none;padding:0 20px 24px 20px"></div>`;
    grid.appendChild(klangCard);

    initSynth(klangCard);
    initSinePreview();

    /* Card 3: Sky Fall */
    const sfCard = document.createElement('div');
    sfCard.className = 'tilt-card rounded-2xl overflow-hidden reveal';
    sfCard.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:all 0.5s cubic-bezier(0.23,1,0.32,1)';
    sfCard.innerHTML = `<div style="height:180px;background:radial-gradient(ellipse at center,#0d1b3e,#050a15);position:relative;overflow:hidden"><canvas id="sfPreviewCanvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.6),transparent)"></div></div><div style="padding:20px"><div style="display:flex;gap:6px;margin-bottom:10px">${makeTags(['Canvas', 'Audio API'], TAG_COLORS)}</div><h3 style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:rgba(255,255,255,0.9);margin-bottom:8px">Sky Fall</h3><p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.6;margin-bottom:14px">Tilt your device to dodge clouds as a falling gear. Procedural music, gyro controls, and endless descent \u2014 how long can you survive?</p><span style="color:#00F0FF;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;cursor:pointer">Play Game <span style="font-size:14px">\u2192</span></span></div>`;
    grid.appendChild(sfCard);

    initGameOverlay(sfCard, 'sfOverlay', 'sfFrame', 'sfClose', 'experiments/skyfall.html', '#050a15', 'sfPreviewCanvas', initSfPreview);

    /* Card 4: The Gate */
    const gateCard = document.createElement('div');
    gateCard.className = 'tilt-card rounded-2xl overflow-hidden reveal';
    gateCard.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:all 0.5s cubic-bezier(0.23,1,0.32,1)';
    gateCard.innerHTML = `<div style="height:180px;background:radial-gradient(ellipse at center,#1a0f05,#060302);position:relative;overflow:hidden"><canvas id="gatePreviewCanvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.6),transparent)"></div></div><div style="padding:20px"><div style="display:flex;gap:6px;margin-bottom:10px">${makeTags(['Three.js', 'Canvas'], TAG_COLORS)}</div><h3 style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:rgba(255,255,255,0.9);margin-bottom:8px">The Gate</h3><p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.6;margin-bottom:14px">A dark knight approaches a gothic gate. Solve the riddle to open the doors and step into the light. 3D cinematic puzzle experience.</p><span style="color:#d4a857;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;cursor:pointer">Enter Gate <span style="font-size:14px">\u2192</span></span></div>`;
    grid.appendChild(gateCard);

    initGameOverlay(gateCard, 'gateOverlay', 'gateFrame', 'gateClose', 'experiments/king.html', '#000', 'gatePreviewCanvas', initGatePreview, true);

    if (revealObserver) {
        grid.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
    }

    initMobileDeck(grid);
}

/* ── Synth Engine ── */
function initSynth(klangCard) {
    let synthReady = false;
    let expanded = false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;

    function ensureAudio() {
        if (!audioCtx) audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    const notes = [
        { name: 'C', freq: 261.63, color: '#1a6b7a' },
        { name: 'D', freq: 293.66, color: '#1e7d8f' },
        { name: 'E', freq: 329.63, color: '#2a9bb0' },
        { name: 'F', freq: 349.23, color: '#3dd4f0' },
        { name: 'G', freq: 392.00, color: '#d4a853' },
        { name: 'A', freq: 440.00, color: '#c49340' },
        { name: 'B', freq: 493.88, color: '#f0d48a' },
        { name: 'C\u2082', freq: 523.25, color: '#e8c86a' },
    ];

    const VIZ_LEN = 200;
    const vizData = Array.from({ length: VIZ_LEN }, () => 0);
    let vizAnim = null, vizCanvas = null, vizCtx = null;

    function drawViz() {
        if (!vizCanvas) return;
        const pw = vizCanvas.parentElement.clientWidth;
        const ph = vizCanvas.parentElement.clientHeight;
        if (vizCanvas.width !== pw || vizCanvas.height !== ph) { vizCanvas.width = pw; vizCanvas.height = ph; }
        const w = vizCanvas.width, h = vizCanvas.height;
        vizCtx.fillStyle = 'rgba(10,14,18,0.15)';
        vizCtx.fillRect(0, 0, w, h);
        vizCtx.beginPath();
        const sl = w / VIZ_LEN;
        let x = 0;
        for (let i = 0; i < VIZ_LEN; i++) {
            const y = h / 2 + vizData[i] * h * 0.4;
            if (i === 0) vizCtx.moveTo(x, y); else vizCtx.lineTo(x, y);
            x += sl;
            vizData[i] *= 0.96;
        }
        vizCtx.strokeStyle = 'rgba(61,212,240,0.6)';
        vizCtx.lineWidth = 2;
        vizCtx.stroke();
        vizCtx.beginPath();
        x = 0;
        for (let i = 0; i < VIZ_LEN; i++) {
            const y = h / 2 + vizData[i] * h * 0.4;
            if (i === 0) vizCtx.moveTo(x, y); else vizCtx.lineTo(x, y);
            x += sl;
        }
        vizCtx.strokeStyle = 'rgba(212,168,83,0.25)';
        vizCtx.lineWidth = 6;
        vizCtx.filter = 'blur(4px)';
        vizCtx.stroke();
        vizCtx.filter = 'none';
        vizCtx.beginPath();
        vizCtx.moveTo(0, h / 2);
        vizCtx.lineTo(w, h / 2);
        vizCtx.strokeStyle = 'rgba(42,155,176,0.1)';
        vizCtx.lineWidth = 1;
        vizCtx.stroke();
        vizAnim = requestAnimationFrame(drawViz);
    }

    function playNote(freq, idx) {
        ensureAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);
        const phase = idx / notes.length;
        for (let i = 0; i < VIZ_LEN; i++) vizData[i] += Math.sin((i / VIZ_LEN) * Math.PI * (2 + phase * 6)) * 0.5;
    }

    function buildSynth() {
        if (synthReady) return;
        synthReady = true;
        const wrap = document.getElementById('klangSynth');
        wrap.innerHTML = `<div style="width:100%;height:120px;border-radius:14px;overflow:hidden;border:1px solid rgba(42,155,176,0.15);background:rgba(10,14,18,0.8);margin-bottom:16px"><canvas id="klangViz" style="width:100%;height:100%;display:block"></canvas></div><p style="color:rgba(255,255,255,0.3);font-size:10px;text-align:center;margin-bottom:10px;font-family:'JetBrains Mono',monospace">Click pads or press A S D F G H J K</p><div id="klangKeys" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center"></div>`;
        vizCanvas = document.getElementById('klangViz');
        vizCtx = vizCanvas.getContext('2d');
        drawViz();
        const keysEl = document.getElementById('klangKeys');
        notes.forEach((note, idx) => {
            const key = document.createElement('div');
            key.style.cssText = `width:64px;height:64px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:0.75rem;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;transition:all 0.2s;background:linear-gradient(145deg,${note.color}22,${note.color}44);border:1px solid ${note.color}55;color:${note.color}`;
            key.textContent = note.name;
            key.dataset.idx = idx;
            key.setAttribute('role', 'button');
            key.setAttribute('aria-label', `Play note ${note.name}`);
            key.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                playNote(note.freq, idx);
                key.style.background = `linear-gradient(145deg,${note.color}66,${note.color}88)`;
                key.style.boxShadow = `0 0 25px ${note.color}44`;
                key.style.transform = 'scale(0.92)';
                setTimeout(() => {
                    key.style.background = `linear-gradient(145deg,${note.color}22,${note.color}44)`;
                    key.style.boxShadow = 'none';
                    key.style.transform = '';
                }, 300);
            });
            keysEl.appendChild(key);
        });
    }

    document.addEventListener('keydown', (e) => {
        if (!synthReady || !expanded) return;
        const map = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7 };
        const idx = map[e.key.toLowerCase()];
        if (idx !== undefined && !e.repeat) {
            const note = notes[idx];
            playNote(note.freq, idx);
            const key = document.getElementById('klangKeys')?.children[idx];
            if (key) {
                key.style.background = `linear-gradient(145deg,${note.color}66,${note.color}88)`;
                key.style.boxShadow = `0 0 25px ${note.color}44`;
                key.style.transform = 'scale(0.92)';
                setTimeout(() => {
                    key.style.background = `linear-gradient(145deg,${note.color}22,${note.color}44)`;
                    key.style.boxShadow = 'none';
                    key.style.transform = '';
                }, 300);
            }
        }
    });

    function collapseKlang() {
        expanded = false;
        const synth = document.getElementById('klangSynth');
        const toggle = document.getElementById('klangToggle');
        const preview = document.getElementById('klangPreview');
        synth.style.display = 'none';
        preview.style.height = '180px';
        klangCard.style.borderColor = 'rgba(255,255,255,0.06)';
        klangCard.style.boxShadow = 'none';
        klangCard.style.cursor = 'pointer';
        toggle.innerHTML = 'Open Synth <span style="font-size:14px">\u2192</span>';
        if (vizAnim) { cancelAnimationFrame(vizAnim); vizAnim = null; }
        initSinePreview();
    }

    function expandKlang() {
        expanded = true;
        buildSynth();
        const synth = document.getElementById('klangSynth');
        const toggle = document.getElementById('klangToggle');
        const preview = document.getElementById('klangPreview');
        synth.style.display = 'block';
        preview.style.height = '0px';
        preview.style.overflow = 'hidden';
        preview.style.transition = 'height 0.4s ease';
        klangCard.style.borderColor = 'rgba(42,155,176,0.25)';
        klangCard.style.boxShadow = '0 0 40px rgba(26,107,122,0.12)';
        klangCard.style.cursor = 'default';
        toggle.innerHTML = 'Close Synth <span style="font-size:14px">\u2715</span>';
        cancelSinePreview();
        if (vizCanvas && vizCtx) {
            if (vizAnim) { cancelAnimationFrame(vizAnim); vizAnim = null; }
            requestAnimationFrame(() => drawViz());
        }
    }

    klangCard.addEventListener('click', () => {
        if (expanded) return;
        expandKlang();
    });

    document.addEventListener('click', (e) => {
        const tog = e.target.closest('#klangToggle');
        if (tog && expanded) { e.stopPropagation(); collapseKlang(); }
    });
}

/* ── Sine Wave Preview ── */
let sineAnim = null;
let sineActive = false;

function initSinePreview() {
    sineActive = true;
    if (!sineAnim) drawSineFrame();
}

function cancelSinePreview() {
    sineActive = false;
    if (sineAnim) { cancelAnimationFrame(sineAnim); sineAnim = null; }
}

function drawSineFrame() {
    const c = document.getElementById('sinePreviewCanvas');
    if (!c) return;
    const pw = c.parentElement.clientWidth;
    const ph = c.parentElement.clientHeight;
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const cx = c.getContext('2d'), w = c.width, h = c.height, t = performance.now() * 0.001;
    cx.clearRect(0, 0, w, h);
    const waves = [
        { freq: 1.5, amp: 0.25, color: 'rgba(61,212,240,0.5)', lw: 2, speed: 1.2 },
        { freq: 2.2, amp: 0.18, color: 'rgba(212,168,83,0.4)', lw: 2, speed: 0.8 },
        { freq: 3.0, amp: 0.12, color: 'rgba(42,155,176,0.35)', lw: 1.5, speed: 1.6 },
        { freq: 0.8, amp: 0.3, color: 'rgba(240,212,138,0.25)', lw: 3, speed: 0.5 },
        { freq: 4.0, amp: 0.08, color: 'rgba(192,38,211,0.3)', lw: 1, speed: 2.0 },
    ];
    waves.forEach(wv => {
        cx.beginPath();
        for (let x = 0; x <= w; x++) {
            const nx = x / w;
            const y = h / 2 + Math.sin(nx * Math.PI * 2 * wv.freq + t * wv.speed) * h * wv.amp;
            if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        cx.strokeStyle = wv.color;
        cx.lineWidth = wv.lw;
        cx.stroke();
    });
    cx.beginPath();
    cx.moveTo(0, h / 2);
    cx.lineTo(w, h / 2);
    cx.strokeStyle = 'rgba(42,155,176,0.08)';
    cx.lineWidth = 1;
    cx.stroke();
    sineAnim = (sineActive && !document.hidden) ? requestAnimationFrame(drawSineFrame) : null;
}

/* ── Sky Fall Preview ── */
const sfParticles = [];
for (let i = 0; i < 35; i++) sfParticles.push({ x: Math.random(), y: Math.random(), s: Math.random() * 2 + 0.5, sp: Math.random() * 0.4 + 0.2 });
let sfPreviewAnim = null;

function initSfPreview() {
    if (sfPreviewAnim) return;
    drawSfFrame();
}

function drawSfFrame() {
    const c = document.getElementById('sfPreviewCanvas');
    if (!c) return;
    const pw = c.parentElement.clientWidth;
    const ph = c.parentElement.clientHeight;
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const cx = c.getContext('2d'), w = c.width, h = c.height, t = performance.now() * 0.001;
    cx.clearRect(0, 0, w, h);
    sfParticles.forEach(p => {
        p.y += p.sp * 0.003;
        if (p.y > 1) p.y = 0;
        const twinkle = 0.3 + 0.7 * Math.sin(t * p.sp * 2 + p.x * 10);
        cx.globalAlpha = twinkle * 0.6;
        cx.fillStyle = p.sp > 0.35 ? 'rgba(100,180,255,0.8)' : 'rgba(255,200,100,0.6)';
        cx.beginPath();
        cx.arc(p.x * w, p.y * h, p.s, 0, Math.PI * 2);
        cx.fill();
    });
    cx.globalAlpha = 0.15;
    cx.strokeStyle = 'rgba(150,200,255,0.5)';
    cx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
        const lx = ((t * 0.1 + i * 0.17) % 1) * w;
        const ly = ((t * 0.3 + i * 0.13) % 1) * h;
        cx.beginPath();
        cx.moveTo(lx, ly);
        cx.lineTo(lx, ly + 12 + Math.random() * 8);
        cx.stroke();
    }
    cx.globalAlpha = 1;
    sfPreviewAnim = document.hidden ? null : requestAnimationFrame(drawSfFrame);
}

/* ── Gate Preview ── */
const gateParticles = [];
for (let i = 0; i < 25; i++) gateParticles.push({ x: Math.random(), y: Math.random(), s: Math.random() * 1.5 + 0.5, sp: Math.random() * 0.3 + 0.1, drift: Math.random() * Math.PI * 2 });
let gatePreviewAnim = null;

function initGatePreview() {
    if (gatePreviewAnim) return;
    drawGateFrame();
}

function drawGateFrame() {
    const c = document.getElementById('gatePreviewCanvas');
    if (!c) return;
    const pw = c.parentElement.clientWidth;
    const ph = c.parentElement.clientHeight;
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const cx = c.getContext('2d'), w = c.width, h = c.height, t = performance.now() * 0.001;
    cx.clearRect(0, 0, w, h);
    const glowL = cx.createRadialGradient(w * 0.2, h * 0.35, 0, w * 0.2, h * 0.35, w * 0.25);
    glowL.addColorStop(0, 'rgba(212,168,87,' + (.15 + Math.sin(t * 6) * .05) + ')');
    glowL.addColorStop(1, 'transparent');
    cx.fillStyle = glowL;
    cx.fillRect(0, 0, w, h);
    const glowR = cx.createRadialGradient(w * 0.8, h * 0.35, 0, w * 0.8, h * 0.35, w * 0.25);
    glowR.addColorStop(0, 'rgba(212,168,87,' + (.12 + Math.sin(t * 7 + 1) * .05) + ')');
    glowR.addColorStop(1, 'transparent');
    cx.fillStyle = glowR;
    cx.fillRect(0, 0, w, h);
    cx.fillStyle = 'rgba(20,12,5,0.7)';
    cx.beginPath();
    cx.moveTo(w * 0.35, h);
    cx.lineTo(w * 0.35, h * 0.3);
    cx.quadraticCurveTo(w * 0.5, h * 0.05, w * 0.65, h * 0.3);
    cx.lineTo(w * 0.65, h);
    cx.closePath();
    cx.fill();
    cx.fillStyle = 'rgba(255,248,220,' + (.04 + Math.sin(t * 2) * .02) + ')';
    cx.fillRect(w * 0.49, h * 0.25, w * 0.02, h * 0.75);
    gateParticles.forEach(p => {
        p.y -= p.sp * 0.002;
        if (p.y < 0) p.y = 1;
        const px = p.x * w + Math.sin(t * 0.5 + p.drift) * 8;
        const twinkle = 0.2 + 0.5 * Math.sin(t * p.sp * 3 + p.drift);
        cx.globalAlpha = twinkle * 0.5;
        cx.fillStyle = 'rgba(212,168,87,0.7)';
        cx.beginPath();
        cx.arc(px, p.y * h, p.s, 0, Math.PI * 2);
        cx.fill();
    });
    cx.globalAlpha = 1;
    gatePreviewAnim = document.hidden ? null : requestAnimationFrame(drawGateFrame);
}

/* Resume paused preview loops when tab becomes visible */
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        if (sineActive && !sineAnim) drawSineFrame();
        if (!sfPreviewAnim && document.getElementById('sfPreviewCanvas')) drawSfFrame();
        if (!gatePreviewAnim && document.getElementById('gatePreviewCanvas')) drawGateFrame();
    }
});

/* ── Game Overlay Factory ── */
function initGameOverlay(card, overlayId, frameId, closeId, src, bg, previewCanvasId, previewInit, warmStyle = false) {
    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'game-overlay';
    overlay.style.background = bg;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${src.replace('.html', '')} game`);
    const closeClass = warmStyle ? 'game-overlay__close game-overlay__close--warm' : 'game-overlay__close game-overlay__close--light';
    overlay.innerHTML = `<div class="game-overlay__close-wrap"><button id="${closeId}" class="${closeClass}">\u2715 CLOSE</button></div><iframe id="${frameId}" src="" class="game-overlay__frame" allow="accelerometer;gyroscope" title="${src.replace('.html', '')} game"></iframe>`;
    document.body.appendChild(overlay);

    let isOpen = false;

    previewInit();

    card.addEventListener('click', () => {
        if (isOpen) return;
        isOpen = true;
        overlay.style.display = 'flex';
        document.getElementById(frameId).src = src;
        document.body.style.overflow = 'hidden';
    });

    document.getElementById(closeId).addEventListener('click', () => {
        isOpen = false;
        document.getElementById(frameId).src = '';
        overlay.style.display = 'none';
        document.body.style.overflow = '';
        previewInit();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) document.getElementById(closeId).click();
    });
}

/* ── Mobile Deck Carousel ── */
function initMobileDeck(grid) {
    const mql = window.matchMedia('(max-width: 639px)');
    let active = 0;
    let isDeck = false;
    let dotsEl = null;
    let swipeLock = false;

    function getCards() { return Array.from(grid.children); }

    function layout(skipAnim) {
        const all = getCards();
        const n = all.length;
        all.forEach((c, i) => {
            const d = i - active;
            c.style.transition = skipAnim ? 'none' : '';
            if (d === 0) {
                c.style.transform = 'scale(1)';
                c.style.opacity = '1';
                c.style.zIndex = String(n);
                c.style.pointerEvents = '';
            } else if (d === 1) {
                c.style.transform = 'translateX(16px) scale(0.95)';
                c.style.opacity = '0.5';
                c.style.zIndex = String(n - 1);
                c.style.pointerEvents = 'none';
            } else if (d === 2) {
                c.style.transform = 'translateX(30px) scale(0.90)';
                c.style.opacity = '0.25';
                c.style.zIndex = String(n - 2);
                c.style.pointerEvents = 'none';
            } else {
                c.style.transform = d < 0 ? 'translateX(-30px) scale(0.90)' : 'translateX(38px) scale(0.87)';
                c.style.opacity = '0';
                c.style.zIndex = '0';
                c.style.pointerEvents = 'none';
            }
        });
    }

    function buildDots() {
        if (dotsEl) dotsEl.remove();
        const all = getCards();
        dotsEl = document.createElement('div');
        dotsEl.className = 'exp-deck-dots';
        dotsEl.setAttribute('role', 'tablist');
        dotsEl.setAttribute('aria-label', 'Experiment cards');
        all.forEach((_, i) => {
            const d = document.createElement('button');
            d.className = 'exp-deck-dot' + (i === active ? ' active' : '');
            d.setAttribute('role', 'tab');
            d.setAttribute('aria-selected', i === active ? 'true' : 'false');
            d.setAttribute('aria-label', `Show card ${i + 1}`);
            d.addEventListener('click', () => { active = i; layout(); syncDots(); });
            dotsEl.appendChild(d);
        });
        grid.after(dotsEl);
    }

    function syncDots() {
        if (!dotsEl) return;
        const dots = dotsEl.querySelectorAll('.exp-deck-dot');
        const all = getCards();
        if (dots.length !== all.length) { buildDots(); return; }
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === active);
            d.setAttribute('aria-selected', i === active ? 'true' : 'false');
        });
    }

    function engage() {
        if (isDeck) return;
        isDeck = true;
        active = 0;
        grid.classList.add('exp-deck');
        layout(true);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                getCards().forEach(c => { c.style.transition = ''; });
            });
        });
        buildDots();
    }

    function disengage() {
        if (!isDeck) return;
        isDeck = false;
        grid.classList.remove('exp-deck');
        getCards().forEach(c => {
            c.style.transform = '';
            c.style.opacity = '';
            c.style.zIndex = '';
            c.style.pointerEvents = '';
            c.style.transition = '';
        });
        if (dotsEl) { dotsEl.remove(); dotsEl = null; }
    }

    /* Touch handling */
    let sx, sy, st, tracking, decided, horiz;

    grid.addEventListener('touchstart', e => {
        if (!isDeck) return;
        if (e.target.closest('#klangSynth')) return;
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; st = Date.now();
        tracking = true; decided = false; horiz = false;
        swipeLock = false;
        const c = getCards()[active];
        if (c) c.style.transition = 'none';
    }, { passive: true });

    grid.addEventListener('touchmove', e => {
        if (!tracking || !isDeck) return;
        const t = e.touches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            decided = true;
            horiz = Math.abs(dx) > Math.abs(dy);
            if (!horiz) {
                tracking = false;
                const c = getCards()[active];
                if (c) c.style.transition = '';
                return;
            }
        }
        if (horiz) {
            e.preventDefault();
            const c = getCards()[active];
            if (c) {
                let adj = dx;
                const all = getCards();
                if ((active === 0 && dx > 0) || (active >= all.length - 1 && dx < 0)) adj *= 0.25;
                c.style.transform = `translateX(${adj}px) scale(1)`;
            }
        }
    }, { passive: false });

    grid.addEventListener('touchend', e => {
        if (!tracking || !isDeck) return;
        tracking = false;
        if (!horiz || !decided) {
            layout();
            return;
        }
        const dx = e.changedTouches[0].clientX - sx;
        const v = Math.abs(dx) / Math.max(Date.now() - st, 1);
        const all = getCards();
        if ((Math.abs(dx) > 40 || v > 0.3) && Math.abs(dx) > 15) {
            swipeLock = true;
            if (dx < 0 && active < all.length - 1) active++;
            else if (dx > 0 && active > 0) active--;
        }
        layout();
        syncDots();
    }, { passive: true });

    grid.addEventListener('touchcancel', () => {
        if (!tracking || !isDeck) return;
        tracking = false;
        layout();
    }, { passive: true });

    /* Block click after swipe */
    grid.addEventListener('click', e => {
        if (swipeLock) { e.stopPropagation(); e.preventDefault(); swipeLock = false; }
    }, true);

    /* Watch for dynamically added cards (locked sections) */
    new MutationObserver(() => {
        if (isDeck) {
            layout(true);
            syncDots();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(c => { c.style.transition = ''; });
                });
            });
        }
    }).observe(grid, { childList: true });

    /* Responsive */
    mql.addEventListener('change', e => {
        if (e.matches) engage();
        else disengage();
    });

    if (mql.matches) engage();
}
