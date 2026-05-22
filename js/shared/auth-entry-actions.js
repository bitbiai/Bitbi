import { openAuthModal } from './auth-modal.js';
import { localeText } from './locale.js?v=__ASSET_VERSION__';
import { resolveAuthSource } from './auth-return-context.js?v=__ASSET_VERSION__';

let initialized = false;

function resolveMessage(key) {
    if (!key) return '';
    const message = localeText(key);
    return message === key ? '' : message;
}

export function initAuthEntryActions(root = document) {
    if (initialized || !root?.addEventListener) return;
    initialized = true;
    root.addEventListener('click', (event) => {
        const trigger = event.target.closest?.('[data-auth-entry]');
        if (!trigger) return;
        event.preventDefault();
        const tab = trigger.dataset.authEntry === 'register' ? 'register' : 'login';
        const target = trigger.dataset.authMessageTarget === 'login' ? 'login' : tab;
        const messageType = trigger.dataset.authMessageType || 'info';
        const message = resolveMessage(trigger.dataset.authMessageKey);
        const contextKey = trigger.dataset.authContextKey || trigger.dataset.authMessageKey || '';
        const returnSource = resolveAuthSource({
            source: trigger.dataset.authSource,
            contextKey,
        });
        openAuthModal(tab, { message, target, messageType, contextKey, returnSource });
    });
}
