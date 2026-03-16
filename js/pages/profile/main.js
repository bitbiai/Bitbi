/* ============================================================
   BITBI — Member Profile Page
   Entry point for profile.html
   ============================================================ */

import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import { apiGetProfile, apiUpdateProfile, apiLogout } from '../../shared/auth-api.js';

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
        window.location.href = 'index.html';
    });
}

init();
