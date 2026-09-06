import {
    apiAdminRegistrationStatus,
    apiAdminSetRegistrationStatus,
    createAdminIdempotencyKey,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

export function createRegistrationAvailabilityPanel({
    showToast,
    formatDate,
    formatApiError,
    shortUserId,
} = {}) {
    const refs = {
        panel: document.getElementById('registrationAvailabilityPanel'),
        state: document.getElementById('registrationAvailabilityState'),
        toggle: document.getElementById('registrationEnabledToggle'),
        statusText: document.getElementById('registrationAvailabilityStatusText'),
        messageText: document.getElementById('registrationAvailabilityMessageText'),
        updatedText: document.getElementById('registrationAvailabilityUpdatedText'),
        reason: document.getElementById('registrationAvailabilityReason'),
        saveBtn: document.getElementById('registrationAvailabilitySaveBtn'),
    };
    let active = true;
    let readVersion = 0;
    let editVersion = 0;
    let dirty = false;
    let pendingRead = null;
    let intent = null;
    let lastResult = null;

    function setState(message, state = 'neutral') {
        if (!refs.state) return;
        refs.state.dataset.state = state;
        refs.state.textContent = message;
    }

    function render(registration = {}, applyDraft = true) {
        if (!refs.panel) return;
        const enabled = registration.enabled !== false;
        if (applyDraft && refs.toggle) refs.toggle.checked = enabled;
        if (refs.statusText) {
            const displayedEnabled = applyDraft ? enabled : refs.toggle?.checked === true;
            refs.statusText.textContent = (displayedEnabled ? 'Registrations enabled' : 'Registrations disabled for maintenance')
                + (applyDraft ? '' : ' (unsaved)');
            refs.statusText.dataset.state = displayedEnabled && applyDraft ? 'success' : 'warning';
        }
        if (refs.messageText) refs.messageText.textContent = registration.maintenanceMessage
            || 'Registrations are temporarily disabled due to maintenance work. Please try again later.';
        if (refs.updatedText) {
            const pieces = [registration.settingPresent ? 'Stored setting present' : 'Default setting in effect'];
            if (registration.storageAvailable === false) pieces.push('settings migration pending');
            if (registration.updatedAt) pieces.push(`updated ${formatDate(registration.updatedAt)}`);
            if (registration.updatedByUserId) pieces.push(`by ${shortUserId(registration.updatedByUserId)}`);
            refs.updatedText.textContent = pieces.join(' · ');
        }
        if (refs.reason) refs.reason.placeholder = registration.reason
            ? `Last reason: ${registration.reason}` : 'Required when disabling new registrations.';
    }

    function showResult() {
        if (!active || !lastResult) return;
        if (lastResult.registration) render(lastResult.registration, !dirty);
        setState(lastResult.message + (dirty ? ' Your newer changes remain unsaved.' : ''), lastResult.state);
    }

    async function load() {
        active = true;
        if (!refs.panel) return;
        // Re-entry must not silently refresh over a draft or an unresolved write.
        if (dirty || intent) { showResult(); return; }
        if (pendingRead) return pendingRead;
        const token = ++readVersion;
        const editAtStart = editVersion;
        setState('Loading registration availability...');
        const request = (async () => {
            const res = await apiAdminRegistrationStatus();
            if (!active || token !== readVersion || !refs.panel.isConnected) return;
            if (!res.ok || typeof res.data?.registration?.enabled !== 'boolean') {
                if (!dirty && refs.statusText) {
                    refs.statusText.textContent = 'Availability not verified';
                    refs.statusText.dataset.state = 'warning';
                }
                setState(formatApiError(res, 'Registration availability status could not be loaded.'), 'error');
                return;
            }
            const unchanged = editVersion === editAtStart;
            render(res.data?.registration || {}, unchanged);
            setState(unchanged
                ? 'Registration availability loaded. Existing users can still sign in regardless of this setting.'
                : 'Saved registration availability loaded; your changes remain unsaved.', unchanged ? 'success' : 'neutral');
        })();
        pendingRead = request;
        try { await request; } finally { if (pendingRead === request) pendingRead = null; }
    }

    async function save() {
        if (!active || !refs.toggle || !refs.saveBtn || intent?.pending) return;
        if (!intent) {
            const enabled = refs.toggle.checked === true;
            const reason = (refs.reason?.value || '').trim();
            if (!enabled && !reason) {
                setState('A reason is required when disabling new registrations.', 'error');
                refs.reason?.focus?.(); return;
            }
            const confirmed = window.confirm(enabled
                ? 'Enable new user registrations? Existing users are unaffected.'
                : 'Disable new user registrations for maintenance? Existing users will still be able to sign in.');
            if (!confirmed) return;
            intent = {
                payload: { enabled, reason, maintenanceMessage: 'Registrations are temporarily disabled due to maintenance work. Please try again later.' },
                key: createAdminIdempotencyKey('registration-availability'), editVersion,
            };
        } else if (!window.confirm('Retry the original registration change with its original enabled state and operator note? Later edits will not be sent. The previous outcome is not confirmed.')) return;
        const operation = intent;
        operation.pending = true;
        readVersion += 1; pendingRead = null; lastResult = null;
        refs.saveBtn.disabled = true;
        setState('Saving registration availability...');
        try {
            const res = await apiAdminSetRegistrationStatus(operation.payload, { idempotencyKey: operation.key });
            if (!res.ok || typeof res.data?.registration?.enabled !== 'boolean') {
                lastResult = { message: 'Registration change is not confirmed. ' + formatApiError(res, 'No usable confirmation was returned.') + ' You may explicitly retry the original change.', state: 'error' };
                return;
            }
            dirty = editVersion !== operation.editVersion;
            if (!dirty && refs.reason) refs.reason.value = '';
            lastResult = { registration: res.data.registration, message: 'Original registration availability change saved.', state: dirty ? 'neutral' : 'success' };
            intent = null;
            if (active && refs.panel.isConnected) showToast?.('Registration availability saved.', 'success');
        } catch {
            lastResult = { message: 'Registration change is not confirmed. Verify its saved state or explicitly retry the original change; later edits have not been submitted.', state: 'error' };
        } finally {
            operation.pending = false;
            refs.saveBtn.disabled = false;
            refs.saveBtn.textContent = intent ? 'Retry original registration change' : 'Save registration availability';
            showResult();
        }
    }

    function edited() {
        editVersion += 1; dirty = true;
        if (refs.statusText) {
            refs.statusText.textContent = (refs.toggle?.checked === true ? 'Registrations enabled' : 'Registrations disabled for maintenance') + ' (unsaved)';
            refs.statusText.dataset.state = 'warning';
        }
        if (!intent) setState('Unsaved changes. Save to apply this setting; existing users are unaffected.');
    }

    function bind() {
        if (!refs.panel || refs.panel.dataset.bound === '1') return;
        refs.panel.dataset.bound = '1';
        refs.saveBtn?.addEventListener('click', () => { void save(); });
        refs.toggle?.addEventListener('change', edited);
        refs.reason?.addEventListener('input', edited);
    }
    function hide() { active = false; readVersion += 1; pendingRead = null; }

    return { bind, load, hide };
}
