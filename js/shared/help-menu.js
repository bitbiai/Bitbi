import { getCurrentLocale, localizedHref } from './locale.js?v=__ASSET_VERSION__';

const HELP_ROOT_ID = 'bitbiHelpMenu';
const HELP_TRIGGER_ID = 'bitbiHelpTrigger';
const HELP_PANEL_ID = 'bitbiHelpPanel';
const HELP_TITLE_ID = 'bitbiHelpTitle';

const LABELS = Object.freeze({
    en: Object.freeze({
        open: 'Open help menu',
        close: 'Close help menu',
        eyebrow: 'Help',
        title: 'BITBI help',
        intro: 'Quick answers for the current page and the wider workspace.',
    }),
    de: Object.freeze({
        open: 'Hilfemenü öffnen',
        close: 'Hilfemenü schließen',
        eyebrow: 'Hilfe',
        title: 'BITBI-Hilfe',
        intro: 'Kurze Antworten zur aktuellen Seite und zum Arbeitsbereich.',
    }),
});

const ROUTE_SECTION_ORDER = Object.freeze({
    home: Object.freeze(['start', 'generate', 'credits', 'assets', 'profile', 'recovery']),
    pricing: Object.freeze(['credits', 'start', 'generate', 'assets', 'profile', 'recovery']),
    'generate-lab': Object.freeze(['generate', 'credits', 'assets', 'start', 'profile', 'recovery']),
    assets: Object.freeze(['assets', 'generate', 'credits', 'profile', 'recovery', 'start']),
    credits: Object.freeze(['credits', 'generate', 'assets', 'profile', 'start', 'recovery']),
    profile: Object.freeze(['profile', 'credits', 'assets', 'generate', 'recovery', 'start']),
    recovery: Object.freeze(['recovery', 'profile', 'start', 'credits', 'generate', 'assets']),
    admin: Object.freeze(['admin', 'profile', 'credits', 'assets', 'generate', 'recovery', 'start']),
});

