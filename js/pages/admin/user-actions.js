import {
    apiAdminChangeRole,
    apiAdminChangeStatus,
    apiAdminDeleteUser,
    apiAdminRevokeSessions,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    focusElementSafely,
    renderRiskNote,
} from './ui.js?v=__ASSET_VERSION__';

function deleteDialogText(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    return el;
}

function deleteDialogMeta(label, value) {
    const row = document.createElement('div');
    row.className = 'admin-delete-dialog__meta-row';
    row.append(
        deleteDialogText('span', 'admin-delete-dialog__meta-label', label),
        deleteDialogText('span', 'admin-delete-dialog__meta-value', value || 'unknown')
    );
    return row;
}

function openDeleteUserDialog(user) {
    const userId = user?.id || '';
    const email = user?.email || '(no email)';
    const role = user?.role || 'unknown';
    const status = user?.status || 'unknown';
    const confirmationTarget = user?.email || userId;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'admin-delete-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'adminDeleteDialogTitle');
        modal.dataset.testid = 'admin-delete-user-dialog';

        const backdrop = document.createElement('div');
        backdrop.className = 'admin-delete-dialog__backdrop';

        const dialog = document.createElement('div');
        dialog.className = 'admin-delete-dialog__panel glass glass-card';

        const header = document.createElement('div');
        header.className = 'admin-delete-dialog__header';
        const headerText = document.createElement('div');
        const title = deleteDialogText('h2', null, 'Delete user');
        title.id = 'adminDeleteDialogTitle';
        headerText.append(
            deleteDialogText('p', 'admin-delete-dialog__eyebrow', 'Destructive admin action'),
            title
        );
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'admin-credit-modal__close';
        closeBtn.setAttribute('aria-label', 'Cancel user deletion');
        closeBtn.textContent = '×';
        header.append(headerText, closeBtn);

        const body = document.createElement('div');
        body.className = 'admin-delete-dialog__body';

        const identity = document.createElement('div');
        identity.className = 'admin-delete-dialog__identity';
        identity.append(
            deleteDialogMeta('Email', email),
            deleteDialogMeta('User ID', userId),
            deleteDialogMeta('Role', role),
            deleteDialogMeta('Status', status)
        );

        const operationalBlock = document.createElement('div');
        operationalBlock.className = 'admin-delete-dialog__block';
        const retentionWarning = deleteDialogText('p', 'admin-delete-dialog__warning', 'Audit, billing, legal, provider, and retention-governed records may remain or be anonymized under policy. This is not a completed legal/GDPR erasure.');
        retentionWarning.id = 'adminDeleteDialogDescription';
        const frictionWarning = renderRiskNote(
            'The delete request is sent only after the exact confirmation matches. Backend audit logging, deletion lifecycle safeguards, and retention blockers still apply.',
            { title: 'Confirmation required' }
        );
        frictionWarning.id = 'adminDeleteDialogFriction';
        modal.setAttribute('aria-describedby', `${retentionWarning.id} ${frictionWarning.id}`);
        operationalBlock.append(
            deleteDialogText('h3', null, 'Delete operational account only'),
            deleteDialogText('p', null, 'Default mode removes or disables the operational account, sessions, auth tokens, profile, avatar reference, and user-owned AI assets/folders through the guarded deletion lifecycle.'),
            retentionWarning,
            frictionWarning
        );

        const erasureBlock = document.createElement('div');
        erasureBlock.className = 'admin-delete-dialog__block';
        const erasureLabel = document.createElement('label');
        erasureLabel.className = 'admin-delete-dialog__checkbox';
        const erasureCheckbox = document.createElement('input');
        erasureCheckbox.type = 'checkbox';
        erasureCheckbox.dataset.testid = 'admin-delete-erasure-checkbox';
        erasureLabel.append(
            erasureCheckbox,
            deleteDialogText('span', null, 'Also start Data Erasure / GDPR workflow')
        );
        const erasureDetails = document.createElement('div');
        erasureDetails.className = 'admin-delete-dialog__erasure-details';
        erasureDetails.hidden = true;
        erasureDetails.append(
            deleteDialogText('p', null, 'This creates a formal data-erasure workflow for privacy/legal review and evidence. It does not instantly delete retained billing, audit, legal, or provider records.'),
            deleteDialogText('p', null, 'Completion must be reviewed in Data Lifecycle before any final legal erasure claim is made.')
        );
        const erasureAckLabel = document.createElement('label');
        erasureAckLabel.className = 'admin-delete-dialog__field';
        const erasureAckText = deleteDialogText('span', null, 'Type ERASURE WORKFLOW to acknowledge the separate review workflow');
        const erasureAckInput = document.createElement('input');
        erasureAckInput.type = 'text';
        erasureAckInput.autocomplete = 'off';
        erasureAckInput.dataset.testid = 'admin-delete-erasure-ack';
        erasureAckInput.disabled = true;
        erasureAckLabel.append(erasureAckText, erasureAckInput);
        erasureDetails.append(erasureAckLabel);
        erasureBlock.append(erasureLabel, erasureDetails);

        const confirmLabel = document.createElement('label');
        confirmLabel.className = 'admin-delete-dialog__field';
        const confirmText = deleteDialogText('span', null, `Type ${confirmationTarget} to confirm operational deletion`);
        const confirmInput = document.createElement('input');
        confirmInput.type = 'text';
        confirmInput.autocomplete = 'off';
        confirmInput.dataset.testid = 'admin-delete-confirm-input';
        confirmLabel.append(confirmText, confirmInput);

        const footer = document.createElement('div');
        footer.className = 'admin-delete-dialog__actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-secondary';
        cancelBtn.textContent = 'Cancel';
        const submitBtn = document.createElement('button');
        submitBtn.type = 'button';
        submitBtn.className = 'btn-action btn-action--danger';
        submitBtn.textContent = 'Delete user';
        submitBtn.disabled = true;
        submitBtn.dataset.testid = 'admin-delete-submit';
        footer.append(cancelBtn, submitBtn);

        body.append(identity, operationalBlock, erasureBlock, confirmLabel);
        dialog.append(header, body, footer);
        modal.append(backdrop, dialog);

        let settled = false;
        const close = (value) => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKeydown);
            document.body.classList.remove('modal-open');
            modal.remove();
            previousFocus?.focus?.();
            resolve(value);
        };
        const updateSubmitState = () => {
            const targetMatches = confirmInput.value.trim() === confirmationTarget;
            const erasureMatches = !erasureCheckbox.checked
                || erasureAckInput.value.trim() === 'ERASURE WORKFLOW';
            submitBtn.disabled = !(targetMatches && erasureMatches);
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') close({ confirmed: false });
            if (event.key !== 'Tab') return;
            const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), input:not([disabled])'))
                .filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        erasureCheckbox.addEventListener('change', () => {
            erasureDetails.hidden = !erasureCheckbox.checked;
            erasureAckInput.disabled = !erasureCheckbox.checked;
            if (!erasureCheckbox.checked) erasureAckInput.value = '';
            updateSubmitState();
            if (erasureCheckbox.checked) focusElementSafely(erasureAckInput);
        });
        confirmInput.addEventListener('input', updateSubmitState);
        erasureAckInput.addEventListener('input', updateSubmitState);
        cancelBtn.addEventListener('click', () => close({ confirmed: false }));
        closeBtn.addEventListener('click', () => close({ confirmed: false }));
        submitBtn.addEventListener('click', () => {
            if (submitBtn.disabled) return;
            const startDataErasureWorkflow = erasureCheckbox.checked;
            close({
                confirmed: true,
                startDataErasureWorkflow,
                dataErasureWorkflow: startDataErasureWorkflow
                    ? {
                        reason: 'Admin initiated GDPR/data erasure workflow from Admin user deletion.',
                        requestSource: 'admin_delete_user_modal',
                        acknowledgement: 'ERASURE WORKFLOW',
                    }
                    : undefined,
            });
        });
        document.addEventListener('keydown', onKeydown);
        document.body.classList.add('modal-open');
        document.body.appendChild(modal);
        focusElementSafely(confirmInput);
    });
}

