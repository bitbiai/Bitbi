import { publicContextForPath } from './website-assistant-context.mjs?v=__ASSET_VERSION__';

const API = '/api/public/assistant';
const MAX_RESPONSE_CHARS = 12000;
const MAX_STREAM_CHARS = 100000;
const COPY = {
    en: {
        title: 'Ask BITBI', badge: 'AI assistant', notice: 'Public product help. Do not enter personal information, passwords or private prompts. Answers may be incorrect; check the sources.',
        question: 'Your question about BITBI', placeholder: 'How can I get started?', send: 'Send', stop: 'Stop response', clear: 'Clear conversation', suggestions: 'Questions for this page',
        conversation: 'Conversation', you: 'You', assistant: 'BITBI assistant', thinking: 'Preparing an answer…', complete: 'Answer complete.', stopped: 'Response stopped. Your question is preserved.',
        sources: 'BITBI sources', privacy: 'Privacy information', unavailable: 'The assistant is unavailable. You can still use the help below.',
        error: 'The answer could not be completed. Your question is preserved. You can try again.', rate: 'Too many requests. Please wait before sending another question.',
        budget: 'The assistant has reached its usage limit. Please use the help below.', changed: 'The page or help content changed. Your conversation was cleared.',
    },
    de: {
        title: 'BITBI fragen', badge: 'KI-Assistent', notice: 'Öffentliche Produkthilfe. Bitte keine persönlichen Daten, Passwörter oder privaten Prompts eingeben. Antworten können falsch sein; prüfen Sie die Quellen.',
        question: 'Ihre Frage zu BITBI', placeholder: 'Wie kann ich anfangen?', send: 'Senden', stop: 'Antwort stoppen', clear: 'Gespräch löschen', suggestions: 'Fragen zu dieser Seite',
        conversation: 'Gespräch', you: 'Sie', assistant: 'BITBI-Assistent', thinking: 'Antwort wird vorbereitet…', complete: 'Antwort vollständig.', stopped: 'Antwort gestoppt. Ihre Frage bleibt erhalten.',
        sources: 'BITBI-Quellen', privacy: 'Datenschutzhinweise', unavailable: 'Der Assistent ist nicht verfügbar. Die Hilfe unten bleibt nutzbar.',
        error: 'Die Antwort konnte nicht abgeschlossen werden. Ihre Frage bleibt erhalten. Sie können es erneut versuchen.', rate: 'Zu viele Anfragen. Bitte warten Sie vor der nächsten Frage.',
        budget: 'Das Nutzungslimit des Assistenten ist erreicht. Bitte verwenden Sie die Hilfe unten.', changed: 'Die Seite oder der Hilfeinhalt hat sich geändert. Das Gespräch wurde gelöscht.',
    },
};

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function context() {
    return publicContextForPath(window.location.pathname, window.location.hash);
}

function contextKey(value) {
    return value ? `${value.pageId}:${value.language}` : '';
}

function safeSource(value) {
    if (!value || typeof value.title !== 'string' || value.title.length > 200 || typeof value.url !== 'string') return null;
    try {
        const url = new URL(value.url, window.location.origin);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search) return null;
        if (url.origin !== window.location.origin && url.origin !== 'https://bitbi.ai') return null;
        if (!publicContextForPath(url.pathname)) return null;
        return { title: value.title, url: `${url.pathname}${url.hash}` };
    } catch { return null; }
}

function parseConfig(value) {
    if (value?.enabled !== true || typeof value.contentVersion !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.contentVersion)) return null;
    if (!Array.isArray(value.suggestions) || ![0, 3].includes(value.suggestions.length)) return null;
    const suggestions = value.suggestions.map(item => typeof item?.id === 'string' && typeof item.question === 'string' && item.question.length > 0 && item.question.length <= 240 ? { id: item.id, question: item.question } : null);
    if (suggestions.some(item => !item) || new Set(suggestions.map(item => item.id)).size !== suggestions.length) return null;
    if (value.configRevision !== undefined && (!Number.isSafeInteger(value.configRevision) || value.configRevision < 0)) return null;
    if (value.greeting !== undefined && (typeof value.greeting !== 'string' || value.greeting.length > 240)) return null;
    if (!Number.isInteger(value.limits?.inputChars) || value.limits.inputChars < 1 || value.limits.inputChars > 2000 || !Number.isInteger(value.limits?.historyMessages) || value.limits.historyMessages < 0 || value.limits.historyMessages > 6) return null;
    return { contentVersion: value.contentVersion, configRevision: value.configRevision ?? 0,
        greeting: value.greeting || '', suggestions, limits: value.limits };
}

