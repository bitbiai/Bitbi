/* Shared by the early browser bootstrap and Auth's settings boundary. */
(function (root, factory) {
    const contract = factory();
    if (typeof module === 'object' && module.exports) module.exports = contract;
    else root.BitbiAppearanceContract = contract;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    const SEGMENTS = Object.freeze(['public', 'admin', 'generateLab', 'canvas', 'account']);
    const DEFAULT_SEGMENTS = Object.freeze(Object.fromEntries(SEGMENTS.map(key => [key, 'dark'])));
    const PERSONAL_THEMES_ENABLED = false;
    function validateSegments(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).length !== SEGMENTS.length
            || SEGMENTS.some(key => !Object.hasOwn(value, key) || !['light', 'dark'].includes(value[key]))) {
            throw new TypeError('Provide one light or dark theme for each segment.');
        }
        return Object.fromEntries(SEGMENTS.map(key => [key, value[key]]));
    }
    function normalizeAppearance(value) {
        if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
            || value.personalEnabled !== false) throw new TypeError('Unsupported appearance configuration.');
        return { version: 1, revision: value.revision, segments: validateSegments(value.segments), personalEnabled: false };
    }
    function resolveSegment(pathname) {
        let path;
        try { path = new URL(pathname, 'https://bitbi.invalid').pathname.replace(/^\/de(?=\/|$)/, '') || '/'; }
        catch { return 'public'; }
        if (/^\/admin(?:\/|$)/.test(path)) return 'admin';
        if (/^\/generate-lab(?:\/|$)/.test(path)) return 'generateLab';
        if (/^\/canvas(?:\/|$)/.test(path)) return 'canvas';
        if (/^\/(?:account|profile)(?:\/|$)/.test(path)) return 'account';
        return 'public'; // Legal, pricing, landing pages and future public routes.
    }
    // Future preference persistence: {version:1, theme:'light'|'dark'|null}.
    // Only a future separately authorized server gate may pass personalEnabled.
    function resolvePreference({ globalTheme = 'dark', personalPreference, personalEnabled = PERSONAL_THEMES_ENABLED } = {}) {
        if (personalEnabled === true && personalPreference?.version === 1 && ['light', 'dark'].includes(personalPreference.theme)) return personalPreference.theme;
        return ['light', 'dark'].includes(globalTheme) ? globalTheme : 'dark';
    }
    return Object.freeze({ SEGMENTS, DEFAULT_SEGMENTS, PERSONAL_THEMES_ENABLED, validateSegments, normalizeAppearance, resolveSegment, resolvePreference });
});
