/* ============================================================
   BITBI — Admin Control Plane / Tenant Assets Legacy Reset
   Legacy Media Reset status and evidence export UI. Confirmed execution stays blocked.
   ============================================================ */

import {
    apiAdminLegacyMediaResetDryRunExport,
    apiAdminLegacyMediaResetStatus,
} from '../../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    apiUnavailableMessage,
    clear,
    detailRows,
    downloadTextFile,
    el,
    filenameFromContentDisposition,
    readableToken,
    setState,
    setSubmitting,
} from '../core.js?v=__ASSET_VERSION__';

export function createTenantLegacyResetDomain({ notify, formatDate, postCleanupStatusText, tenantExportButtons, tenantIsolationCard }) {
    function renderLegacyMediaResetControl() {
        const card = tenantIsolationCard('reset', 'Legacy Media Reset', 'blocked');
        card.appendChild(el('p', 'admin-shell__desc', 'Confirmed reset may retire public references, queue cleanup, delete first-pass legacy rows, and release storage. The backend gate remains disabled by default and readiness remains blocked.'));
        const summary = el('div', 'admin-inventory');
        const state = el('div', 'admin-state', 'Post-cleanup reset evidence pending. Confirmed execution remains blocked.');
        state.id = 'tenantIsolationResetState';
        state.setAttribute('aria-live', 'polite');
        const statusButton = el('button', 'btn-action', 'Refresh Reset Status');
        statusButton.type = 'button';
        async function loadStatus() {
            const res = await apiAdminLegacyMediaResetStatus();
            if (!res.ok) {
                state.dataset.state = 'error';
                state.textContent = apiUnavailableMessage(res, 'Legacy reset status unavailable.');
                return;
            }
            const status = res.data?.status || {};
            clear(summary);
            summary.appendChild(detailRows([
                ['Dry-run available', status.dryRunAvailable ? 'Yes' : 'No'],
                ['Post-cleanup rebaseline', postCleanupStatusText(status)],
                ['Confirmed gate enabled', status.confirmedExecutionGate?.enabled ? 'Yes' : 'No'],
                ['Sanitized evidence', readableToken(status.sanitizedEvidenceStatus || 'pending')],
                ['Confirmed readiness', readableToken(status.confirmedReadiness || 'blocked')],
                ['Danger approved', status.dangerousOperationsApproved ? 'Unexpected' : 'No'],
                ['Tenant isolation claimed', status.tenantIsolationClaimed ? 'Unexpected' : 'No'],
            ]));
            state.dataset.state = 'neutral';
            state.textContent = 'Legacy reset status loaded. Post-cleanup sanitized evidence remains pending and confirmed execution is blocked.';
        }
        statusButton.addEventListener('click', () => { void loadStatus(); });
        const dryExport = el('button', 'btn-action btn-action--secondary', 'Export Existing Dry-run JSON');
        dryExport.type = 'button';
        dryExport.addEventListener('click', () => exportLegacyMediaResetDryRunJson(dryExport));
        const execute = el('button', 'btn-action btn-action--danger', 'Confirmed Execute Reset');
        execute.type = 'button';
        execute.disabled = true;
        const disabled = el('p', 'admin-shell__desc', 'Disabled by default: gate disabled, sanitized evidence incomplete, backfill/access-switch evidence not reviewed, exact CONFIRMED LEGACY MEDIA RESET confirmation not accepted from this UI state.');
        const actions = el('div', 'admin-control-chip-row');
        actions.append(statusButton, dryExport, tenantExportButtons('reset', state), execute);
        card.append(summary, actions, disabled, state);
        void loadStatus();
        return card;
    }

    async function exportLegacyMediaResetDryRunJson(button) {
        setSubmitting(button, true);
        setState('readinessStatusState', 'Preparing legacy media reset dry-run evidence export...');
        try {
            const res = await apiAdminLegacyMediaResetDryRunExport({ format: 'json', limit: 50 });
            if (!res.ok) {
                setState('readinessStatusState', apiUnavailableMessage(res, 'Legacy reset dry-run export unavailable.'), 'error');
                notify('Legacy reset dry-run export unavailable.', 'error');
                return;
            }
            const fallback = `legacy-media-reset-dry-run-${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '{}\n', res.contentType || 'application/json');
            setState('readinessStatusState', 'Legacy reset dry-run JSON export prepared. No reset or deletion was executed.', 'success');
            notify('Legacy reset dry-run export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    return {
        renderLegacyMediaResetControl,
        exportLegacyMediaResetDryRunJson,
    };
}
