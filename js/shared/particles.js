/* ============================================================
   BITBI — Hero Canvas Particles
   Configurable for index (more particles, connections) and
   legal pages (fewer particles, no connections).
   ============================================================ */

export function initParticles(canvasId, options = {}) {
    const maxParticles = options.maxParticles ?? 60;
    const particleDensity = options.particleDensity ?? 20000;
    const nebulaCount = options.nebulaCount ?? 4;
    const showConnections = options.showConnections ?? false;
    const connectionDistance = options.connectionDistance ?? 280;

    const c = document.getElementById(canvasId);
    if (!c) return;
    const ctx = c.getContext('2d');
    let W, H;

    /* Prefer ResizeObserver over window resize */
    function resize() {
        W = c.width = c.parentElement.offsetWidth;
        H = c.height = c.parentElement.offsetHeight;
    }
    resize();

    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => resize());
        ro.observe(c.parentElement);
    } else {
        window.addEventListener('resize', resize);
    }

    /* Respect prefers-reduced-motion */
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const ps = [];
    const PC = Math.min(maxParticles, Math.floor(W * H / particleDensity));

    class P {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * W;
            this.y = Math.random() * H;
            this.vx = (Math.random() - 0.5) * 0.25;
            this.vy = (Math.random() - 0.5) * 0.25;
            this.r = Math.random() * 1.8 + 0.4;
            this.life = Math.random();
            this.cy = Math.random() > 0.45;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.life -= 0.0008;
            if (this.x < 0 || this.x > W || this.y < 0 || this.y > H || this.life <= 0) this.reset();
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fillStyle = this.cy
                ? `rgba(0,240,255,${this.life * 0.35})`
                : `rgba(255,179,0,${this.life * 0.3})`;
            ctx.fill();
        }
    }

    class N {
        constructor() {
            this.x = Math.random() * W;
            this.y = Math.random() * H;
            this.br = Math.random() * 3 + 2;
            this.ph = Math.random() * 6.28;
            this.sp = Math.random() * 0.008 + 0.004;
            const cs = ['0,240,255', '255,179,0', '192,38,211'];
            this.col = cs[Math.floor(Math.random() * 3)];
        }
        update(t) {
            this.r = this.br + Math.sin(t * this.sp + this.ph) * 1.5;
        }
        draw() {
            const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 7);
            g.addColorStop(0, `rgba(${this.col},.25)`);
            g.addColorStop(1, `rgba(${this.col},0)`);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 7, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${this.col},.5)`;
            ctx.fill();
        }
    }

    for (let i = 0; i < PC; i++) ps.push(new P());
    const ns = [];
    for (let i = 0; i < nebulaCount; i++) ns.push(new N());

    /* Draw single static frame if reduced motion */
    if (prefersReducedMotion) {
        ctx.clearRect(0, 0, W, H);
        ps.forEach((p) => { p.draw(); });
        ns.forEach((n) => { n.r = n.br; n.draw(); });
        return;
    }

    let t = 0;
    (function loop() {
        t++;
        ctx.clearRect(0, 0, W, H);
        ps.forEach((p) => { p.update(); p.draw(); });
        ns.forEach((n) => { n.update(t); n.draw(); });

        if (showConnections) {
            for (let i = 0; i < ns.length; i++) {
                for (let j = i + 1; j < ns.length; j++) {
                    const dx = ns[i].x - ns[j].x;
                    const dy = ns[i].y - ns[j].y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < connectionDistance) {
                        ctx.beginPath();
                        ctx.moveTo(ns[i].x, ns[i].y);
                        ctx.lineTo(ns[j].x, ns[j].y);
                        ctx.strokeStyle = `rgba(0,240,255,${(1 - d / connectionDistance) * 0.06})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
        }

        requestAnimationFrame(loop);
    })();
}
