import { CANVAS_VOICE_SETTING_FIELDS, canvasVoiceSettings, CANVAS_VOICE_PCM_RATES } from '../../shared/canvas-voice-settings.mjs?v=__ASSET_VERSION__';
const element = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const read = (value, path) => path.split('.').reduce((item, key) => item?.[key], value);
const write = (value, path, next) => { const keys = path.split('.'), key = keys.pop(); keys.reduce((item, name) => item[name], value)[key] = next; };
const button = (text, action) => { const node = element('button', 'canvas-button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
let sequence = 0;
export function createCanvasVoiceSettings({ german, load, save, active, stop }) {
    const t = (de, en) => german ? de : en, lang = german ? 'de' : 'en', id = `canvasVoiceSettings${++sequence}`;
    const dialog = element('dialog', 'canvas-voice-dialog'), title = element('h2', '', t('Voice-Einstellungen', 'Voice settings'));
    title.id = `${id}Title`; dialog.setAttribute('aria-labelledby', title.id);
    const head = element('header', 'canvas-voice-dialog__head'), end = button(t('Sitzung beenden', 'End session'), () => stop()), closeButton = button(t('Schließen', 'Close'), close);
    const status = element('p', 'canvas-voice-dialog__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const body = element('div', 'canvas-voice-dialog__body'), controls = new Map();
    const saveButton = button(t('Einstellungen übernehmen', 'Save settings'), () => void persist()); saveButton.classList.add('canvas-button--primary');
    const reset = button(t('Standardwerte', 'Reset to defaults'), () => { draft = canvasVoiceSettings(); render(); });
    const foot = element('footer', 'canvas-voice-dialog__footer'); foot.append(reset, saveButton);
    head.append(title, end, closeButton); dialog.append(head, status, body, foot); document.body.append(dialog);
    let config = null, draft = null, opener = null, epoch = 0, busy = false;
    const labelFor = value => ({ auto: t('Automatisch', 'Automatic'), high: t('Aktiv', 'Enabled'), none: t('Aus', 'Off'),
        server_vad: t('Automatischer Sprecherwechsel', 'Automatic turn detection'), null: t('Manuell: Sprechen abschließen', 'Manual: finish turn'),
        text: t('Text', 'Text'), audio: t('Audio', 'Audio'), json: 'JSON', binary: t('Binär', 'Binary') })[String(value)] ?? String(value);
    function capabilityReason(field) {
        const caps = config?.capabilities || {}, path = field.path;
        if (field.capability === 'resumption' && caps.resumption !== true) return t('Für dieses Konto nicht freigegeben.', 'Not authorized for this account.');
        const name = path.startsWith('tools.') ? path.split('.')[1] : null;
        if (name && (!caps.tools?.includes(name) || name !== 'canvas' && caps.externalToolBudget !== true)) return t('Werkzeug oder Kostenfreigabe fehlt.', 'Tool or spending authorization is unavailable.');
        if (name && !path.endsWith('.enabled') && !draft.tools[name].enabled) return t('Zuerst das zugehörige Werkzeug aktivieren.', 'Enable the corresponding tool first.');
        if (field.dependsOn === 'server_vad' && draft.turn_detection.type !== 'server_vad') return t('Nur bei automatischem Sprecherwechsel.', 'Requires automatic turn detection.');
        return '';
    }
    function resourceControl(field, value) {
        const group = element('div', 'canvas-voice-resources'); group.setAttribute('role', 'group');
        const items = field.type === 'resources' ? (config.capabilities?.collectionResourceIds || []).map(resourceId => ({ resourceId })) : config.capabilities?.mcpResources || [];
        for (const item of items) {
            const names = field.type === 'resources' ? [item.resourceId] : item.allowed_tools || [];
            for (const name of names) {
                const input = element('input'); input.type = 'checkbox'; input.value = name; input.dataset.resourceId = item.resourceId;
                input.checked = field.type === 'resources' ? value.includes(name) : value.some(row => row.resourceId === item.resourceId && row.allowed_tools.includes(name));
                const label = element('label'); label.append(input, element('span', '', field.type === 'resources' ? item.resourceId : `${item.resourceId} · ${name}`)); group.append(label);
            }
        }
        if (!items.length) group.append(element('p', 'canvas-muted', t('Keine freigegebenen Ressourcen.', 'No approved resources.')));
        return group;
    }
    function inputFor(field) {
        const value = read(draft, field.path), type = field.type;
        if (['resources', 'mcp-resources'].includes(type)) return resourceControl(field, value);
        if (type === 'readonly') return element('output', 'canvas-input', value);
        let input;
        if (type === 'select' || type === 'voice' || type === 'multiselect') {
            input = element('select', 'canvas-input'); input.multiple = type === 'multiselect';
            let options = type === 'voice' ? [...new Set([...(config.capabilities?.voiceIds || ['eve']), value])] : field.options;
            if (field.path.endsWith('.format.rate')) { const codec = read(draft, field.path.replace(/rate$/, 'type')); options = codec === 'audio/pcm' ? CANVAS_VOICE_PCM_RATES : [codec === 'audio/opus' ? 24000 : 8000]; }
            for (const option of options) {
                const node = element('option', '', labelFor(option)); node.value = option === null ? 'null' : String(option);
                node.selected = type === 'multiselect' ? value.includes(option) : value === option;
                if (field.capability && Array.isArray(config.capabilities?.[field.capability])) node.disabled = !config.capabilities[field.capability].includes(option);
                input.append(node);
            }
        } else if (['textarea', 'map', 'list'].includes(type)) {
            input = element('textarea', 'canvas-input'); input.rows = type === 'list' ? 2 : 3;
            input.value = type === 'map' ? Object.entries(value).map(([key, val]) => `${key} = ${val}`).join('\n') : type === 'list' ? value.join('\n') : value;
        } else {
            input = element('input', 'canvas-input'); input.type = type === 'boolean' ? 'checkbox' : type.includes('number') ? 'number' : type === 'date' ? 'date' : 'text';
            if (type === 'boolean') input.checked = value; else input.value = value ?? '';
        }
        for (const key of ['min', 'max', 'step', 'maxLength']) if (field[key] !== undefined && !(key === 'maxLength' && ['list', 'map'].includes(type))) input[key] = field[key];
        return input;
    }
    function collect() {
        const next = structuredClone(draft);
        for (const field of CANVAS_VOICE_SETTING_FIELDS) {
            const input = controls.get(field.path); if (!input || field.type === 'readonly' || input.disabled) continue;
            let value;
            if (field.type === 'boolean') value = input.checked;
            else if (field.type === 'multiselect') value = [...input.selectedOptions].map(option => option.value);
            else if (field.type === 'resources') value = [...input.querySelectorAll('input:checked')].map(node => node.value);
            else if (field.type === 'mcp-resources') {
                const groups = new Map(); for (const node of input.querySelectorAll('input:checked')) { const values = groups.get(node.dataset.resourceId) || []; values.push(node.value); groups.set(node.dataset.resourceId, values); }
                value = [...groups].map(([resourceId, allowed_tools]) => ({ resourceId, allowed_tools }));
            } else if (field.type === 'map') {
                value = {}; for (const line of input.value.split('\n').map(s => s.trim()).filter(Boolean)) { const at = line.indexOf('='); if (at < 1) throw Object.assign(new Error('map'), { path: field.path }); const key = line.slice(0, at).trim(); if (Object.hasOwn(value, key)) throw Object.assign(new Error('duplicate'), { path: field.path }); Object.defineProperty(value, key, { value: line.slice(at + 1).trim(), enumerable: true }); }
            } else if (field.type === 'list') value = input.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            else if (field.type === 'nullable-number') value = input.value === '' ? null : Number(input.value);
            else if (field.type === 'number' || field.path.endsWith('.format.rate')) value = Number(input.value);
            else if (field.path === 'turn_detection.type') value = input.value === 'null' ? null : input.value;
            else value = input.value;
            write(next, field.path, value);
        }
        if (next.turn_detection.type === null) next.turn_detection.idle_timeout_ms = null;
        for (const side of ['input', 'output']) if (next.audio[side].format.type !== 'audio/pcm') next.audio[side].format.rate = next.audio[side].format.type === 'audio/opus' ? 24000 : 8000;
        return next;
    }
    function render() {
        body.replaceChildren(); controls.clear(); end.hidden = !active(); saveButton.disabled = busy || !config; reset.disabled = busy || !config;
        if (!draft) return;
        const groupNames = { voice: t('Stimme und Sprache', 'Voice and language'), behaviour: t('Gesprächsverhalten', 'Conversation'), advanced: t('Audio und Erweitert', 'Audio and advanced'), tools: t('Werkzeuge', 'Tools') };
        for (const [group, name] of Object.entries(groupNames)) {
            const section = element('details', 'canvas-voice-settings__group'); section.open = group === 'voice'; section.append(element('summary', '', name));
            for (const field of CANVAS_VOICE_SETTING_FIELDS.filter(row => row.group === group)) {
                const row = element('div', 'canvas-field'), input = inputFor(field), label = element('label', '', field.label[lang]), hint = element('small', 'canvas-muted');
                input.id = `${id}-${field.path.replaceAll('.', '-')}`; label.htmlFor = input.id; input.dataset.voiceSetting = field.path;
                if (['resources', 'mcp-resources'].includes(field.type)) { label.id = `${input.id}-label`; input.setAttribute('aria-labelledby', label.id); }
                const reason = capabilityReason(field); if (reason) { input.disabled = true; for (const child of input.querySelectorAll('input')) child.disabled = true; hint.textContent = reason; }
                if (field.path === 'voice') hint.textContent = t('Eigene xAI-Stimmen sind derzeit nur in den USA außer Illinois verfügbar. Für Bitbi ist dafür keine Kontofreigabe bestätigt; hier erscheinen ausschließlich freigegebene Stimmen.', 'Custom xAI voices are currently available only in the US except Illinois. Account authorization has not been confirmed for Bitbi; only approved voices appear here.');
                if (field.path.endsWith('.format.type')) hint.textContent ||= t('Nicht verfügbare Codecs sind deaktiviert: Konto-, Browser- oder Transportfreigabe fehlt.', 'Unavailable codecs are disabled: account, browser or transport authorization is missing.');
                if (field.path === 'resumption.enabled') hint.textContent = t('Mit dieser Option speichert xAI Transkripte und Werkzeugergebnisse zur Fortsetzung bis zu 30 Minuten nach Inaktivität. Eine neue Verbindung braucht immer eine neue Kostenfreigabe; es gibt keinen automatischen Wiederverbindungsversuch.', 'With this option, xAI retains transcripts and tool results for resumption until 30 minutes of inactivity. Every new connection requires fresh cost approval; there is no automatic reconnection.') + (reason ? ` ${reason}` : '');
                if (field.path.startsWith('response.')) hint.textContent ||= t('Gilt für manuell abgeschlossene Beiträge und Antworten nach Werkzeugaufrufen; nicht für automatisch erkannte Sprecherwechsel.', 'Applies to manually completed turns and responses after tool calls; not to automatic turn detection.');
                if (field.type === 'map') hint.textContent ||= t('Eine Ersetzung pro Zeile: Wort = Aussprache.', 'One replacement per line: word = pronunciation.');
                if (field.type === 'list') hint.textContent ||= t('Ein Eintrag pro Zeile.', 'One entry per line.');
                if (field.native === false) hint.textContent ||= t('Lokale Mikrofoneinstellung; Browser und Gerät entscheiden über Unterstützung.', 'Local microphone preference; support depends on browser and device.');
                if (hint.textContent) { hint.id = `${input.id}-hint`; input.setAttribute('aria-describedby', hint.id); }
                controls.set(field.path, input); row.append(label, input, hint); section.append(row);
                input.addEventListener('change', () => { if (field.path.endsWith('.enabled') || field.path.endsWith('.format.type') || field.path === 'turn_detection.type') { try { draft = collect(); const opened = [...body.querySelectorAll('details')].map(node => node.open); render(); [...body.querySelectorAll('details')].forEach((node, i) => { node.open = opened[i]; }); controls.get(field.path)?.focus(); } catch { /* Keep incomplete edits until explicit Save validation. */ } } });
            }
            body.append(section);
        }
    }
    async function open(origin) {
        if (dialog.open) return; opener = origin || document.activeElement; const current = ++epoch; busy = true; config = draft = null; render(); status.textContent = t('Lädt …', 'Loading…'); dialog.showModal(); closeButton.focus();
        const result = await load(); if (epoch !== current || !dialog.open) return; busy = false;
        if (!result?.settings) { status.textContent = t('Einstellungen konnten nicht geladen werden.', 'Settings could not be loaded.'); render(); return; }
        config = result; draft = structuredClone(result.settings); status.textContent = t('Änderungen gelten ab der nächsten Sitzung. Speichern startet keine Aufnahme.', 'Changes apply to the next session. Saving does not start recording.'); render();
    }
    function close() { epoch++; if (dialog.open) dialog.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }
    async function persist() {
        if (busy || !config) return; let settings;
        try { settings = canvasVoiceSettings(collect()); }
        catch (error) { let path = typeof error.path === 'string' ? error.path : ''; while (path && !controls.has(path)) path = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : ''; const control = controls.get(path); control?.setAttribute('aria-invalid', 'true'); control?.focus(); status.textContent = t('Bitte prüfen Sie die markierte Einstellung und ihre Eingabegrenzen.', 'Check the highlighted setting and its input limits.'); return; }
        busy = true; saveButton.disabled = true; const current = epoch, result = await save(settings, config.revision);
        if (current !== epoch) return; busy = false; saveButton.disabled = false;
        if (!result?.settings) { status.textContent = t('Nicht gespeichert. Einstellungen neu öffnen und erneut prüfen.', 'Not saved. Reopen settings and review the current configuration.'); return; }
        config = result; draft = structuredClone(result.settings); render(); status.textContent = active() ? t('Gespeichert. Die laufende Sitzung behält ihre Einstellungen; bitte beenden und neu starten.', 'Saved. The current session keeps its settings; end it and start again to apply changes.') : t('Gespeichert und für die nächste Sitzung übernommen.', 'Saved for the next session.');
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.addEventListener('keydown', event => event.stopPropagation());
    return { open, close, refreshState() { end.hidden = !active(); }, destroy() { close(); dialog.remove(); } };
}
