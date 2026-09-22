import { apiAiSaveImage } from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { GPT_IMAGE_25_MAX_REFERENCE_BYTES } from '../../shared/gpt-image-25-contract.mjs?v=__ASSET_VERSION__';

export function renderCanvasImageReferences({ node, sources, german, choose, update, error, isCurrent }) {
    const root = document.createElement('section'); root.className = 'canvas-input-context';
    const selected = node.config?.source_images || [];
    const referenceSnapshot = JSON.stringify(selected);
    const canAssign = () => root.isConnected && isCurrent() && JSON.stringify(node.config?.source_images || []) === referenceSnapshot;
    const connected = sources.filter(source => source.inputKind === 'image_reference');
    const title = document.createElement('h3'); title.textContent = german ? 'Geordnete Referenzen' : 'Ordered references';
    const help = document.createElement('p'); help.textContent = german
        ? `${selected.length + connected.length} / 16 · Ausgewählte Bilder zuerst, anschließend verbundene Bilder. Transparenz erfordert PNG oder WebP.`
        : `${selected.length + connected.length} / 16 · Selected images first, followed by connected images. Transparency requires PNG or WebP.`;
    root.append(title, help);
    function button(label, callback, disabled = false) {
        const value = document.createElement('button'); value.type = 'button'; value.className = 'canvas-button'; value.textContent = label; value.disabled = disabled; value.addEventListener('click', callback); return value;
    }
    const picker = button(german ? 'Assets auswählen' : 'Select assets', () => choose(16 - selected.length - connected.length), selected.length + connected.length >= 16);
    picker.id = 'canvasImageReferencesChoose';
    const upload = document.createElement('input'); upload.type = 'file'; upload.multiple = true; upload.accept = 'image/png,image/jpeg,image/webp'; upload.setAttribute('aria-label', german ? 'Referenzbilder hochladen' : 'Upload reference images');
    upload.addEventListener('change', async () => {
        if (!canAssign()) return;
        const files = [...upload.files];
        if (files.length + selected.length + connected.length > 16) return error(german ? 'Maximal 16 Referenzen.' : 'Use at most 16 references.');
        upload.disabled = true;
        try {
            const added = [];
            for (const file of files) {
                if (!canAssign()) return;
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > GPT_IMAGE_25_MAX_REFERENCE_BYTES) throw new Error(german ? 'PNG/JPEG/WebP bis 10 MiB erforderlich.' : 'Use PNG/JPEG/WebP up to 10 MiB.');
                const imageData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
                if (!canAssign()) return;
                const saved = await apiAiSaveImage(imageData, file.name, 'uploaded-reference');
                if (!canAssign()) return;
                const asset = saved.data?.data || saved.data;
                if (!saved.ok || !asset?.id) throw new Error(saved.error || 'Upload failed.');
                added.push({ source_type: 'saved_asset', asset_id: asset.id, title: file.name, preview_url: asset.file_url || asset.url || '' });
            }
            if (canAssign()) update({ source_images: [...selected, ...added] });
        } catch (failure) { if (canAssign()) error(failure.message); }
        finally { upload.disabled = false; upload.value = ''; }
    });
    root.append(picker, upload);
    function row(source, index, values, key, connectedSource = false) {
        const item = document.createElement('div'); item.className = 'canvas-field-grid';
        const label = document.createElement('span'); label.textContent = `${index + 1}. ${source.title || source.sourceTitle || source.asset_id}`;
        if (source.preview_url || source.previewUrl) { const image = document.createElement('img'); image.src = source.preview_url || source.previewUrl; image.alt = ''; image.width = 48; image.height = 48; image.loading = 'lazy'; item.append(image); }
        item.append(label);
        for (const offset of [-1, 1]) {
            const move = button(offset < 0 ? '↑' : '↓', () => {
                const reordered = [...values]; [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
                update({ [key]: connectedSource ? reordered.map(value => value.edgeId) : reordered });
            }, index + offset < 0 || index + offset >= values.length);
            move.setAttribute('aria-label', german ? `Referenz ${index + 1} ${offset < 0 ? 'nach vorne' : 'nach hinten'}` : `Move reference ${index + 1} ${offset < 0 ? 'earlier' : 'later'}`); item.append(move);
        }
        if (!connectedSource) item.append(button(german ? 'Entfernen' : 'Remove', () => update({ source_images: values.filter((_, position) => position !== index) })));
        root.append(item);
    }
    selected.forEach((source, index) => row(source, index, selected, 'source_images'));
    connected.forEach((source, index) => row(source, index, connected, 'referenceOrder', true));
    return root;
}
