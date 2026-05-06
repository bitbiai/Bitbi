import {
    getLocalizedUrl,
    getLocaleCookie,
    isGermanPath,
    mapLocalizedPath,
    normalizeLocale,
} from './locale-routing.mjs?v=__ASSET_VERSION__';

export const LOCALE_COOKIE_NAME = 'bitbi_locale';
export const SUPPORTED_LOCALES = Object.freeze(['en', 'de']);

const STRINGS = Object.freeze({
    en: Object.freeze({
        nav: Object.freeze({
            main: 'Main navigation',
            toggleMenu: 'Toggle menu',
            closeMenu: 'Close menu',
            explore: 'Explore',
            connect: 'Connect',
            gallery: 'Gallery',
            video: 'Video',
            soundLab: 'Sound Lab',
            models: 'Models',
            contact: 'Contact',
            mood: 'Mood:',
            creating: 'Creating',
            cookieSettings: 'Cookie Settings',
            language: 'Language',
            languageEnglish: 'English',
            languageGerman: 'Deutsch',
        }),
        legal: Object.freeze({
            imprint: 'Imprint',
            privacy: 'Privacy',
            privacyPolicy: 'Privacy Policy',
            terms: 'Terms',
            datenschutz: 'Datenschutz',
        }),
        footer: Object.freeze({
            tagline: 'My Digital Playground',
            copy: 'BITBI Studio • Built with love & code • © 2026',
        }),
        auth: Object.freeze({
            member: 'Member',
            openProfile: 'Open profile',
            openProfileFor: 'Open profile for {name}',
            profilePhoto: '{name} profile photo',
            signIn: 'Sign In',
            signOut: 'Sign Out',
            profile: 'Profile',
            pricing: 'Pricing',
            admin: 'Admin',
            memberArea: 'Member Area',
            unlock: 'Unlock exclusive content with a free account',
            createAccount: 'Create Account',
            email: 'Email',
            password: 'Password',
            passwordNew: 'Password (min. 8 characters)',
            minPassword: 'Minimum 8 characters',
            signInEthereum: 'Sign In with Ethereum',
            walletHint: 'Connect a linked Ethereum Mainnet wallet to use SIWE sign-in.',
            or: 'or',
            forgotPassword: 'Forgot password?',
            closeAuth: 'Close auth modal',
            close: 'Close',
            fillFields: 'Please fill in all fields.',
            passwordTooShort: 'Password must be at least 8 characters long.',
            signingIn: 'Signing in...',
            creatingAccount: 'Creating account...',
            accountCreated: 'Account created! Please check your inbox (and spam folder) and verify your email address.',
            resend: 'Resend',
            sending: 'Sending...',
            resent: 'Verification email has been resent. Please check your inbox (and spam folder).',
        }),
        cookie: Object.freeze({
            label: 'Cookie preferences',
            title: 'Cookie Preferences',
            desc: 'We use cookies to enhance your experience. Necessary cookies are always active. You can choose to enable analytics and marketing cookies.',
            privacy: 'Privacy Policy',
            necessary: 'Necessary',
            necessaryDesc: 'Required for the website to function (consent storage)',
            analytics: 'Analytics',
            analyticsDesc: 'Performance measurement (Cloudflare RUM)',
            marketing: 'Marketing',
            marketingDesc: 'Optional third-party embeds',
            acceptAll: 'Accept All',
            savePrefs: 'Save Preferences',
            customize: 'Customize',
            hideDetails: 'Hide Details',
            rejectAll: 'Reject All',
        }),
    }),
    de: Object.freeze({
        nav: Object.freeze({
            main: 'Hauptnavigation',
            toggleMenu: 'Menü öffnen',
            closeMenu: 'Menü schließen',
            explore: 'Entdecken',
            connect: 'Kontakt',
            gallery: 'Galerie',
            video: 'Video',
            soundLab: 'Sound Lab',
            models: 'Modelle',
            contact: 'Kontakt',
            mood: 'Modus:',
            creating: 'Kreativ',
            cookieSettings: 'Cookie-Einstellungen',
            language: 'Sprache',
            languageEnglish: 'English',
            languageGerman: 'Deutsch',
        }),
        legal: Object.freeze({
            imprint: 'Impressum',
            privacy: 'Datenschutz',
            privacyPolicy: 'Datenschutzerklärung',
            terms: 'AGB',
            datenschutz: 'Datenschutz',
        }),
        footer: Object.freeze({
            tagline: 'Mein digitaler Spielraum',
            copy: 'BITBI Studio • Entwickelt mit Sorgfalt & Code • © 2026',
        }),
        auth: Object.freeze({
            member: 'Mitglied',
            openProfile: 'Profil öffnen',
            openProfileFor: 'Profil von {name} öffnen',
            profilePhoto: 'Profilfoto von {name}',
            signIn: 'Anmelden',
            signOut: 'Abmelden',
            profile: 'Profil',
            pricing: 'Preise',
            admin: 'Admin',
            memberArea: 'Mitgliederbereich',
            unlock: 'Schalten Sie exklusive Inhalte mit einem kostenlosen Konto frei',
            createAccount: 'Konto erstellen',
            email: 'E-Mail',
            password: 'Passwort',
            passwordNew: 'Passwort (mind. 8 Zeichen)',
            minPassword: 'Mindestens 8 Zeichen',
            signInEthereum: 'Mit Ethereum anmelden',
            walletHint: 'Verbinden Sie eine verknüpfte Ethereum-Mainnet-Wallet für die SIWE-Anmeldung.',
            or: 'oder',
            forgotPassword: 'Passwort vergessen?',
            closeAuth: 'Anmeldedialog schließen',
            close: 'Schließen',
            fillFields: 'Bitte füllen Sie alle Felder aus.',
            passwordTooShort: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
            signingIn: 'Anmeldung läuft...',
            creatingAccount: 'Konto wird erstellt...',
            accountCreated: 'Konto erstellt. Bitte prüfen Sie Ihren Posteingang und Spam-Ordner und bestätigen Sie Ihre E-Mail-Adresse.',
            resend: 'Erneut senden',
            sending: 'Wird gesendet...',
            resent: 'Die Bestätigungs-E-Mail wurde erneut gesendet. Bitte prüfen Sie Ihren Posteingang und Spam-Ordner.',
        }),
        cookie: Object.freeze({
            label: 'Cookie-Einstellungen',
            title: 'Cookie-Einstellungen',
            desc: 'Wir verwenden Cookies und ähnliche Technologien, um notwendige Funktionen bereitzustellen. Optionale Analyse- und Marketing-Speicherungen können Sie selbst aktivieren.',
            privacy: 'Datenschutzerklärung',
            necessary: 'Notwendig',
            necessaryDesc: 'Erforderlich für den Betrieb der Website (Speicherung der Einwilligung)',
            analytics: 'Analyse',
            analyticsDesc: 'Leistungsmessung (Cloudflare RUM)',
            marketing: 'Marketing',
            marketingDesc: 'Optionale Drittanbieter-Einbettungen',
            acceptAll: 'Alle akzeptieren',
            savePrefs: 'Auswahl speichern',
            customize: 'Anpassen',
            hideDetails: 'Details ausblenden',
            rejectAll: 'Alle ablehnen',
        }),
    }),
});