async function readEvents(response, signal, onEvent) {
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('provider_error');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', count = 0;
    try {
        while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            count += chunk.length;
            if (count > MAX_STREAM_CHARS) throw new Error('provider_error');
            buffer += chunk;
            let boundary;
            while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
                const record = buffer.slice(0, boundary);
                const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
                buffer = buffer.slice(boundary + separator.length);
                const lines = record.split(/\r?\n/);
                const name = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
                const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                if (name && data) onEvent(name, JSON.parse(data));
            }
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** Mounted only inside the existing Help panel. No browser storage or account API. */
export function initWebsiteAssistant({ container }) {
    let current = context(), config = null, configController = null, request = null;
    let generation = 0, opened = true, history = [], retryAt = 0;
    const suggestionCache = new Map();
    let labels = COPY[current?.language] || COPY.en;
    const card = element('section', 'website-assistant');
    card.hidden = true;
    card.dataset.websiteAssistant = '';
    card.setAttribute('aria-labelledby', 'websiteAssistantTitle');
    const heading = element('h3', 'website-assistant__title');
    heading.id = 'websiteAssistantTitle';
    const badge = element('span', 'website-assistant__badge');
    const greeting = element('p', 'website-assistant__greeting');
    const notice = element('p', 'website-assistant__notice');
    const privacy = element('a', 'website-assistant__privacy');
    const suggestions = element('div', 'website-assistant__suggestions');
    suggestions.setAttribute('role', 'group');
    const messages = element('ol', 'website-assistant__messages');
    const form = element('form', 'website-assistant__form');
    const label = element('label', 'website-assistant__label');
    label.htmlFor = 'websiteAssistantQuestion';
    const input = element('textarea', 'website-assistant__input');
    input.id = 'websiteAssistantQuestion';
    input.rows = 2;
    input.required = true;
    input.maxLength = 2000;
    input.autocomplete = 'off';
    const status = element('p', 'website-assistant__status');
    status.id = 'websiteAssistantStatus';
    status.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', status.id);
    const actions = element('div', 'website-assistant__actions');
    const send = element('button', 'website-assistant__send');
    send.type = 'submit';
    const stop = element('button', 'website-assistant__stop');
    stop.type = 'button';
    stop.hidden = true;
    const clear = element('button', 'website-assistant__clear');
    clear.type = 'button';
    actions.append(send, stop, clear);
    form.append(label, input, actions, status);
    card.append(heading, badge, greeting, notice, privacy, suggestions, messages, form);
    container.prepend(card);

    function localize() {
        labels = COPY[current?.language] || COPY.en;
        heading.textContent = labels.title;
        badge.textContent = labels.badge;
        notice.textContent = labels.notice;
        privacy.textContent = labels.privacy;
        privacy.href = current?.language === 'de' ? '/de/legal/datenschutz.html#website-assistant' : '/legal/privacy.html#website-assistant';
        suggestions.setAttribute('aria-label', labels.suggestions);
        messages.setAttribute('aria-label', labels.conversation);
        label.textContent = labels.question;
        input.placeholder = labels.placeholder;
        send.textContent = labels.send;
        stop.textContent = labels.stop;
        clear.textContent = labels.clear;
    }

    function busy(value) {
        input.readOnly = value;
        send.disabled = value;
        stop.hidden = !value;
        suggestions.querySelectorAll('button').forEach(button => { button.disabled = value; });
        form.setAttribute('aria-busy', String(value));
    }

    function cancel() {
        if (!request) return;
        request.abort();
        request = null;
        generation += 1;
        busy(false);
        status.textContent = labels.stopped;
    }

    function reset(message = '') {
        cancel();
        history = [];
        messages.replaceChildren();
        suggestions.hidden = !config?.suggestions.length;
        input.value = '';
        status.textContent = message;
    }

    function showSuggestions() {
        suggestions.hidden = messages.children.length > 0 || !config.suggestions.length;
        suggestions.replaceChildren();
        for (const item of config.suggestions) {
            const button = element('button', 'website-assistant__suggestion', item.question);
            button.type = 'button';
            button.addEventListener('click', () => { input.value = item.question; input.focus(); });
            suggestions.append(button);
        }
    }

    function composerVisible() {
        const outer = container.getBoundingClientRect(), inner = form.getBoundingClientRect();
        return inner.top >= outer.top && inner.top < outer.bottom;
    }

    function keepComposerInView() {
        // Scroll only the Help body, and follow streamed growth only while its
        // composer is already in view. Reading earlier text never gets pulled.
        const gap = form.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom;
        if (gap > 0) container.scrollTop += gap;
    }

    function appendMessage(role, text) {
        const item = element('li', `website-assistant__message website-assistant__message--${role}`);
        item.append(element('strong', 'website-assistant__speaker', role === 'user' ? labels.you : labels.assistant));
        const copy = element('p', 'website-assistant__copy', text);
        item.append(copy);
        messages.append(item);
        while (messages.children.length > 8) messages.firstElementChild.remove();
        return { item, copy };
    }

    function errorLabel(code) {
        if (code === 'rate_limited') return labels.rate;
        if (code === 'budget_exhausted') return labels.budget;
        if (code === 'assistant_unavailable') return labels.unavailable;
        if (code === 'context_changed') return labels.changed;
        return labels.error;
    }

    async function submit(event) {
        event.preventDefault();
        if (!config || request || !opened) return;
        const question = input.value.trim();
        if (!question || question.length > config.limits.inputChars) return;
        if (Date.now() < retryAt) { status.textContent = labels.rate; return; }
        if (contextKey(context()) !== contextKey(current)) { await refresh(); return; }
        const controller = new AbortController();
        request = controller;
        const ownGeneration = ++generation;
        const deadline = setTimeout(() => {
            if (request === controller) { cancel(); status.textContent = labels.error; }
        }, 45000);
        const version = config.contentVersion;
        busy(true);
        status.textContent = labels.thinking;
        suggestions.hidden = true;
        appendMessage('user', question);
        const answer = appendMessage('assistant', '');
        keepComposerInView();
        let output = '', finished = false, sourceList = [], hasMeta = false;
        try {
            const response = await fetch(`${API}/chat`, {
                method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
                body: JSON.stringify({ page: current.pageId, locale: current.language, contentVersion: version, message: question, history }),
            });
            if (!response.ok) {
                if (response.status === 429) retryAt = Date.now() + Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 60)) * 1000;
                const failure = await response.json().catch(() => null);
                throw new Error(failure?.code || (response.status === 429 ? 'rate_limited' : 'assistant_unavailable'));
            }
            await readEvents(response, controller.signal, (name, value) => {
                if (controller.signal.aborted || ownGeneration !== generation) return;
                if (finished) throw new Error('provider_error');
                if (name === 'meta') {
                    if (hasMeta || value.contentVersion !== version || !Array.isArray(value.sources) || value.sources.length > 8) throw new Error('context_changed');
                    hasMeta = true;
                    sourceList = value.sources.map(safeSource).filter(Boolean);
                } else if (name === 'delta') {
                    if (!hasMeta || typeof value.text !== 'string' || output.length + value.text.length > MAX_RESPONSE_CHARS) throw new Error('provider_error');
                    const follow = composerVisible();
                    output += value.text;
                    answer.copy.textContent = output;
                    if (follow) keepComposerInView();
                } else if (name === 'done') {
                    if (!hasMeta || !output.trim()) throw new Error('provider_error');
                    finished = true;
                } else if (name === 'error') {
                    throw new Error(value.code || 'provider_error');
                }
            });
            if (controller.signal.aborted || ownGeneration !== generation) return;
            if (!finished) throw new Error('provider_error');
            if (sourceList.length) {
                const follow = composerVisible();
                const sources = element('div', 'website-assistant__sources');
                sources.append(element('strong', '', labels.sources));
                for (const source of sourceList) {
                    const link = element('a', '', source.title);
                    link.href = source.url;
                    sources.append(link);
                }
                answer.item.append(sources);
                if (follow) keepComposerInView();
            }
            history.push({ role: 'user', content: question }, { role: 'assistant', content: output });
            while (history.length > config.limits.historyMessages || history.reduce((count, entry) => count + entry.content.length, 0) > 6000) history.splice(0, 2);
            input.value = '';
            status.textContent = labels.complete;
        } catch (error) {
            if (!controller.signal.aborted && ownGeneration === generation) {
                status.textContent = errorLabel(error.message);
                if (!output) answer.item.remove();
                if (error.message === 'context_changed') {
                    reset(labels.changed);
                    void refresh();
                }
            }
        } finally {
            clearTimeout(deadline);
            if (ownGeneration === generation) { request = null; busy(false); }
        }
    }

    async function refresh() {
        configController?.abort();
        const next = context();
        if (contextKey(next) !== contextKey(current)) {
            current = next;
            localize();
            reset(labels.changed);
            config = null;
        }
        if (!next || !opened) { card.hidden = true; return; }
        const controller = new AbortController();
        configController = controller;
        const deadline = setTimeout(() => {
            controller.abort(); cancel(); config = null; card.hidden = true;
        }, 10000);
        try {
            const response = await fetch(`${API}/config?page=${encodeURIComponent(next.pageId)}&locale=${next.language}`, {
                credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
                headers: { Accept: 'application/json' },
            });
            const nextConfig = response.ok ? parseConfig(await response.json()) : null;
            if (controller.signal.aborted) return;
            if (!nextConfig) { cancel(); config = null; card.hidden = true; return; }
            if (config && (config.contentVersion !== nextConfig.contentVersion || config.configRevision !== nextConfig.configRevision)) reset(labels.changed);
            const key = `${contextKey(next)}:${nextConfig.contentVersion}:${nextConfig.configRevision}`;
            if (!suggestionCache.has(key)) {
                if (suggestionCache.size >= 12) suggestionCache.clear();
                suggestionCache.set(key, nextConfig.suggestions);
            }
            config = { ...nextConfig, suggestions: suggestionCache.get(key) };
            greeting.textContent = config.greeting;
            greeting.hidden = !config.greeting;
            input.maxLength = config.limits.inputChars;
            if (!document.getElementById('websiteAssistantStyles')) {
                const sheet = document.createElement('link');
                sheet.id = 'websiteAssistantStyles';
                sheet.rel = 'stylesheet';
                sheet.href = '/css/components/website-assistant.css?v=__ASSET_VERSION__';
                document.head.append(sheet);
            }
            showSuggestions();
            busy(Boolean(request));
            card.hidden = false;
        } catch {
            if (!controller.signal.aborted) { cancel(); config = null; card.hidden = true; }
        } finally {
            clearTimeout(deadline);
        }
    }

    const navigation = () => { if (opened) void refresh(); else reset(); };
    const availabilityRefresh = () => { if (opened && !request) void refresh(); };
    const authChanged = () => reset();
    const pageHidden = () => { configController?.abort(); reset(); };
    form.addEventListener('submit', submit);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    stop.addEventListener('click', () => { cancel(); input.focus(); });
    clear.addEventListener('click', () => { reset(); input.focus(); });
    window.addEventListener('popstate', navigation);
    window.addEventListener('bitbi:page-change', navigation);
    window.addEventListener('hashchange', navigation);
    window.addEventListener('pagehide', pageHidden);
    window.addEventListener('focus', availabilityRefresh);
    window.addEventListener('pageshow', availabilityRefresh);
    document.addEventListener('bitbi:auth-change', authChanged);
    localize();
    void refresh();
    return {
        open() { opened = true; void refresh(); },
        close() { opened = false; configController?.abort(); cancel(); },
        destroy() {
            pageHidden();
            window.removeEventListener('popstate', navigation);
            window.removeEventListener('bitbi:page-change', navigation);
            window.removeEventListener('hashchange', navigation);
            window.removeEventListener('pagehide', pageHidden);
            window.removeEventListener('focus', availabilityRefresh);
            window.removeEventListener('pageshow', availabilityRefresh);
            document.removeEventListener('bitbi:auth-change', authChanged);
            card.remove();
        },
    };
}