export function createAdminUserActions({
    showToast,
    formatApiError,
    getCurrentAdminUser,
    getSearchValue,
    reloadUsers,
    invalidateStats,
} = {}) {
    async function handleChangeRole(userId, newRole) {
        const res = await apiAdminChangeRole(userId, newRole);
        if (res.ok) {
            invalidateStats?.();
            showToast(res.data?.message || 'Role changed', 'success');
            reloadUsers?.(getSearchValue?.() || '');
        } else {
            showToast(res.error, 'error');
        }
    }

    async function handleChangeStatus(userId, newStatus) {
        const res = await apiAdminChangeStatus(userId, newStatus);
        if (res.ok) {
            invalidateStats?.();
            showToast(res.data?.message || 'Status changed', 'success');
            reloadUsers?.(getSearchValue?.() || '');
        } else {
            showToast(res.error, 'error');
        }
    }

    async function handleRevokeSessions(userId) {
        if (!confirm('Revoke all sessions for this user?')) return;
        const res = await apiAdminRevokeSessions(userId);
        if (res.ok) {
            showToast(res.data?.message || 'Sessions revoked', 'success');
        } else {
            showToast(res.error, 'error');
        }
    }

    async function handleDeleteUser(user, event) {
        const userId = user?.id;
        if (!userId) {
            showToast('Cannot delete user: missing user ID.', 'error');
            return;
        }
        const currentAdminUser = getCurrentAdminUser?.();
        if (currentAdminUser?.id && userId === currentAdminUser.id) {
            showToast('You cannot delete the currently signed-in admin account.', 'error');
            return;
        }

        const decision = await openDeleteUserDialog(user);
        if (!decision.confirmed) return;

        const button = event?.currentTarget;
        if (button) button.disabled = true;
        const res = await apiAdminDeleteUser(userId, {
            startDataErasureWorkflow: decision.startDataErasureWorkflow === true,
            dataErasureWorkflow: decision.dataErasureWorkflow,
        });
        if (res.ok) {
            invalidateStats?.();
            const scope = res.data?.operationalDelete?.deletionScope || res.data?.deletionScope;
            const workflow = res.data?.dataErasureWorkflow;
            const scopeText = scope
                ? ' Operational deletion completed. Login, sessions, tokens, profile, and user-owned operational assets were handled; retention-governed records may remain.'
                : '';
            const workflowText = workflow?.started
                ? ` Data Erasure workflow ${workflow.requestId || '(pending id)'} started with ${workflow.status || 'pending_review'} status; review it in Data Lifecycle.`
                : ' Data Erasure workflow was not requested.';
            showToast(res.data?.message || `User deleted.${scopeText}${workflowText}`, 'success');
            if (workflow?.started) {
                location.hash = 'lifecycle';
            }
            reloadUsers?.(getSearchValue?.() || '');
        } else {
            if (button) button.disabled = false;
            showToast(formatApiError(res, 'Failed to delete user.'), 'error');
        }
    }

    return {
        handleChangeRole,
        handleChangeStatus,
        handleRevokeSessions,
        handleDeleteUser,
    };
}