function getCookieHeader() {
    return typeof document === 'undefined' ? '' : document.cookie || '';
}

function cookieSecureSuffix() {
    return typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
}

function format(template, values = {}) {
    return String(template || '').replace(/\{([^}]+)\}/g, (_, key) => values[key] ?? '');
}

export function getCurrentLocale() {
    if (typeof window !== 'undefined' && isGermanPath(window.location.pathname)) return 'de';
    return getLocaleCookie(getCookieHeader()) || 'en';
}

export function localeText(path, values = {}, locale = getCurrentLocale()) {
    const normalized = normalizeLocale(locale) || 'en';
    const segments = String(path || '').split('.');
    let value = STRINGS[normalized];
    for (const segment of segments) value = value?.[segment];
    if (typeof value !== 'string') {
        value = segments.reduce((next, segment) => next?.[segment], STRINGS.en);
    }
    return format(value || path, values);
}

export function setLocalePreference(locale) {
    const normalized = normalizeLocale(locale) || 'en';
    document.cookie = `${LOCALE_COOKIE_NAME}=${normalized}; Path=/; Max-Age=31536000; SameSite=Lax${cookieSecureSuffix()}`;
}

export function localizedHref(path, locale = getCurrentLocale()) {
    return mapLocalizedPath(path, locale);
}

export function currentLanguageHref(locale) {
    if (typeof window === 'undefined') return mapLocalizedPath('/', locale);
    return getLocalizedUrl(`${window.location.pathname}${window.location.search}${window.location.hash}`, locale);
}

export function initLocaleSwitcher(container = document) {
    const targets = container.querySelectorAll('[data-locale-switcher]');
    targets.forEach((target) => {
        target.replaceChildren();
        const locale = getCurrentLocale();
        const wrap = document.createElement('span');
        wrap.className = 'locale-switcher';
        wrap.setAttribute('aria-label', localeText('nav.language'));

        for (const option of SUPPORTED_LOCALES) {
            const link = document.createElement('a');
            link.href = currentLanguageHref(option);
            link.className = `locale-switcher__link${locale === option ? ' is-active' : ''}`;
            link.lang = option;
            link.hreflang = option;
            link.textContent = option === 'de' ? 'DE' : 'EN';
            link.setAttribute('aria-label', option === 'de'
                ? localeText('nav.languageGerman')
                : localeText('nav.languageEnglish'));
            if (locale === option) link.setAttribute('aria-current', 'true');
            link.addEventListener('click', () => setLocalePreference(option));
            wrap.appendChild(link);
        }
        target.appendChild(wrap);
    });
}