export const HELP_MENU_SECTIONS = Object.freeze([
    Object.freeze({
        id: 'start',
        routes: Object.freeze(['home', 'pricing']),
        title: Object.freeze({ en: 'How BITBI works', de: 'So funktioniert BITBI' }),
        summary: Object.freeze({
            en: 'Browse publicly, then move useful work into an account-bound workspace.',
            de: 'Öffentlich stöbern und nützliche Arbeiten danach in den kontogebundenen Arbeitsbereich bringen.',
        }),
        items: Object.freeze([
            Object.freeze({
                id: 'browse-public-work',
                title: Object.freeze({ en: 'Browse public work', de: 'Öffentliche Arbeiten ansehen' }),
                summary: Object.freeze({
                    en: 'Gallery, Video, and Sound Lab stay open for public browsing before you sign in.',
                    de: 'Galerie, Video und Sound Lab bleiben zum öffentlichen Stöbern offen, bevor Sie sich anmelden.',
                }),
                detail: Object.freeze({
                    en: 'Use the public pages for orientation, then switch into the workspace when you want to create, save, or review account context.',
                    de: 'Nutzen Sie die öffentlichen Seiten zur Orientierung und wechseln Sie in den Arbeitsbereich, wenn Sie erstellen, speichern oder Kontokontext prüfen möchten.',
                }),
            }),
            Object.freeze({
                id: 'create-save-review',
                title: Object.freeze({ en: 'Create, save, review', de: 'Erstellen, speichern, prüfen' }),
                summary: Object.freeze({
                    en: 'Create in Generate Lab, save in Assets Manager, then review Credits and Profile.',
                    de: 'Im Generate Lab erstellen, im Assets Manager speichern und danach Credits und Profil prüfen.',
                }),
                detail: Object.freeze({
                    en: 'Generate Lab is where you create. Assets Manager keeps saved output. Credits and Profile help you check balance, Pro context, recovery, and account settings.',
                    de: 'Im Generate Lab erstellen Sie. Der Assets Manager hält gespeicherte Ergebnisse. Credits und Profil helfen bei Kontostand, Pro-Kontext, Wiederherstellung und Kontoeinstellungen.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Generate Lab', de: 'Generate Lab öffnen' }), path: '/generate-lab/', suffix: '?source=help&step=create' }),
                    Object.freeze({ label: Object.freeze({ en: 'Open Assets Manager', de: 'Assets Manager öffnen' }), path: '/account/assets-manager.html', suffix: '?source=help' }),
                    Object.freeze({ label: Object.freeze({ en: 'Review Credits', de: 'Credits prüfen' }), path: '/account/credits.html', suffix: '?source=help' }),
                ]),
            }),
            Object.freeze({
                id: 'account-actions',
                title: Object.freeze({
                    en: 'Sign in, create account, reset password',
                    de: 'Anmelden, Konto erstellen, Passwort zurücksetzen',
                }),
                summary: Object.freeze({
                    en: 'Account is needed for saving and credits; public browsing stays available without one.',
                    de: 'Konto wird zum Speichern und für Credits benötigt; öffentliches Stöbern bleibt ohne Konto möglich.',
                }),
                detail: Object.freeze({
                    en: 'Sign in or create an account before generation, saving, checkout context, or workspace recovery. If access is blocked, start with password reset.',
                    de: 'Melden Sie sich an oder erstellen Sie ein Konto vor Generierung, Speichern, Checkout-Kontext oder Wiederherstellung. Wenn der Zugriff blockiert ist, starten Sie mit Passwort-Reset.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Sign in', de: 'Anmelden' }), path: '/account/profile.html', suffix: '?source=help' }),
                    Object.freeze({ label: Object.freeze({ en: 'Create account', de: 'Konto erstellen' }), path: '/account/profile.html', suffix: '?source=help&mode=register' }),
                    Object.freeze({ label: Object.freeze({ en: 'Reset password', de: 'Passwort zurücksetzen' }), path: '/account/forgot-password.html', suffix: '?source=help' }),
                ]),
            }),
        ]),
    }),
    Object.freeze({
        id: 'generate',
        routes: Object.freeze(['generate-lab', 'home', 'pricing']),
        title: Object.freeze({ en: 'Generate Lab', de: 'Generate Lab' }),
        summary: Object.freeze({
            en: 'Create images, video, or music with backend-confirmed credit checks.',
            de: 'Bilder, Video oder Musik mit backendbestätigten Credit-Prüfungen erstellen.',
        }),
        items: Object.freeze([
            Object.freeze({
                id: 'generate-costs',
                title: Object.freeze({ en: 'Credits before submit', de: 'Credits vor dem Senden' }),
                summary: Object.freeze({
                    en: 'The UI can estimate cost, but the backend makes the final credit decision.',
                    de: 'Die Oberfläche kann Kosten schätzen, die endgültige Credit-Entscheidung trifft aber das Backend.',
                }),
                detail: Object.freeze({
                    en: 'If the balance looks stale or unknown, open Credits, refresh, then retry generation.',
                    de: 'Wenn der Kontostand veraltet oder unbekannt wirkt, öffnen Sie Credits, aktualisieren Sie und starten Sie danach erneut.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Review Credits', de: 'Credits prüfen' }), path: '/account/credits.html', suffix: '?source=help-generate' }),
                ]),
            }),
            Object.freeze({
                id: 'generate-first-run',
                title: Object.freeze({ en: 'First Generate Lab run', de: 'Erster Generate-Lab-Lauf' }),
                summary: Object.freeze({
                    en: 'Choose a model, write the prompt, review the estimate, then generate a preview.',
                    de: 'Modell wählen, Prompt schreiben, Schätzung prüfen und dann eine Vorschau generieren.',
                }),
                detail: Object.freeze({
                    en: 'Sign in before generation or saving. Save only outputs you want to keep; if saving fails, leave the result visible and retry before leaving the page.',
                    de: 'Vor Generierung oder Speichern anmelden. Speichern Sie nur Ergebnisse, die bleiben sollen; wenn Speichern fehlschlägt, Ergebnis sichtbar lassen und vor dem Verlassen erneut versuchen.',
                }),
            }),
            Object.freeze({
                id: 'generate-save',
                title: Object.freeze({ en: 'Where saved outputs go', de: 'Wo gespeicherte Ergebnisse landen' }),
                summary: Object.freeze({
                    en: 'Saved images, videos, and tracks live in Assets Manager for preview, folders, publishing, and cleanup.',
                    de: 'Gespeicherte Bilder, Videos und Tracks liegen im Assets Manager für Vorschau, Ordner, Veröffentlichung und Aufräumen.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Assets Manager', de: 'Assets Manager öffnen' }), path: '/account/assets-manager.html', suffix: '?source=help-generate' }),
                ]),
            }),
        ]),
    }),
    Object.freeze({
        id: 'credits',
        routes: Object.freeze(['credits', 'pricing', 'generate-lab']),
        title: Object.freeze({ en: 'Credits & Pro', de: 'Credits & Pro' }),
        summary: Object.freeze({
            en: 'Check account-bound balance, BITBI Pro context, and safe pricing recovery.',
            de: 'Kontogebundenen Stand, BITBI-Pro-Kontext und sichere Pricing-Rückkehr prüfen.',
        }),
        items: Object.freeze([
            Object.freeze({
                id: 'verified-balance',
                title: Object.freeze({ en: 'Verified balance', de: 'Verifizierter Stand' }),
                summary: Object.freeze({
                    en: 'Credits shown in the account area are the place to review balance; generation still validates server-side.',
                    de: 'Credits im Kontobereich sind der Prüfpunkt für den Stand; Generierung validiert weiterhin serverseitig.',
                }),
                detail: Object.freeze({
                    en: 'After pricing or checkout, refresh Credits and trust the loaded balance, Pro status, and ledger. Cancel or error states do not assume a credit grant.',
                    de: 'Nach Pricing oder Checkout Credits aktualisieren und dem geladenen Guthaben, Pro-Status und Ledger vertrauen. Abbruch- oder Fehlerzustände setzen keine Credit-Gutschrift voraus.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Pricing', de: 'Pricing öffnen' }), path: '/pricing.html', suffix: '#pricingOffers' }),
                ]),
            }),
            Object.freeze({
                id: 'credit-generation-flow',
                title: Object.freeze({ en: 'Before Generate Lab', de: 'Vor Generate Lab' }),
                summary: Object.freeze({
                    en: 'Review Credits when balance is low or unknown, then create with backend validation.',
                    de: 'Credits prüfen, wenn das Guthaben niedrig oder unbekannt ist, und danach mit Backend-Validierung erstellen.',
                }),
                detail: Object.freeze({
                    en: 'Credits are account-bound and consumed by generation. Saved output is managed in Assets Manager; storage guidance lives in the Assets Manager help section.',
                    de: 'Credits sind konto-gebunden und werden durch Generierung verbraucht. Gespeicherte Ergebnisse werden im Assets Manager verwaltet; Speicherhinweise stehen im Assets-Manager-Hilfebereich.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Generate Lab', de: 'Generate Lab öffnen' }), path: '/generate-lab/', suffix: '?source=help-credits&step=create' }),
                    Object.freeze({ label: Object.freeze({ en: 'Open Assets Manager', de: 'Assets Manager öffnen' }), path: '/account/assets-manager.html', suffix: '?source=help-credits&recent=1#generate-lab-recent' }),
                ]),
            }),
        ]),
    }),
    Object.freeze({
        id: 'assets',
        routes: Object.freeze(['assets', 'generate-lab']),
        title: Object.freeze({ en: 'Assets Manager', de: 'Assets Manager' }),
        summary: Object.freeze({
            en: 'Manage saved creations, folders, selection actions, and publishing from one workspace.',
            de: 'Gespeicherte Kreationen, Ordner, Auswahlaktionen und Veröffentlichung an einem Ort verwalten.',
        }),
        items: Object.freeze([
            Object.freeze({
                id: 'saved-output-recovery',
                title: Object.freeze({ en: 'Find saved output', de: 'Gespeicherte Ergebnisse finden' }),
                summary: Object.freeze({
                    en: 'Saved Generate Lab output appears in Assets Manager after account save completes.',
                    de: 'Gespeicherte Generate-Lab-Ergebnisse erscheinen im Assets Manager nach abgeschlossenem Konto-Speichern.',
                }),
                detail: Object.freeze({
                    en: 'If a new item looks missing, refresh the library or show all assets because folder views can hide recent saved output.',
                    de: 'Wenn ein neues Element fehlt, aktualisieren Sie die Bibliothek oder zeigen Sie alle Assets an, weil Ordneransichten aktuelle Speicherungen ausblenden können.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Assets Manager', de: 'Assets Manager öffnen' }), path: '/account/assets-manager.html', suffix: '?source=help-assets&recent=1#generate-lab-recent' }),
                    Object.freeze({ label: Object.freeze({ en: 'Open Generate Lab', de: 'Generate Lab öffnen' }), path: '/generate-lab/', suffix: '?source=help-assets&step=create' }),
                ]),
            }),
            Object.freeze({
                id: 'private-publishing',
                title: Object.freeze({ en: 'Private until published', de: 'Privat bis zur Veröffentlichung' }),
                summary: Object.freeze({
                    en: 'Saved media stays private until you publish it to a public BITBI gallery.',
                    de: 'Gespeicherte Medien bleiben privat, bis Sie sie in einer öffentlichen BITBI-Galerie veröffentlichen.',
                }),
            }),
            Object.freeze({
                id: 'storage-vs-credits',
                title: Object.freeze({ en: 'Storage is separate from credits', de: 'Speicher ist getrennt von Credits' }),
                summary: Object.freeze({
                    en: 'Storage quota and credits are separate account concepts.',
                    de: 'Speicherplatz und Credits sind getrennte Konto-Konzepte.',
                }),
                detail: Object.freeze({
                    en: 'Moving or deleting assets changes the library after backend confirmation. Credits are reviewed in Credits and consumed by generation, not folder organization.',
                    de: 'Verschieben oder Löschen ändert die Bibliothek nach Backend-Bestätigung. Credits werden in Credits geprüft und durch Generierung verbraucht, nicht durch Ordnerorganisation.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Review Credits', de: 'Credits prüfen' }), path: '/account/credits.html', suffix: '?source=help-assets' }),
                    Object.freeze({ label: Object.freeze({ en: 'Open Generate Lab', de: 'Generate Lab öffnen' }), path: '/generate-lab/', suffix: '?source=help-assets' }),
                ]),
            }),
            Object.freeze({
                id: 'mobile-asset-actions',
                title: Object.freeze({ en: 'Mobile asset actions', de: 'Mobile Asset-Aktionen' }),
                summary: Object.freeze({
                    en: 'On phones, folder and selection tools stay grouped so the asset context remains visible.',
                    de: 'Auf Smartphones bleiben Ordner- und Auswahlwerkzeuge gebündelt, damit der Asset-Kontext sichtbar bleibt.',
                }),
            }),
        ]),
    }),
    Object.freeze({
        id: 'profile',
        routes: Object.freeze(['profile']),
        title: Object.freeze({ en: 'Profile & security', de: 'Profil & Sicherheit' }),
        summary: Object.freeze({
            en: 'Review account identity, recovery, wallet hints, credits, and workspace routes.',
            de: 'Kontoidentität, Wiederherstellung, Wallet-Hinweise, Credits und Arbeitsbereich-Routen prüfen.',
        }),
        items: Object.freeze([
            Object.freeze({
                id: 'profile-recovery',
                title: Object.freeze({ en: 'Recovery paths', de: 'Wiederherstellung' }),
                summary: Object.freeze({
                    en: 'Use Profile for account context and reset/verification links when access needs attention.',
                    de: 'Nutzen Sie das Profil für Kontokontext und Reset-/Bestätigungslinks, wenn Zugriff Aufmerksamkeit braucht.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Profile Settings', de: 'Profileinstellungen öffnen' }), path: '/account/profile-settings.html', suffix: '?source=help#profileCompletionCard' }),
                ]),
            }),
            Object.freeze({
                id: 'wallet-safety',
                title: Object.freeze({ en: 'Wallet safety', de: 'Wallet-Sicherheit' }),
                summary: Object.freeze({
                    en: 'Wallet linking is an identity hint, not custody; BITBI never asks for seed phrases or private keys.',
                    de: 'Wallet-Verknüpfung ist ein Identitätshinweis, keine Verwahrung; BITBI fragt nie nach Seed-Phrasen oder privaten Schlüsseln.',
                }),
                detail: Object.freeze({
                    en: 'Unlinking removes only the BITBI account connection. Profile, Credits, Generate Lab, and Assets Manager work without a wallet link; if status is unavailable, refresh account status or sign in again before changing wallet links.',
                    de: 'Trennen entfernt nur die BITBI-Konto-Verknüpfung. Profil, Credits, Generate Lab und Assets Manager funktionieren ohne Wallet-Link; wenn der Status fehlt, aktualisieren Sie den Kontostatus oder melden Sie sich erneut an, bevor Sie Wallet-Links ändern.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Profile', de: 'Profil öffnen' }), path: '/account/profile.html', suffix: '?source=help-wallet#walletSectionCard' }),
                ]),
            }),
        ]),
    }),
    Object.freeze({
        id: 'recovery',
        routes: Object.freeze(['recovery', 'profile']),
        title: Object.freeze({ en: 'Recovery', de: 'Wiederherstellung' }),
        summary: Object.freeze({
            en: 'Password reset and email verification are account recovery flows, not instant success claims.',
            de: 'Passwort-Reset und E-Mail-Bestätigung sind Wiederherstellungswege, keine sofortigen Erfolgsaussagen.',
        }),
        items: Object.freeze([
            Object.freeze({
                id: 'reset-verify',
                title: Object.freeze({ en: 'Use the newest link', de: 'Neuesten Link nutzen' }),
                summary: Object.freeze({
                    en: 'Reset or verification links can expire. If a link fails, start from the recovery page again.',
                    de: 'Reset- oder Bestätigungslinks können ablaufen. Wenn ein Link fehlschlägt, starten Sie erneut über die Wiederherstellungsseite.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Reset password', de: 'Passwort zurücksetzen' }), path: '/account/forgot-password.html', suffix: '?source=help-recovery' }),
                ]),
            }),
            Object.freeze({
                id: 'after-recovery',
                title: Object.freeze({ en: 'After recovery', de: 'Nach der Wiederherstellung' }),
                summary: Object.freeze({
                    en: 'Return to the signed-in workspace only after backend-confirmed access repair.',
                    de: 'Erst nach backendbestätigter Wiederherstellung zurück in den angemeldeten Arbeitsbereich wechseln.',
                }),
                detail: Object.freeze({
                    en: 'Password reset only repairs access. Profile, Credits, Generate Lab, and Assets Manager still load from your signed-in account after backend confirmation.',
                    de: 'Das Zurücksetzen des Passworts repariert nur den Zugriff. Profil, Credits, Generate Lab und Assets Manager laden weiter aus Ihrem angemeldeten Konto nach Backend-Bestätigung.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Profile Settings', de: 'Profileinstellungen öffnen' }), path: '/account/profile-settings.html', suffix: '?returnContext=recovery&source=help-recovery#profileCompletionCard' }),
                    Object.freeze({ label: Object.freeze({ en: 'Review Credits', de: 'Credits prüfen' }), path: '/account/credits.html', suffix: '?scope=member&source=help-recovery' }),
                    Object.freeze({ label: Object.freeze({ en: 'Open Generate Lab', de: 'Generate Lab öffnen' }), path: '/generate-lab/', suffix: '?source=help-recovery' }),
                ]),
            }),
        ]),
    }),
    Object.freeze({
        id: 'admin',
        adminOnly: true,
        routes: Object.freeze(['admin']),
        title: Object.freeze({ en: 'Admin & organizations', de: 'Admin & organizations' }),
        summary: Object.freeze({
            en: 'Admin remains English-only. Organization membership controls context without bypassing safety guards.',
            de: 'Admin remains English-only. Organization membership controls context without bypassing safety guards.',
        }),
        items: Object.freeze([
            Object.freeze({
                id: 'org-context',
                title: Object.freeze({ en: 'Organization context', de: 'Organization context' }),
                summary: Object.freeze({
                    en: 'Assigning users to organizations helps select valid context; it does not override tenant isolation, billing, or AI budget safety.',
                    de: 'Assigning users to organizations helps select valid context; it does not override tenant isolation, billing, or AI budget safety.',
                }),
                links: Object.freeze([
                    Object.freeze({ label: Object.freeze({ en: 'Open Admin', de: 'Open Admin' }), path: '/admin/' }),
                ]),
            }),
        ]),
    }),
]);

