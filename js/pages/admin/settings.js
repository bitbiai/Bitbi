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

    function setState(message, state = 'neutral') {
        if (!refs.state) return;
        refs.state.dataset.state = state;
        refs.state.textContent = message;
    }

    function render(registration = {}) {
        if (!refs.panel) return;
        const enabled = registration.enabled !== false;
        if (refs.toggle) refs.toggle.checked = enabled;
        if (refs.statusText) {
            refs.statusText.textContent = enabled
                ? 'Registrations enabled'
                : 'Registrations disabled for maintenance';
            refs.statusText.dataset.state = enabled ? 'success' : 'warning';
        }
        if (refs.messageText) {
            refs.messageText.textContent = registration.maintenanceMessage
                || 'Registrations are temporarily disabled due to maintenance work. Please try again later.';
        }
        if (refs.updatedText) {
            const pieces = [
                registration.settingPresent ? 'Stored setting present' : 'Default setting in effect',
            ];
            if (registration.storageAvailable === false) pieces.push('settings migration pending');
            if (registration.updatedAt) pieces.push(`updated ${formatDate(registration.updatedAt)}`);
            if (registration.updatedByUserId) pieces.push(`by ${shortUserId(registration.updatedByUserId)}`);
            refs.updatedText.textContent = pieces.join(' · ');
        }
        if (refs.reason && registration.reason) {
            refs.reason.placeholder = `Last reason: ${registration.reason}`;
        }
    }

    async function load() {
        if (!refs.panel) return;
        setState('Loading registration availability...');
        const res = await apiAdminRegistrationStatus();
        if (!res.ok) {
            setState(formatApiError(res, 'Registration availability status could not be loaded.'), 'error');
            return;
        }
        render(res.data?.registration || {});
        setState('Registration availability loaded. Existing users can still sign in regardless of this setting.', 'success');
    }

    async function save() {
        if (!refs.toggle || !refs.saveBtn) return;
        const enabled = refs.toggle.checked === true;
        const reason = (refs.reason?.value || '').trim();
        if (!enabled && !reason) {
            setState('A reason is required when disabling new registrations.', 'error');
            refs.reason?.focus?.();
            return;
        }
        const confirmed = window.confirm(enabled
            ? 'Enable new user registrations? Existing users are unaffected.'
            : 'Disable new user registrations for maintenance? Existing users will still be able to sign in.');
        if (!confirmed) return;
        refs.saveBtn.disabled = true;
        setState('Saving registration availability...');
        try {
            const res = await apiAdminSetRegistrationStatus({
                enabled,
                reason,
                maintenanceMessage: 'Registrations are temporarily disabled due to maintenance work. Please try again later.',
            }, {
                idempotencyKey: createAdminIdempotencyKey('registration-availability'),
            });
            if (!res.ok) {
                const message = formatApiError(res, 'Registration availability could not be saved.');
                setState(message, 'error');
                showToast(message, 'error');
                return;
            }
            render(res.data?.registration || {});
            if (refs.reason) refs.reason.value = '';
            setState(res.data?.message || 'Registration availability saved.', 'success');
            showToast(res.data?.message || 'Registration availability saved.', 'success');
        } finally {
            refs.saveBtn.disabled = false;
        }
    }

    function bind() {
        if (!refs.panel || refs.panel.dataset.bound === '1') return;
        refs.panel.dataset.bound = '1';
        refs.saveBtn?.addEventListener('click', () => {
            save().catch((error) => {
                console.warn(error);
                setState('Registration availability could not be saved.', 'error');
                if (refs.saveBtn) refs.saveBtn.disabled = false;
            });
        });
        refs.toggle?.addEventListener('change', () => {
            const enabled = refs.toggle.checked === true;
            if (refs.statusText) {
                refs.statusText.textContent = enabled
                    ? 'Registrations enabled (unsaved)'
                    : 'Registrations disabled for maintenance (unsaved)';
                refs.statusText.dataset.state = enabled ? 'success' : 'warning';
            }
            setState(
                enabled
                    ? 'Save to allow new account creation again. Existing users are unaffected.'
                    : 'Enter a reason, then save to block only new account creation. Existing users are unaffected.',
                'neutral'
            );
        });
    }

    return {
        bind,
        load,
    };
}
