/* ============================================================
   BITBI — Image Studio Page
   Entry point for account/image-studio.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import {
    apiGetMe,
    apiAiGenerateImage,
    apiAiGetFolders,
    apiAiCreateFolder,
    apiAiGetImages,
    apiAiSaveImage,
    apiAiDeleteImage,
} from '../../shared/auth-api.js';

/* ── DOM refs ── */
const $loading = document.getElementById('loadingState');
const $denied  = document.getElementById('deniedState');
const $content = document.getElementById('studioContent');

// Generator
const $prompt      = document.getElementById('studioPrompt');
const $steps       = document.getElementById('studioSteps');
const $seed        = document.getElementById('studioSeed');
const $randomize   = document.getElementById('studioRandomize');
const $generateBtn = document.getElementById('studioGenerate');
const $preview     = document.getElementById('studioPreview');
const $genMsg      = document.getElementById('studioGenMsg');

// Save bar
const $saveBar     = document.getElementById('studioSaveBar');
const $folderSelect = document.getElementById('studioFolderSelect');
const $saveBtn     = document.getElementById('studioSaveBtn');

// Gallery
const $galleryFilter    = document.getElementById('studioGalleryFilter');
const $imageGrid        = document.getElementById('studioImageGrid');
const $galleryMsg       = document.getElementById('studioGalleryMsg');
const $newFolderBtn     = document.getElementById('studioNewFolderBtn');
const $newFolderForm    = document.getElementById('studioNewFolderForm');
const $newFolderInput   = document.getElementById('studioNewFolderInput');
const $newFolderSave    = document.getElementById('studioNewFolderSave');
const $newFolderCancel  = document.getElementById('studioNewFolderCancel');

/* ── State ── */
let currentImageData = null;
let currentMeta      = null;
let folders          = [];

/* ── Helpers ── */
function showState(el) {
    $loading.style.display = 'none';
    $denied.style.display  = 'none';
    $content.style.display = 'none';
    el.style.display = '';
}

function showMsg(el, text, type) {
    el.textContent = text;
    el.className = `studio__msg studio__msg--${type}`;
}

function hideMsg(el) {
    el.className = 'studio__msg';
    el.textContent = '';
}

