import {
    apiAdminMfaEnable,
    apiAdminMfaSetup,
    apiAdminMfaStatus,
    apiAdminMfaVerify,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

export const ADMIN_MFA_GATE_CODES = new Set([
    'admin_mfa_enrollment_required',
    'admin_mfa_required',
    'admin_mfa_invalid_or_expired',
]);

export function renderSecurityPosturePanel({ container, renderCards }) {
    if (!container || typeof renderCards !== 'function') return;
    renderCards(container, [
        {
            title: 'Route Policy Registry',
            badge: { label: 'Repo checked', variant: 'active' },
            copy: 'High-risk auth-worker routes are registered and checked by npm run check:route-policies.',
            meta: [['Scope', 'Review/CI metadata, not a live dashboard signal']],
        },
        {
            title: 'Fail-Closed Limiters',
            badge: { label: 'Sensitive routes', variant: 'active' },
            copy: 'Auth, admin, AI, billing, lifecycle, and webhook mutation paths use fail-closed rate limiting where implemented.',
            meta: [['Live verification', 'Required in staging/production']],
        },
        {
            title: 'Admin MFA',
            badge: { label: 'Production gated', variant: 'active' },
            copy: 'Admin access is centrally MFA-gated in production and backed by durable failed-attempt state.',
            meta: [['Secrets', 'Managed by deployment configuration only']],
        },
        {
            title: 'Service Auth / Replay',
            badge: { label: 'HMAC + nonce', variant: 'active' },
            copy: 'Auth-to-AI service calls use HMAC authentication and Durable Object replay protection.',
            meta: [['Secret values', 'Never shown in this UI']],
        },
        {
            title: 'Production Readiness',
            badge: { label: 'Blocked', variant: 'disabled' },
            copy: 'This UI reflects repo/runtime API state. It does not prove live Cloudflare resources, migrations, WAF, headers, or Stripe endpoint readiness.',
            meta: [['Required checks', 'Staging verification and live prereq validation']],
        },
    ]);
}

export function createAdminMfaGate({ showToast, showGate, reload } = {}) {
    const refs = {
        gate: document.getElementById('adminMfaGate'),
        title: document.getElementById('adminMfaTitle'),
        text: document.getElementById('adminMfaText'),
        notice: document.getElementById('adminMfaNotice'),
        enrollmentBlock: document.getElementById('adminMfaEnrollmentBlock'),
        verifyBlock: document.getElementById('adminMfaVerifyBlock'),
        setupBtn: document.getElementById('adminMfaSetupBtn'),
        setupFields: document.getElementById('adminMfaSetupFields'),
        secret: document.getElementById('adminMfaSecret'),
        otpAuthUri: document.getElementById('adminMfaOtpAuthUri'),
        recoveryCodes: document.getElementById('adminMfaRecoveryCodes'),
        enableCode: document.getElementById('adminMfaEnableCode'),
        enableBtn: document.getElementById('adminMfaEnableBtn'),
        verifyCode: document.getElementById('adminMfaVerifyCode'),
        verifyBtn: document.getElementById('adminMfaVerifyBtn'),
        recoveryCode: document.getElementById('adminMfaRecoveryCode'),
        recoveryBtn: document.getElementById('adminMfaRecoveryBtn'),
    };

    function setNotice(message = '', type = 'info') {
        if (!refs.notice) return;
        refs.notice.textContent = message || '';
        refs.notice.style.color = type === 'error'
            ? 'var(--color-danger)'
            : type === 'success'
                ? 'var(--color-success)'
                : 'rgba(255, 255, 255, 0.72)';
    }

    function clearSetupFields() {
        if (refs.setupFields) refs.setupFields.style.display = 'none';
        if (refs.secret) refs.secret.value = '';
        if (refs.otpAuthUri) refs.otpAuthUri.value = '';
        if (refs.recoveryCodes) refs.recoveryCodes.textContent = '';
    }

    function setButtonsDisabled(disabled) {
        [
            refs.setupBtn,
            refs.enableBtn,
            refs.verifyBtn,
            refs.recoveryBtn,
        ].forEach((button) => {
            if (button) button.disabled = !!disabled;
        });
    }

    function renderSetup(setup) {
        if (!setup) {
            clearSetupFields();
            return;
        }
        if (refs.secret) refs.secret.value = setup.secret || '';
        if (refs.otpAuthUri) refs.otpAuthUri.value = setup.otpauthUri || '';
        if (refs.recoveryCodes) {
            refs.recoveryCodes.textContent = Array.isArray(setup.recoveryCodes)
                ? setup.recoveryCodes.join('\n')
                : '';
        }
        if (refs.setupFields) refs.setupFields.style.display = '';
    }

    function render(code, status) {
        if (typeof showGate === 'function') showGate();
        clearSetupFields();

        const enrolled = !!status?.enrolled;
        const setupPending = !!status?.setupPending;

        if (code === 'admin_mfa_enrollment_required') {
            refs.title.textContent = 'Admin MFA Enrollment Required';
            refs.text.textContent = setupPending
                ? 'Finish the pending authenticator setup or generate a fresh secret and recovery code set.'
                : 'Set up an authenticator app and recovery codes before the admin dashboard can be used.';
        } else if (code === 'admin_mfa_invalid_or_expired') {
            refs.title.textContent = 'Admin MFA Verification Required';
            refs.text.textContent = 'Your admin MFA proof is invalid or expired. Verify with a current authenticator code or a recovery code to continue.';
        } else {
            refs.title.textContent = 'Admin MFA Verification Required';
            refs.text.textContent = 'Verify with a current authenticator code or a recovery code to continue.';
        }

        refs.enrollmentBlock.style.display = enrolled ? 'none' : '';
        refs.verifyBlock.style.display = enrolled ? '' : 'none';

        if (!enrolled) {
            refs.setupBtn.textContent = setupPending ? 'Regenerate setup secret' : 'Generate setup secret';
            refs.enableCode.value = '';
            setNotice(
                setupPending
                    ? 'If you already saved the setup secret, enter a current authenticator code below. Otherwise generate a fresh setup secret and recovery codes now.'
                    : 'Generate a setup secret, add it to your authenticator app, then confirm with a current code to enable MFA.',
                'info'
            );
        } else {
            refs.verifyCode.value = '';
            refs.recoveryCode.value = '';
            setNotice(
                code === 'admin_mfa_invalid_or_expired'
                    ? 'Verify again to renew admin access.'
                    : 'Admin access stays locked until MFA verification succeeds.',
                'info'
            );
        }
    }

    async function refresh(code) {
        const status = await apiAdminMfaStatus();
        if (status.ok) {
            render(code, status.data?.mfa || null);
            return;
        }
        render(code, status.data?.mfa || null);
        setNotice(status.error || 'Failed to load MFA status.', 'error');
    }

    async function reloadAfterMfa(successMessage) {
        if (successMessage && typeof showToast === 'function') showToast(successMessage, 'success');
        if (typeof reload === 'function') reload();
        else window.location.reload();
    }

    async function handleSetupClick() {
        setButtonsDisabled(true);
        setNotice('Generating a new setup secret...', 'info');
        try {
            const res = await apiAdminMfaSetup();
            if (!res.ok) {
                setNotice(res.error || 'Failed to generate an MFA setup secret.', 'error');
                return;
            }
            render('admin_mfa_enrollment_required', {
                ...(res.data?.mfa || {}),
                enrolled: false,
                verified: false,
                setupPending: true,
            });
            renderSetup(res.data?.setup || null);
            setNotice('Setup secret and recovery codes generated. Save them now, then enter a current authenticator code to enable MFA.', 'success');
        } finally {
            setButtonsDisabled(false);
        }
    }

    async function handleEnableClick() {
        setButtonsDisabled(true);
        setNotice('Verifying setup code...', 'info');
        try {
            const res = await apiAdminMfaEnable(refs.enableCode.value.trim());
            if (!res.ok) {
                setNotice(res.error || 'Failed to enable admin MFA.', 'error');
                return;
            }
            await reloadAfterMfa('Admin MFA enabled.');
        } finally {
            setButtonsDisabled(false);
        }
    }

    async function handleVerifyClick(mode) {
        setButtonsDisabled(true);
        setNotice(
            mode === 'recovery'
                ? 'Validating recovery code...'
                : 'Validating authenticator code...',
            'info'
        );
        try {
            const res = await apiAdminMfaVerify(
                mode === 'recovery'
                    ? { recoveryCode: refs.recoveryCode.value.trim() }
                    : { code: refs.verifyCode.value.trim() }
            );
            if (!res.ok) {
                setNotice(res.error || 'Failed to verify admin MFA.', 'error');
                return;
            }
            await reloadAfterMfa('Admin MFA verified.');
        } finally {
            setButtonsDisabled(false);
        }
    }

    function bind() {
        if (!refs.gate || refs.gate.dataset.bound === '1') return;
        refs.gate.dataset.bound = '1';

        refs.setupBtn?.addEventListener('click', () => {
            handleSetupClick().catch((error) => {
                console.warn(error);
                setNotice('Failed to generate an MFA setup secret.', 'error');
                setButtonsDisabled(false);
            });
        });
        refs.enableBtn?.addEventListener('click', () => {
            handleEnableClick().catch((error) => {
                console.warn(error);
                setNotice('Failed to enable admin MFA.', 'error');
                setButtonsDisabled(false);
            });
        });
        refs.verifyBtn?.addEventListener('click', () => {
            handleVerifyClick('totp').catch((error) => {
                console.warn(error);
                setNotice('Failed to verify admin MFA.', 'error');
                setButtonsDisabled(false);
            });
        });
        refs.recoveryBtn?.addEventListener('click', () => {
            handleVerifyClick('recovery').catch((error) => {
                console.warn(error);
                setNotice('Failed to verify the recovery code.', 'error');
                setButtonsDisabled(false);
            });
        });
    }

    return {
        bind,
        refresh,
    };
}
