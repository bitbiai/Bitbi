/* ============================================================
   BITBI — Gallery rendering, filtering, modal with focus trap
   ============================================================ */

const items = [
    { t: 'Digital Horizons', c: 'A vast digital landscape where light and shadow converge \u2014 neural networks painting horizons that exist only in silicon dreams.', cat: 'pictures', img: '/assets/images/100.JPG' },
    { t: 'Ethereal Bloom', c: 'Organic forms emerge from algorithmic chaos. Generative petals unfold in a dance between mathematics and nature.', cat: 'pictures', img: '/assets/images/101.JPG' },
    { t: 'Neon Reverie', c: 'Luminous abstractions pulse with electric energy \u2014 the visual echo of data streams flowing through hidden layers.', cat: 'pictures', img: '/assets/images/102.JPG' },
    { t: 'Synthetic Aurora', c: 'Chromatic waves ripple across a synthetic sky. AI reimagines the northern lights as pure digital poetry.', cat: 'pictures', img: '/assets/images/103.JPG' },
    { t: 'Phantom Architecture', c: 'Impossible structures materialize from latent space \u2014 buildings that defy physics, rendered in crystalline detail.', cat: 'pictures', img: '/assets/images/104.JPG' },
    { t: 'Quantum Garden', c: 'A surreal garden where fractal flowers bloom in quantum superposition. Every petal holds infinite variations.', cat: 'pictures', img: '/assets/images/105.JPG' },
    { t: 'Chrome Solitude', c: 'A solitary figure rendered in liquid chrome reflects distorted worlds. Portrait of consciousness in the machine age.', cat: 'pictures', img: '/assets/images/106.JPG' },
    { t: 'Prismatic Depths', c: 'Deep-sea visions reimagined through diffusion models. Bioluminescent creatures swim through oceans of noise.', cat: 'pictures', img: '/assets/images/107.JPG' },
    { t: 'Celestial Drift', c: 'Cosmic formations born from generative adversarial networks \u2014 nebulae and star fields that never existed, yet feel profoundly real.', cat: 'pictures', img: '/assets/images/108.JPG' },
];

let focusTrapCleanup = null;

export function initGallery() {
    const grid = document.getElementById('galleryGrid');
    const modal = document.getElementById('galleryModal');
    if (!grid || !modal) return;

    function render(filter) {
        grid.innerHTML = '';
        const list = filter === 'all' ? items : items.filter(i => i.cat === filter);
        list.forEach((item) => {
            const d = document.createElement('div');
            d.className = 'gallery-item';
            d.innerHTML = `<div class="gallery-inner rounded-xl overflow-hidden relative" style="border:1px solid rgba(255,255,255,0.04)"><img src="${item.img}" alt="${item.t}" loading="lazy" decoding="async" style="width:100%;display:block;object-fit:cover"><div class="gallery-overlay" style="position:absolute;inset:0;display:flex;align-items:flex-end;padding:20px"><div><h4 style="font-family:'Playfair Display',serif;font-weight:700;font-size:14px;color:rgba(255,255,255,0.9)">${item.t}</h4><p style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;text-transform:capitalize">${item.cat}</p><span style="display:inline-block;margin-top:6px;font-size:10px;font-family:'JetBrains Mono',monospace;color:#00F0FF">View Full \u2192</span></div></div></div>`;
            d.addEventListener('click', () => openModal(item));
            grid.appendChild(d);
        });
    }

    render('all');

    /* Filter buttons with keyboard navigation */
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach((btn, idx) => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(x => {
                x.classList.remove('active');
                x.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            render(btn.dataset.filter);
        });

        btn.addEventListener('keydown', (e) => {
            let target = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                target = filterBtns[(idx + 1) % filterBtns.length];
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                target = filterBtns[(idx - 1 + filterBtns.length) % filterBtns.length];
            }
            if (target) {
                e.preventDefault();
                target.focus();
                target.click();
            }
        });
    });

    function openModal(item) {
        const mi = document.getElementById('modalImage');
        mi.style.background = '#0D1B2A';
        mi.innerHTML = `<img src="${item.img}" alt="${item.t}" style="width:100%;height:100%;object-fit:contain;display:block">`;
        document.getElementById('modalTitle').textContent = item.t;
        document.getElementById('modalCaption').textContent = item.c;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setupFocusTrap(modal);
    }

    window.closeModal = function () {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
    };

    modal.addEventListener('click', (e) => {
        if (e.target === modal) window.closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) window.closeModal();
    });
}

function setupFocusTrap(container) {
    const focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    function handler(e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
        } else {
            if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
    }

    container.addEventListener('keydown', handler);
    focusTrapCleanup = () => container.removeEventListener('keydown', handler);
}
