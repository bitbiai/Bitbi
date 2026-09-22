export function createReferenceSlot(index) {
    const slot = document.createElement('div');
    slot.className = 'admin-ai__ref-slot';
    slot.dataset.refIndex = String(index);

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.className = 'admin-ai__ref-input';
    input.id = `aiImageRef${index}`;
    input.hidden = true;

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'admin-ai__ref-add';
    add.dataset.refIndex = String(index);
    add.title = 'Add reference image';
    add.setAttribute('aria-label', `Add reference image ${index + 1}`);
    add.textContent = '+';

    const preview = document.createElement('div');
    preview.className = 'admin-ai__ref-preview';
    preview.dataset.refIndex = String(index);
    preview.hidden = true;

    const thumb = document.createElement('img');
    thumb.className = 'admin-ai__ref-thumb';
    thumb.alt = `Reference ${index + 1}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'admin-ai__ref-remove';
    remove.dataset.refIndex = String(index);
    remove.title = 'Remove';
    remove.setAttribute('aria-label', `Remove reference image ${index + 1}`);
    remove.textContent = '×';

    preview.append(thumb, remove);
    for (const [direction, label] of [[-1, 'Move reference earlier'], [1, 'Move reference later']]) {
        const move = document.createElement('button'); move.type = 'button'; move.className = 'admin-ai__ref-move'; move.dataset.refMove = String(direction); move.dataset.refIndex = String(index); move.textContent = direction < 0 ? '←' : '→'; move.setAttribute('aria-label', label); preview.append(move);
    }
    slot.append(input, add, preview);
    return slot;
}

export function ensureReferenceSlots(grid, maxRef) {
    if (!grid) return;
    for (let i = 0; i < maxRef; i++) {
        if (!grid.querySelector(`.admin-ai__ref-slot[data-ref-index="${i}"]`)) {
            grid.appendChild(createReferenceSlot(i));
        }
        const preview = grid.querySelector(`.admin-ai__ref-slot[data-ref-index="${i}"] .admin-ai__ref-preview`);
        if (preview && !preview.querySelector('[data-ref-move]')) {
            for (const [direction, label] of [[-1, 'Move reference earlier'], [1, 'Move reference later']]) {
                const move = document.createElement('button'); move.type = 'button'; move.className = 'admin-ai__ref-move'; move.dataset.refMove = String(direction); move.dataset.refIndex = String(i); move.textContent = direction < 0 ? '←' : '→'; move.setAttribute('aria-label', label); preview.append(move);
            }
        }
    }
}


export function renderReferenceSlots(grid, count, images, maxRef, disabled) {
    ensureReferenceSlots(grid, maxRef);
    const selectedCount = images.filter(Boolean).length;
    count.textContent = `${selectedCount} / ${maxRef}`;

    const slots = grid.querySelectorAll('.admin-ai__ref-slot[data-ref-index]');
    slots.forEach((slot) => {
        const i = Number(slot.dataset.refIndex);
        if (!Number.isInteger(i)) return;
        slot.hidden = i >= maxRef;
        const addBtn = slot.querySelector('.admin-ai__ref-add');
        const preview = slot.querySelector('.admin-ai__ref-preview');
        const thumb = preview?.querySelector('.admin-ai__ref-thumb');

        if (images[i]) {
            addBtn.hidden = true;
            preview.hidden = false;
            if (thumb) thumb.src = typeof images[i] === 'string' ? images[i] : images[i].preview_url || images[i].thumb_url || '';
            for (const button of preview.querySelectorAll('[data-ref-move]')) button.disabled = i + Number(button.dataset.refMove) < 0 || i + Number(button.dataset.refMove) >= images.length;
        } else {
            addBtn.hidden = false;
            preview.hidden = true;
            if (thumb) thumb.src = '';
            addBtn.disabled = disabled || selectedCount >= maxRef;
        }
    });
}

const originalSourceHints = new WeakMap();
export function updateSourceExplanation(field, isImage25) {
    const hint = field?.querySelector('p.admin-ai__hint');
    if (!hint) return;
    if (!originalSourceHints.has(hint)) originalSourceHints.set(hint, hint.textContent);
    hint.textContent = isImage25
        ? 'Prompt-only generation is available. Add up to 16 ordered owned images; originals are resolved server-side to base64. Reference editing is unavailable until its token pricing is verified.'
        : originalSourceHints.get(hint);
}

const referenceUploads = new WeakMap();
export function invalidateReferenceUploads(form) { referenceUploads.delete(form); }
export function referenceUploadGuard(form, index) {
    if (!referenceUploads.has(form)) referenceUploads.set(form, new Map());
    const uploads = referenceUploads.get(form), token = {};
    uploads.set(index, token);
    const model = form.model, references = form.referenceImages;
    const snapshot = JSON.stringify(references);
    return () => referenceUploads.get(form) === uploads && uploads.get(index) === token && form.model === model
        && form.referenceImages === references && JSON.stringify(references) === snapshot;
}


export async function saveOwnedReference(file, dataUri, save) {
    const result = await save(dataUri, file.name, 'uploaded-reference');
    const assetId = result.data?.data?.id || result.data?.id;
    if (!result.ok || !assetId) throw new Error(result.error || 'Image upload failed.');
    return { source_type: 'saved_asset', asset_id: assetId, title: file.name,
        preview_url: result.data?.data?.file_url || result.data?.file_url || dataUri };
}

export function showUnavailableImagePricing(refs, references) {
    if (refs.run) { refs.run.disabled = true; refs.run.textContent = 'Pricing verification pending'; }
    if (refs.gptCostHint) refs.gptCostHint.textContent = references.filter(Boolean).length
        ? 'Editing is unavailable until reference-image token pricing is verified. Your references are retained.'
        : 'Enter a prompt with valid settings. Generation requires verified pricing.';
    if (refs.organizationState) refs.organizationState.textContent = 'Pricing unavailable for these settings; no request will be sent.';
}
