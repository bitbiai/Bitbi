export function createTextElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text == null || text === '' ? '\u2014' : String(text);
    return el;
}

export function createBadge(text, variant = 'user') {
    const span = createTextElement('span', `badge badge--${variant}`, text || '\u2014');
    return span;
}

export function createActionBtn(label, onClick, danger, options = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-action' + (danger ? ' btn-action--danger' : '');
    btn.textContent = label;
    if (options.title) btn.title = options.title;
    if (options.disabled) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
    }
    btn.addEventListener('click', onClick);
    return btn;
}

export async function copyText(text) {
    if (!text) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.insetInlineStart = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        return true;
    } catch {
        return false;
    }
}