function textFor(value, locale) {
    if (typeof value === 'string') return value;
    return value?.[locale] || value?.en || '';
}

function getRouteKey(pathname = window.location.pathname) {
    const path = String(pathname || '/').replace(/\/{2,}/g, '/');
    if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
    if (path.includes('/generate-lab')) return 'generate-lab';
    if (path.includes('/account/assets-manager')) return 'assets';
    if (path.includes('/account/credits')) return 'credits';
    if (path.includes('/account/profile')) return 'profile';
    if (path.includes('/account/forgot-password') || path.includes('/account/reset-password') || path.includes('/account/verify-email')) return 'recovery';
    if (path.includes('/pricing')) return 'pricing';
    return 'home';
}

function sectionScore(section, routeKey) {
    if (section.routes?.includes(routeKey)) return 0;
    if (routeKey === 'home' && section.id === 'start') return 0;
    return 1;
}

function sectionRouteRank(section, routeKey) {
    const order = ROUTE_SECTION_ORDER[routeKey] || ROUTE_SECTION_ORDER.home;
    const index = order.indexOf(section.id);
    return index === -1 ? 99 : index;
}

function getSections(routeKey, locale) {
    const isAdmin = routeKey === 'admin';
    return HELP_MENU_SECTIONS
        .filter((section) => !section.adminOnly || isAdmin)
        .slice()
        .sort((a, b) => {
            const scoreDelta = sectionScore(a, routeKey) - sectionScore(b, routeKey);
            if (scoreDelta !== 0) return scoreDelta;
            const rankDelta = sectionRouteRank(a, routeKey) - sectionRouteRank(b, routeKey);
            if (rankDelta !== 0) return rankDelta;
            return textFor(a.title, locale).localeCompare(textFor(b.title, locale));
        });
}