function populateFolderOptions(selectEl) {
    const safeFolders = Array.isArray(folders) ? folders : [];
    const current = selectEl.value;
    const opts = ['<option value="">No folder</option>'];
    for (const f of safeFolders) {
        opts.push(`<option value="${f.id}">${escapeHtml(f.name)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
    if (current) selectEl.value = current;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Folders ── */
async function loadFolders() {
    try {
        folders = await apiAiGetFolders();
    } catch (e) {
        console.warn('Failed to load folders:', e);
        folders = [];
    }
    populateFolderOptions($folderSelect);
    populateFolderOptions($galleryFilter);
    $galleryFilter.insertAdjacentHTML('afterbegin', '<option value="">All images</option>');
    $galleryFilter.value = '';
}

/* ── Image Generation ── */
async function handleGenerate() {
    const prompt = $prompt.value.trim();
    if (!prompt) {
        showMsg($genMsg, 'Please enter a prompt.', 'error');
        return;
    }

    hideMsg($genMsg);
    $generateBtn.disabled = true;
    $generateBtn.textContent = 'Generating\u2026';
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;

    $preview.innerHTML = '<div class="studio__loading"><div class="studio__spinner"></div><span>Creating your image\u2026</span></div>';

    const steps = $steps.value ? Number($steps.value) : null;
    const seed  = $seed.value  ? Number($seed.value)  : null;

    const res = await apiAiGenerateImage(prompt, steps, seed);

    $generateBtn.disabled = false;
    $generateBtn.textContent = 'Generate';

    if (!res.ok) {
        $preview.innerHTML = '<div class="studio__preview-empty">Generation failed</div>';
        showMsg($genMsg, res.error, 'error');
        return;
    }

    currentImageData = res.data.image;
    currentMeta = { prompt: res.data.prompt, model: res.data.model, steps: res.data.steps, seed: res.data.seed };

    $preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = currentImageData;
    img.alt = prompt;
    $preview.appendChild(img);

    $saveBar.classList.add('visible');
    showMsg($genMsg, 'Image generated.', 'success');
}

/* ── Save Image ── */
async function handleSave() {
    if (!currentImageData || !currentMeta) return;

    $saveBtn.disabled = true;
    $saveBtn.textContent = 'Saving\u2026';

    const folderId = $folderSelect.value || null;
    const res = await apiAiSaveImage(
        currentImageData,
        currentMeta.prompt,
        currentMeta.model,
        currentMeta.steps,
        currentMeta.seed,
        folderId
    );

    $saveBtn.disabled = false;
    $saveBtn.textContent = 'Save';

    if (!res.ok) {
        showMsg($genMsg, res.error, 'error');
        return;
    }

    showMsg($genMsg, 'Image saved.', 'success');
    $saveBar.classList.remove('visible');
    currentImageData = null;
    currentMeta = null;
    loadGallery();
}

/* ── Gallery ── */
async function loadGallery() {
    const folderId = $galleryFilter.value || null;
    const res = await apiAiGetImages(folderId);

    if (!res.ok) {
        $imageGrid.innerHTML = '<div class="studio__gallery-empty">Could not load images.</div>';
        return;
    }

    const images = res.data.images;
    if (images.length === 0) {
        $imageGrid.innerHTML = '<div class="studio__gallery-empty">No saved images yet. Generate and save your first one above.</div>';
        return;
    }

    $imageGrid.innerHTML = '';
    for (const img of images) {
        const item = document.createElement('div');
        item.className = 'studio__image-item';
        item.title = img.prompt;

        const imgEl = document.createElement('img');
        imgEl.src = `/api/ai/images/${img.id}/file`;
        imgEl.alt = img.prompt;
        imgEl.loading = 'lazy';
        item.appendChild(imgEl);

        const overlay = document.createElement('div');
        overlay.className = 'studio__image-overlay';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'studio__image-delete';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete this image?')) return;
            delBtn.disabled = true;
            delBtn.textContent = '\u2026';
            const del = await apiAiDeleteImage(img.id);
            if (del.ok) {
                item.remove();
                // Check if grid is now empty
                if ($imageGrid.children.length === 0) {
                    $imageGrid.innerHTML = '<div class="studio__gallery-empty">No saved images yet.</div>';
                }
            } else {
                delBtn.disabled = false;
                delBtn.textContent = 'Delete';
                showMsg($galleryMsg, del.error, 'error');
            }
        });
        overlay.appendChild(delBtn);
        item.appendChild(overlay);

        $imageGrid.appendChild(item);
    }
}

/* ── New Folder ── */
function showNewFolderForm() {
    $newFolderForm.classList.add('visible');
    $newFolderInput.value = '';
    $newFolderInput.focus();
}

function hideNewFolderForm() {
    $newFolderForm.classList.remove('visible');
}

async function handleCreateFolder() {
    const name = $newFolderInput.value.trim();
    if (!name) return;

    $newFolderSave.disabled = true;
    const res = await apiAiCreateFolder(name);
    $newFolderSave.disabled = false;

    if (!res.ok) {
        showMsg($galleryMsg, res.error, 'error');
        return;
    }

    hideNewFolderForm();
    await loadFolders();
    showMsg($galleryMsg, `Folder "${name}" created.`, 'success');
}

/* ── Init ── */
async function init() {
    try { initSiteHeader(); }    catch (e) { console.warn(e); }
    try { initParticles('heroCanvas'); }      catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }     catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }               catch (e) { console.warn(e); }
    try { initCookieConsent(); }              catch (e) { console.warn(e); }

    // Auth check via /api/me
    const res = await apiGetMe();

    if (!res.ok || !res.data?.loggedIn) {
        showState($denied);
        $denied.classList.add('visible');
        return;
    }

    showState($content);

    // Load data
    await loadFolders();
    loadGallery();

    // Event listeners
    $generateBtn.addEventListener('click', handleGenerate);
    $saveBtn.addEventListener('click', handleSave);
    $randomize.addEventListener('click', () => {
        $seed.value = Math.floor(Math.random() * 2147483647);
    });
    $galleryFilter.addEventListener('change', loadGallery);
    $newFolderBtn.addEventListener('click', showNewFolderForm);
    $newFolderCancel.addEventListener('click', hideNewFolderForm);
    $newFolderSave.addEventListener('click', handleCreateFolder);
    $newFolderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleCreateFolder(); }
        if (e.key === 'Escape') hideNewFolderForm();
    });

    // Allow Ctrl+Enter to generate
    $prompt.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });
}

init();
