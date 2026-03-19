/* ============================================================
   BITBI — Member Profile Page
   Entry point for profile.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import { apiGetProfile, apiUpdateProfile, apiLogout, apiUploadAvatar, apiDeleteAvatar } from '../../shared/auth-api.js';

/* ── DOM refs ── */
const $loading        = document.getElementById('loadingState');
const $denied         = document.getElementById('deniedState');
const $content        = document.getElementById('profileContent');

const $summaryName    = document.getElementById('summaryName');
const $summaryEmail   = document.getElementById('summaryEmail');
const $summaryRole    = document.getElementById('summaryRole');
const $summaryVerified = document.getElementById('summaryVerified');
const $summarySince   = document.getElementById('summarySince');

const $form           = document.getElementById('profileForm');
const $displayName    = document.getElementById('displayName');
const $bio            = document.getElementById('bio');
const $website        = document.getElementById('website');
const $youtubeUrl     = document.getElementById('youtubeUrl');
const $submitBtn      = document.getElementById('submitBtn');
const $formMsg        = document.getElementById('formMsg');
const $logoutBtn      = document.getElementById('logoutBtn');

const $avatarImg         = document.getElementById('avatarImg');
const $avatarPlaceholder = document.getElementById('avatarPlaceholder');
const $avatarInput       = document.getElementById('avatarInput');
const $avatarRemoveBtn   = document.getElementById('avatarRemoveBtn');
const $avatarUploadText  = document.getElementById('avatarUploadText');
const $avatarUploadLabel = document.getElementById('avatarUploadLabel');
const $avatarMsg         = document.getElementById('avatarMsg');

/* ── Date formatter ── */
const dtf = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
});

function formatDate(iso) {
    if (!iso) return '\u2014';
    return dtf.format(new Date(iso));
}

/* ── Message helpers ── */
function showMsg(text, type) {
    $formMsg.textContent = text;
    $formMsg.className = `profile__msg profile__msg--${type}`;
}

function hideMsg() {
    $formMsg.className = 'profile__msg';
    $formMsg.textContent = '';
}

/* ── Avatar helpers ── */
const AVATAR_URL = '/api/profile/avatar';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function showAvatarMsg(text, type) {
    $avatarMsg.textContent = text;
    $avatarMsg.className = `profile__msg profile__msg--${type}`;
}

function hideAvatarMsg() {
    $avatarMsg.className = 'profile__msg';
    $avatarMsg.textContent = '';
}

function loadAvatar(bustCache) {
    const src = bustCache ? `${AVATAR_URL}?t=${Date.now()}` : AVATAR_URL;
    const img = new Image();
    img.onload = () => {
        $avatarImg.src = img.src;
        $avatarImg.style.display = '';
        $avatarPlaceholder.style.display = 'none';
        $avatarRemoveBtn.style.display = '';
    };
    img.onerror = () => {
        $avatarImg.style.display = 'none';
        $avatarPlaceholder.style.display = '';
        $avatarRemoveBtn.style.display = 'none';
    };
    img.src = src;
}

/* ── State switching ── */
function showState(el) {
    $loading.style.display = 'none';
    $denied.style.display = 'none';
    $content.style.display = 'none';
    el.style.display = '';
}

/* ── Render profile data ── */
function renderProfile(profile, account) {
    // Summary card
    $summaryName.textContent = profile.display_name || '\u2014';
    $summaryEmail.textContent = account.email;

    $summaryRole.textContent = '';
    const roleBadge = document.createElement('span');
    roleBadge.className = 'profile__badge profile__badge--role';
    roleBadge.textContent = account.role;
    $summaryRole.appendChild(roleBadge);

    $summaryVerified.textContent = '';
    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = `profile__badge profile__badge--${account.email_verified ? 'verified' : 'unverified'}`;
    verifiedBadge.textContent = account.email_verified ? 'Yes' : 'No';
    $summaryVerified.appendChild(verifiedBadge);

    $summarySince.textContent = formatDate(account.created_at);

    // Form fields
    $displayName.value = profile.display_name;
    $bio.value = profile.bio;
    $website.value = profile.website;
    $youtubeUrl.value = profile.youtube_url;
}

/* ── Init ── */
async function init() {
    // Shared header (nav, mobile menu, auth)
    try { initSiteHeader(); } catch (e) { console.warn(e); }

    // Visual modules (non-blocking)
    try { initParticles('heroCanvas'); }      catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }     catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }               catch (e) { console.warn(e); }
    try { initCookieConsent(); }              catch (e) { console.warn(e); }

    // Load profile (doubles as auth check — returns 401 if not logged in)
    const res = await apiGetProfile();

    if (!res.ok) {
        showState($denied);
        $denied.classList.add('visible');
        return;
    }

    // Show profile content
    showState($content);
    renderProfile(res.data.profile, res.data.account);
    loadAvatar(false);

    // Avatar upload
    $avatarInput.addEventListener('change', async () => {
        const file = $avatarInput.files[0];
        if (!file) return;

        hideAvatarMsg();

        if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
            showAvatarMsg('Invalid file type. Allowed: JPEG, PNG, WebP.', 'error');
            $avatarInput.value = '';
            return;
        }
        if (file.size > MAX_AVATAR_SIZE) {
            showAvatarMsg('File too large. Maximum size is 2 MB.', 'error');
            $avatarInput.value = '';
            return;
        }

        $avatarUploadLabel.style.pointerEvents = 'none';
        $avatarUploadLabel.style.opacity = '0.5';
        $avatarUploadText.textContent = 'Uploading\u2026';

        const result = await apiUploadAvatar(file);

        $avatarUploadLabel.style.pointerEvents = '';
        $avatarUploadLabel.style.opacity = '';
        $avatarUploadText.textContent = 'Change Photo';
        $avatarInput.value = '';

        if (result.ok) {
            showAvatarMsg('Photo updated.', 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Avatar remove
    $avatarRemoveBtn.addEventListener('click', async () => {
        hideAvatarMsg();
        $avatarRemoveBtn.disabled = true;
        $avatarRemoveBtn.textContent = 'Removing\u2026';

        const result = await apiDeleteAvatar();

        $avatarRemoveBtn.disabled = false;
        $avatarRemoveBtn.textContent = 'Remove';

        if (result.ok) {
            showAvatarMsg('Photo removed.', 'success');
            loadAvatar(true);
        } else {
            showAvatarMsg(result.error, 'error');
        }
    });

    // Form submission
    $form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMsg();

        $submitBtn.disabled = true;
        $submitBtn.textContent = 'Saving...';

        const result = await apiUpdateProfile({
            display_name: $displayName.value,
            bio: $bio.value,
            website: $website.value,
            youtube_url: $youtubeUrl.value,
        });

        $submitBtn.disabled = false;
        $submitBtn.textContent = 'Save Changes';

        if (result.ok) {
            showMsg('Profile updated.', 'success');
            $summaryName.textContent = $displayName.value.trim() || '\u2014';
        } else {
            showMsg(result.error, 'error');
        }
    });

    // Logout button
    $logoutBtn.addEventListener('click', async () => {
        await apiLogout();
        window.location.href = '/';
    });
}

init();
