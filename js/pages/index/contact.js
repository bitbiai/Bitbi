/* ============================================================
   BITBI — Contact form handler
   ============================================================ */

export function initContact() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
            const res = await fetch('https://contact.bitbi.ai/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(10000),
                body: JSON.stringify({
                    name: form.name.value,
                    email: form.email.value,
                    subject: form.subject.value,
                    message: form.message.value,
                    website: form.website.value
                })
            });
            if (!res.ok) throw new Error('Failed');
            btn.textContent = 'Sent!';
            form.reset();
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
        } catch {
            btn.textContent = 'Error - try again';
            btn.disabled = false;
            setTimeout(() => { btn.textContent = orig; }, 3000);
        }
    });
}
