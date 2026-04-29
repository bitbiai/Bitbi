const ACTIVE_ORGANIZATION_STORAGE_KEY = 'bitbi.activeOrganizationId';
const ORG_ID_PATTERN = /^org_[A-Za-z0-9._:-]{3,128}$/;

function storage() {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

export function isValidOrganizationId(value) {
    return ORG_ID_PATTERN.test(String(value || '').trim());
}

export function getActiveOrganizationId() {
    const store = storage();
    if (!store) return '';
    const value = String(store.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY) || '').trim();
    return isValidOrganizationId(value) ? value : '';
}

export function setActiveOrganizationId(organizationId) {
    const store = storage();
    if (!store) return '';
    const value = String(organizationId || '').trim();
    if (!isValidOrganizationId(value)) {
        clearActiveOrganizationId();
        return '';
    }
    store.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, value);
    return value;
}

export function clearActiveOrganizationId() {
    const store = storage();
    if (store) store.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
}

export function resolveActiveOrganizationId(organizations = []) {
    const ids = (Array.isArray(organizations) ? organizations : [])
        .map((org) => String(org?.id || '').trim())
        .filter(isValidOrganizationId);
    const stored = getActiveOrganizationId();
    if (stored && ids.includes(stored)) return stored;
    if (stored) clearActiveOrganizationId();
    if (ids.length === 1) return setActiveOrganizationId(ids[0]);
    return '';
}