function buildLocalizedHref(link, locale) {
    if (link.path === '/admin/') return link.path;
    return `${localizedHref(link.path, locale)}${link.suffix || ''}`;
}

function createElement(tagName, className, text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function renderLinks(container, links = [], locale) {
    if (!links.length) return;
    const list = createElement('div', 'help-menu__links');
    links.forEach((link) => {
        const anchor = createElement('a', 'help-menu__link', textFor(link.label, locale));
        anchor.href = buildLocalizedHref(link, locale);
        list.append(anchor);
    });
    container.append(list);
}

function renderSections(body, routeKey, locale) {
    body.replaceChildren();
    const sections = getSections(routeKey, locale);

    sections.forEach((section) => {
        const sectionElement = createElement('details', `help-menu__section${section.routes?.includes(routeKey) ? ' is-current' : ''}`);
        sectionElement.dataset.helpSection = section.id;
        sectionElement.setAttribute('aria-labelledby', `bitbiHelpSection-${section.id}`);

        const sectionSummary = createElement('summary', 'help-menu__section-toggle');
        const heading = createElement('span', 'help-menu__section-title', textFor(section.title, locale));
        heading.id = `bitbiHelpSection-${section.id}`;
        heading.setAttribute('role', 'heading');
        heading.setAttribute('aria-level', '3');
        sectionSummary.append(heading);

        const summary = createElement('span', 'help-menu__section-summary', textFor(section.summary, locale));
        sectionSummary.append(summary);
        sectionElement.append(sectionSummary);

        const stack = createElement('div', 'help-menu__items');
        section.items.forEach((item) => {
            const details = createElement('details', 'help-menu__item');

            const itemSummary = createElement('summary', 'help-menu__item-summary');
            itemSummary.append(createElement('span', 'help-menu__item-title', textFor(item.title, locale)));
            itemSummary.append(createElement('span', 'help-menu__item-copy', textFor(item.summary, locale)));
            details.append(itemSummary);

            const itemBody = createElement('div', 'help-menu__item-body');
            if (item.detail) {
                itemBody.append(createElement('p', 'help-menu__item-detail', textFor(item.detail, locale)));
            }
            renderLinks(itemBody, item.links || [], locale);
            if (itemBody.childNodes.length) details.append(itemBody);
            stack.append(details);
        });

        sectionElement.append(stack);
        sectionElement.addEventListener('toggle', () => {
            if (!sectionElement.open) return;
            body.querySelectorAll('.help-menu__section[open]').forEach((openSection) => {
                if (openSection !== sectionElement) {
                    openSection.open = false;
                }
            });
        });
        body.append(sectionElement);
    });
}

export function initHelpMenu() {
    if (typeof document === 'undefined') return null;
    const existing = document.getElementById(HELP_ROOT_ID);
    if (existing) return existing;

    const locale = getCurrentLocale();
    const labels = LABELS[locale] || LABELS.en;
    const routeKey = getRouteKey();
    const root = createElement('div', 'help-menu');
    root.id = HELP_ROOT_ID;
    root.dataset.helpMenu = '';

    const trigger = createElement('button', 'help-menu__trigger', '?');
    trigger.id = HELP_TRIGGER_ID;
    trigger.type = 'button';
    trigger.setAttribute('aria-label', labels.open);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', HELP_PANEL_ID);

    const panel = createElement('aside', 'help-menu__panel');
    panel.id = HELP_PANEL_ID;
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', HELP_TITLE_ID);

    const header = createElement('div', 'help-menu__header');
    const headingWrap = createElement('div', 'help-menu__heading');
    headingWrap.append(createElement('p', 'help-menu__eyebrow', labels.eyebrow));
    const title = createElement('h2', 'help-menu__title', labels.title);
    title.id = HELP_TITLE_ID;
    title.tabIndex = -1;
    headingWrap.append(title);
    headingWrap.append(createElement('p', 'help-menu__intro', labels.intro));

    const closeButton = createElement('button', 'help-menu__close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', labels.close);

    header.append(headingWrap, closeButton);

    const body = createElement('div', 'help-menu__body');
    renderSections(body, routeKey, locale);
    panel.append(header, body);
    root.append(trigger, panel);
    document.body.append(root);

    let lastFocused = null;

    function isOpen() {
        return root.classList.contains('is-open') && !panel.hidden;
    }

    function open() {
        if (isOpen()) return;
        lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panel.hidden = false;
        root.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => title.focus({ preventScroll: true }));
    }

    function close({ restoreFocus = true } = {}) {
        if (!isOpen()) return;
        root.classList.remove('is-open');
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) {
            const focusTarget = lastFocused?.isConnected ? lastFocused : trigger;
            focusTarget.focus({ preventScroll: true });
        }
    }

    trigger.addEventListener('click', () => {
        if (isOpen()) {
            close();
            return;
        }
        open();
    });
    closeButton.addEventListener('click', () => close());

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) {
            event.preventDefault();
            close();
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (!isOpen()) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (panel.contains(target) || trigger.contains(target)) return;
        close({ restoreFocus: false });
    });

    return root;
}
