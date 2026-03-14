/* ============================================================
   BITBI — Gallery rendering, filtering, modal with focus trap
   ============================================================ */

const items = [
    { t: 'The Letter B Goes Interstellar', c: 'A glowing glass letter B floats in deep space, orbited by rings of binary code and neon data streams \u2014 because even the alphabet deserves its own solar system.', cat: 'pictures', img: '/assets/images/100.JPG' },
    { t: 'Coral Reef Nightmare Buddy', c: 'A chubby blue-and-purple blob creature with mismatched googly eyes, an open mouth full of confusion, and way too many orange tentacles \u2014 sitting on a mossy rock like it owns the place.', cat: 'creepy', img: '/assets/images/101.JPG' },
    { t: 'The Friendliest Virus You Ever Saw', c: 'A round, spiky, ice-blue germ ball with three shiny black eyes and a massive toothy grin, floating in a teal abyss surrounded by its equally cheerful germ friends. Disturbingly adorable.', cat: 'creepy', img: '/assets/images/102.JPG' },
    { t: 'Angry Ant from Hell', c: 'A massive red ant-like beast with glowing crimson eyes, gnarly fangs, and twitching antennae perches on a mossy branch in a jungle \u2014 looking personally offended that you exist.', cat: 'creepy', img: '/assets/images/103.JPG' },
    { t: 'Swamp Thing\u2019s Ugly Cousin', c: 'A slimy green amphibious monstrosity crawls out of murky swamp water with fangs bared and reddish tentacles dangling from its mouth. Looks like it just ate something it regrets.', cat: 'creepy', img: '/assets/images/104.JPG' },
    { t: 'Mossgirl Stares Into Your Soul', c: 'Close-up portrait of a face half-consumed by green moss and twisted branches, with piercing icy blue eyes peering out. She is judging you, and you deserve it.', cat: 'creepy', img: '/assets/images/105.JPG' },
    { t: 'Monday Morning Demon', c: 'A grey-skinned, red-eyed demon with massive curved horns and a permanent scowl sits among dead tree branches wearing a button-up shirt. Corporate evil has never looked this literal.', cat: 'creepy', img: '/assets/images/106.JPG' },
    { t: 'Entomologist\u2019s Fever Dream', c: 'A furry blue moth-creature with red eyes and fangs stands center stage, surrounded by dozens of meticulously arranged bizarre insects, spiders, and spiky orbs on a teal background \u2014 like a natural history museum designed by a madman.', cat: 'creepy', img: '/assets/images/107.JPG' },
    { t: 'Planetary Meltdown in Green', c: 'A massive green planet crumbles apart in a blinding explosion of sparks, flying rocks, and cosmic debris \u2014 captured in that split second where everything goes spectacularly wrong.', cat: 'experimental', img: '/assets/images/108.JPG' },
];

let focusTrapCleanup = null;

export function initGallery() {
    const grid = document.getElementById('galleryGrid');
    const modal = document.getElementById('galleryModal');
    if (!grid || !modal) return;

    function render(filter) {
        /* Preserve exclusive cards injected by locked-sections.js */
        const exclusiveCards = Array.from(grid.querySelectorAll('.locked-area.gallery-item'));
        exclusiveCards.forEach(card => card.remove());

        grid.innerHTML = '';

        /* "exclusive" filter: show only the exclusive cards, no regular items */
        if (filter === 'exclusive') {
            exclusiveCards.forEach(card => grid.appendChild(card));
            return;
        }

        /* Exclusive cards only visible in exclusive view, hidden for all other filters */
        exclusiveCards.forEach(card => {
            card.style.display = 'none';
            grid.appendChild(card);
        });

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

    /* Listen for exclusive filter from locked-sections.js */
    grid.addEventListener('gallery:filter', (e) => {
        render(e.detail);
    });

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

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => window.closeModal());

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
