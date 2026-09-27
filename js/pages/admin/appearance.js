import { apiAdminAppearance, apiAdminAppearanceChange } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const COPY = {
    en: {
        title: 'Appearance', subtitle: 'Shared appearance for each part of BITBI', language: 'Appearance language', intro: 'Choose the appearance everyone sees in each part of BITBI.',
        public: 'Public website', publicDescription: 'Homepage, public pages and their dialogs.',
        admin: 'Admin', adminDescription: 'All Admin sections, tools and dialogs.',
        generateLab: 'Generate Lab', generateLabDescription: 'The creation workspace and its asset picker.',
        canvas: 'Canvas', canvasDescription: 'Projects, graph, inspector and dialogs.',
        account: 'Profile & account', accountDescription: 'Profile, Assets Manager and all account pages.',
        light: 'Light', dark: 'Dark', soft: 'Soft', saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…',
        loading: 'Loading appearance settings…', save: 'Save changes', cancel: 'Cancel', reset: 'Reset to initial defaults',
        reload: 'Reload saved settings', discard: 'Discard your unsaved appearance changes and load the saved settings?',
        saveSuccess: 'Appearance saved. Open pages update automatically; their current work stays in place.',
        error: 'Appearance settings could not be loaded. Try again.', saveError: 'Changes were not confirmed. Your selections are preserved. Reload the saved settings before trying again.',
        conflict: 'Another administrator saved newer settings. Your selections are still here. Reload the saved settings to review the latest version before editing again.',
        scope: 'Each choice applies to everyone using that area. Other areas keep their own theme.',
        changes: 'Pending changes', revision: 'Revision', updated: 'Last saved', defaultNotice: 'Initial defaults selected: Dark for every area. Save to apply.',
    },
    de: {
        title: 'Darstellung', subtitle: 'Gemeinsames Erscheinungsbild für jeden BITBI-Bereich', language: 'Sprache der Darstellungseinstellungen', intro: 'Wählen Sie das Erscheinungsbild, das alle Personen im jeweiligen BITBI-Bereich sehen.',
        public: 'Öffentliche Website', publicDescription: 'Startseite, öffentliche Seiten und ihre Dialoge.',
        admin: 'Admin', adminDescription: 'Alle Adminbereiche, Werkzeuge und Dialoge.',
        generateLab: 'Generate Lab', generateLabDescription: 'Erstellungsbereich und zugehörige Asset-Auswahl.',
        canvas: 'Canvas', canvasDescription: 'Projekte, Graph, Inspector und Dialoge.',
        account: 'Profil & Konto', accountDescription: 'Profil, Assets Manager und alle Kontoseiten.',
        light: 'Hell', dark: 'Dunkel', soft: 'Sanft', saved: 'Gespeichert', unsaved: 'Ungespeicherte Änderungen', saving: 'Wird gespeichert…',
        loading: 'Darstellungseinstellungen werden geladen…', save: 'Änderungen speichern', cancel: 'Abbrechen', reset: 'Auf ursprüngliche Standardwerte zurücksetzen',
        reload: 'Gespeicherte Einstellungen laden', discard: 'Ungespeicherte Darstellungsänderungen verwerfen und gespeicherte Einstellungen laden?',
        saveSuccess: 'Darstellung gespeichert. Geöffnete Seiten aktualisieren sich automatisch; laufende Arbeit bleibt erhalten.',
        error: 'Darstellungseinstellungen konnten nicht geladen werden. Versuchen Sie es erneut.', saveError: 'Die Änderungen wurden nicht bestätigt. Ihre Auswahl bleibt erhalten. Laden Sie vor einem erneuten Versuch die gespeicherten Einstellungen.',
        conflict: 'Ein anderer Administrator hat neuere Einstellungen gespeichert. Ihre Auswahl bleibt erhalten. Laden Sie die gespeicherten Einstellungen, um den aktuellen Stand vor weiteren Änderungen zu prüfen.',
        scope: 'Jede Auswahl gilt für alle Personen in diesem Bereich. Andere Bereiche behalten ihr eigenes Design.',
        changes: 'Vorgesehene Änderungen', revision: 'Version', updated: 'Zuletzt gespeichert', defaultNotice: 'Ursprüngliche Standardwerte gewählt: Dunkel für alle Bereiche. Zum Übernehmen speichern.',
    },
};

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function createAdminAppearance() {
    const root = document.getElementById('sectionAppearance');
    const contract = window.BitbiAppearanceContract;
    const keys = Object.keys(contract.DEFAULT_SEGMENTS);
    let locale = document.documentElement.lang === 'de' ? 'de' : 'en';
    let saved = null, draft = null, controller = null, busy = false, blocked = false;
    let status, saveButton, cancelButton, resetButton, language, controls, stateLabel, changes;
    let walletDraft = true, walletInput, walletSave;
    const text = key => COPY[locale][key];
    const dirtyKeys = () => saved ? keys.filter(key => draft[key] !== saved.segments[key]) : [];
    const button = (label, action) => {
        const node = element('button', 'btn-action', label);
        node.type = 'button'; node.addEventListener('click', action); return node;
    };
    function valid(value) {
        try { contract.normalizeAppearance(value); return true; }
        catch { return false; }
    }
    function message(value, error = false) {
        status.textContent = value;
        status.dataset.state = error ? 'error' : 'notice';
        status.setAttribute('role', error ? 'alert' : 'status');
    }
    function update() {
        const changed = dirtyKeys();
        const dirty = changed.length || walletDraft !== (saved.walletEnabled !== false);
        stateLabel.textContent = text(busy ? 'saving' : dirty ? 'unsaved' : 'saved');
        stateLabel.dataset.state = dirty ? 'unsaved' : 'saved';
        saveButton.disabled = busy || blocked || !changed.length;
        cancelButton.disabled = busy || (!changed.length && !blocked && walletDraft === (saved.walletEnabled !== false));
        resetButton.disabled = busy || blocked || keys.every(key => draft[key] === contract.DEFAULT_SEGMENTS[key]);
        language.disabled = busy;
        walletInput.disabled = busy || blocked;
        walletInput.checked = walletDraft;
        walletSave.disabled = busy || blocked || walletDraft === (saved.walletEnabled !== false);
        for (const input of controls) { input.disabled = busy || blocked; input.checked = draft[input.name] === input.value; }
        changes.replaceChildren();
        if (changed.length) {
            changes.append(element('span', 'appearance__muted', `${text('changes')}:`));
            for (const key of changed) changes.append(element('span', '', `${text(key)}: ${text(saved.segments[key])} → ${text(draft[key])}`));
        }
    }
    function render() {
        root.lang = locale; root.setAttribute('aria-label', text('title')); root.replaceChildren();
        document.getElementById('adminHeroTitle').textContent = text('title');
        document.getElementById('adminHeroDesc').textContent = text('subtitle');
        const heading = element('div', 'appearance__heading');
        const intro = element('div'); intro.append(element('p', 'appearance__intro', text('intro')));
        stateLabel = element('span', 'appearance__state'); stateLabel.setAttribute('role', 'status'); intro.append(stateLabel);
        const tools = element('div', 'appearance__tools'); language = element('select'); language.setAttribute('aria-label', text('language'));
        for (const [value, label] of [['en', 'English'], ['de', 'Deutsch']]) {
            const option = element('option', '', label); option.value = value; language.append(option);
        }
        language.value = locale; language.addEventListener('change', () => { locale = language.value; render(); language.focus(); });
        tools.append(language, button(text('reload'), reload)); heading.append(intro, tools); root.append(heading);
        const form = element('form', 'appearance__form'); form.addEventListener('submit', event => { event.preventDefault(); save(); });
        controls = [];
        for (const key of keys) {
            const field = element('fieldset', 'appearance__segment');
            field.dataset.segment = key;
            field.append(element('legend', '', text(key)));
            const description = element('p', 'appearance__muted', text(`${key}Description`)); description.id = `appearance-${key}-description`;
            field.append(description); field.setAttribute('aria-describedby', description.id);
            const choices = element('div', 'appearance__choices');
            for (const mode of contract.THEMES) {
                const label = element('label', 'appearance__choice');
                const input = element('input'); input.type = 'radio'; input.name = key; input.value = mode;
                const sample = element('span', `appearance__sample appearance__sample--${mode}`); sample.setAttribute('aria-hidden', 'true');
                sample.append(element('span', 'appearance__sample-rail'), element('span', 'appearance__sample-card'));
                label.append(input, sample, element('span', '', text(mode))); controls.push(input);
                input.addEventListener('change', () => { draft[key] = mode; message(''); update(); }); choices.append(label);
            }
            field.append(choices); form.append(field);
        }
        root.append(form, element('p', 'appearance__muted', text('scope')));
        const wallet = element('fieldset', 'appearance__segment');
        wallet.append(element('legend', '', 'Panel & Wallet'));
        const walletLabel = element('label', 'appearance__choice');
        walletInput = element('input'); walletInput.type = 'checkbox'; walletInput.id = 'appearanceWalletEnabled';
        walletInput.addEventListener('change', () => { walletDraft = walletInput.checked; message(''); update(); });
        walletLabel.append(walletInput, element('span', '', 'Show wallet Panel and wallet entry points'));
        walletSave = button('Save wallet visibility', saveWallet);
        wallet.append(walletLabel, element('p', 'appearance__muted', 'Applies to everyone. Hiding the wallet does not disconnect wallets, change sign-in sessions, or delete linked accounts and data. Theme settings are saved separately.'), walletSave);
        root.append(wallet);
        changes = element('div', 'appearance__changes'); changes.setAttribute('aria-live', 'polite'); root.append(changes);
        status = element('p', 'appearance__notice'); status.setAttribute('role', 'status'); status.tabIndex = -1; root.append(status);
        const actions = element('div', 'appearance__actions');
        saveButton = button(text('save'), save); saveButton.classList.add('appearance__save');
        cancelButton = button(text('cancel'), () => { if (blocked) load(); else { draft = { ...saved.segments }; walletDraft = saved.walletEnabled !== false; message(''); update(); } });
        resetButton = button(text('reset'), () => { draft = { ...contract.DEFAULT_SEGMENTS }; message(text('defaultNotice')); update(); });
        actions.append(saveButton, cancelButton, resetButton); root.append(actions);
        const metadata = [`${text('revision')} ${saved.revision}`];
        const date = saved.updatedAt ? new Date(saved.updatedAt) : null;
        if (date && Number.isFinite(date.getTime())) metadata.push(`${text('updated')}: ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`);
        root.append(element('p', 'appearance__metadata appearance__muted', metadata.join(' · ')));
        if (blocked) message(text(blocked), true);
        update();
    }
    async function reload() {
        if (busy || ((dirtyKeys().length || walletDraft !== (saved?.walletEnabled !== false)) && !window.confirm(text('discard')))) return;
        await load();
    }
    async function load() {
        controller?.abort(); controller = new AbortController(); const active = controller;
        saved = null; draft = null; busy = false; blocked = false;
        root.replaceChildren(element('p', 'appearance__notice', text('loading')));
        const result = await apiAdminAppearance({ signal: active.signal });
        if (active.signal.aborted) return;
        if (!result.ok || result.data?.ok !== true || !valid(result.data?.appearance)) {
            const error = element('p', 'appearance__notice', text('error')); error.setAttribute('role', 'alert');
            root.replaceChildren(error, button(text('reload'), load)); return;
        }
        saved = result.data.appearance; draft = { ...saved.segments }; walletDraft = saved.walletEnabled !== false; render();
    }
    async function saveWallet() {
        if (busy || blocked || !saved || walletDraft === (saved.walletEnabled !== false)) return;
        busy = true; message(''); update();
        const active = controller, submitted = walletDraft;
        const result = await apiAdminAppearanceChange({ revision: saved.revision, walletEnabled: submitted }, { signal: active.signal });
        if (active.signal.aborted) return;
        busy = false;
        const confirmed = result.data?.appearance;
        if (!result.ok || result.data?.ok !== true || !valid(confirmed) || confirmed.revision <= saved.revision
            || confirmed.walletEnabled !== submitted || keys.some(key => confirmed.segments[key] !== saved.segments[key])) {
            blocked = result.status === 409 ? 'conflict' : 'saveError'; message(text(blocked), true); update(); return;
        }
        saved = confirmed; render(); message(text('saveSuccess'));
        window.BitbiAppearance?.acceptConfirmed?.(confirmed); status.focus();
    }
    async function save() {
        if (busy || blocked || !saved || !dirtyKeys().length) return;
        busy = true; message(''); update();
        const active = controller, submitted = { ...draft };
        const result = await apiAdminAppearanceChange({ revision: saved.revision, segments: submitted }, { signal: active.signal });
        if (active.signal.aborted) return;
        busy = false;
        const confirmed = result.data?.appearance;
        if (!result.ok || result.data?.ok !== true || !valid(confirmed) || confirmed.revision <= saved.revision
            || (confirmed.walletEnabled !== false) !== (saved.walletEnabled !== false) || keys.some(key => confirmed.segments[key] !== submitted[key])) {
            blocked = result.status === 409 ? 'conflict' : 'saveError'; message(text(blocked), true); update(); return;
        }
        saved = confirmed; draft = { ...saved.segments }; render(); message(text('saveSuccess'));
        window.BitbiAppearance?.acceptConfirmed?.(confirmed);
        window.BitbiAppearance?.refresh({ force: true });
        status.focus();
    }
    function dispose() {
        controller?.abort(); controller = null; saved = null; draft = null; busy = false; blocked = false; root.replaceChildren();
    }
    return { load, hide: dispose, destroy: dispose };
}
