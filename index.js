// ⊹ POCKET TWEAKS ⊹ — modular UI and workflow tweaks for SillyTavern.
// Author: aceenvw.

import {
    SCOPE_TOKEN,
    applyI18n,
    getContext,
    getSettings,
    saveSettings,
    t,
    warn,
} from './modules/core.js';
import { cleanupPromptMaximize, syncPromptMaximize } from './modules/prompt-maximize.js';
import { cleanupPromptActions, syncPromptActions } from './modules/prompt-actions.js';
import { cleanupGreetings, syncGreetings } from './modules/greetings.js';
import { cleanupCompare, syncCompare } from './modules/card-compare.js';
import { cleanupMessageControls, syncMessageControls } from './modules/message-controls.js';
import { bindAvatarCrop, cleanupAvatarCrop, syncAvatarCropUI } from './modules/avatar-crop.js';
import {
    bindDockRuntimeEvents,
    cleanupFloatingDock,
    enableFloatingDock,
    resetDockGeometry,
    syncFloatingDock,
} from './modules/floating-dock.js';

const EXTENSION_NAME = (() => {
    const m = String(import.meta.url).match(/\/scripts\/extensions\/(.+)\/[^/]+$/);
    return m ? m[1] : 'third-party/pocket-tweaks';
})();

const TOGGLE_BINDINGS = Object.freeze([
    ['pt_compare', 'compareCards', syncCompare],
    ['pt_greetings', 'greetings', syncGreetings],
    ['pt_ooc_inject', 'oocInject', syncFloatingDock],
    ['pt_chat_controls', 'chatControls', syncFloatingDock],
    ['pt_dock_shy', 'dockShy', syncFloatingDock],
    ['pt_jump_bottom', 'jumpToBottom', syncFloatingDock],
    ['pt_avatar_crop', 'avatarCrop', syncAvatarCropUI],
    ['pt_crop_on_upload', 'cropOnUpload', null],
    ['pt_prompt_maximize', 'promptMaximize', syncPromptMaximize],
    ['pt_prompt_actions', 'promptActions', syncPromptActions],
]);

let active = false;
let readyController = null;
let initTimer = null;
let settingsElement = null;
let settingsPromise = null;
let settingsObserver = null;
const appDisposers = [];

function findHostItem(host, selector) {
    const match = host.querySelector(selector);
    if (!match) return null;
    let cur = match;
    while (cur.parentElement && cur.parentElement !== host) {
        cur = cur.parentElement;
    }
    return cur.parentElement === host ? cur : null;
}

function placeSettings() {
    if (!settingsElement) return;
    const host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (!host) return;

    const persona = findHostItem(host, '.persona-manager-settings');
    const iig = findHostItem(host, '.iig-settings');

    if (persona && iig) {
        const children = [...host.children];
        const first = Math.min(children.indexOf(persona), children.indexOf(iig));
        const second = Math.max(children.indexOf(persona), children.indexOf(iig));
        const sIdx = children.indexOf(settingsElement);
        if (sIdx > first && sIdx < second) return;
        children[first].after(settingsElement);
    } else if (persona) {
        if (persona.nextElementSibling !== settingsElement) persona.after(settingsElement);
    } else if (iig) {
        if (iig.previousElementSibling !== settingsElement) iig.before(settingsElement);
    } else if (settingsElement.parentElement !== host) {
        host.appendChild(settingsElement);
    }
}

function syncSettingsControls() {
    if (!settingsElement) return;
    const s = getSettings();
    for (const [id, key] of TOGGLE_BINDINGS) {
        const input = settingsElement.querySelector(`#${id}`);
        if (input instanceof HTMLInputElement) input.checked = Boolean(s[key]);
    }

    const dockActive = Boolean(s.oocInject || s.chatControls);
    const shyInput = settingsElement.querySelector('#pt_dock_shy');
    const resetBtn = settingsElement.querySelector('#pt_dock_reset');
    if (shyInput instanceof HTMLInputElement) shyInput.disabled = !dockActive;
    if (resetBtn instanceof HTMLButtonElement) resetBtn.disabled = !dockActive;
    settingsElement.querySelector('#pt_dock_shy_row')?.classList.toggle('is-disabled', !dockActive);
    settingsElement.querySelector('#pt_dock_reset_row')?.classList.toggle('is-disabled', !dockActive);

    const uploadInput = settingsElement.querySelector('#pt_crop_on_upload');
    if (uploadInput instanceof HTMLInputElement) uploadInput.disabled = !s.avatarCrop;
    settingsElement.querySelector('#pt_crop_on_upload_row')?.classList.toggle('is-disabled', !s.avatarCrop);
}

function injectSettingsPanel() {
    if (!active) return Promise.resolve(false);
    if (settingsElement?.isConnected) {
        syncSettingsControls();
        return Promise.resolve(true);
    }
    const existing = document.querySelector('.pocket-tweaks-settings');
    if (existing) {
        settingsElement = existing;
        settingsElement.dataset.ptScope = SCOPE_TOKEN;
        syncSettingsControls();
        return Promise.resolve(true);
    }
    if (settingsPromise) return settingsPromise;

    const host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    const ctx = getContext();
    if (!host || !ctx?.renderExtensionTemplateAsync) return Promise.resolve(false);

    settingsPromise = (async () => {
        try {
            const html = await ctx.renderExtensionTemplateAsync(EXTENSION_NAME, 'settings');
            if (!active) return false;
            const wrap = document.createElement('div');
            wrap.innerHTML = html.trim();
            const root = wrap.firstElementChild;
            if (!root) return false;

            root.dataset.ptScope = SCOPE_TOKEN;
            settingsElement = root;
            applyI18n(root);

            root.addEventListener('change', (e) => {
                const input = e.target;
                if (!(input instanceof HTMLInputElement)) return;
                const match = TOGGLE_BINDINGS.find(([id]) => id === input.id);
                if (!match) return;
                const [, key, onSync] = match;
                getSettings()[key] = input.checked;
                syncSettingsControls();
                onSync?.();
                if (key === 'greetings' || key === 'chatControls') syncMessageControls();
                saveSettings();
            });

            root.querySelector('#pt_dock_reset')?.addEventListener('click', () => {
                resetDockGeometry();
                globalThis.toastr?.info?.(t('settings.dockResetDone'));
            });

            placeSettings();
            settingsObserver ??= new MutationObserver(placeSettings);
            for (const col of document.querySelectorAll('#extensions_settings, #extensions_settings2')) {
                settingsObserver.observe(col, { childList: true });
            }
            syncSettingsControls();
            return true;
        } catch (err) {
            warn('settings', err);
            return false;
        } finally {
            settingsPromise = null;
        }
    })();

    return settingsPromise;
}

function bindAppEvents() {
    if (appDisposers.length > 0) return true;
    const ctx = getContext();
    const ev = ctx?.eventSource;
    const types = ctx?.eventTypes || ctx?.event_types;
    if (!ev?.on || !types) return false;

    const add = (key, fn) => {
        const name = types[key];
        if (!name) return;
        ev.on(name, fn);
        appDisposers.push(() => ev.removeListener?.(name, fn));
    };

    add('APP_READY', () => startSyncLoop());
    add('SETTINGS_UPDATED', () => {
        syncCompare();
        syncMessageControls();
        syncGreetings();
        syncSettingsControls();
        syncFloatingDock();
        syncAvatarCropUI();
        syncPromptMaximize();
        syncPromptActions();
    });
    return true;
}

async function syncAll() {
    if (!active) return true;
    const appReady = bindAppEvents();
    syncCompare();
    syncMessageControls();
    const cropBound = bindAvatarCrop();
    syncGreetings();
    const dockReady = enableFloatingDock();
    const dockEvents = bindDockRuntimeEvents();
    const promptOk = syncPromptMaximize();
    syncPromptActions();
    const cropOk = syncAvatarCropUI();
    const settingsOk = await injectSettingsPanel();
    return appReady && cropBound && dockReady && dockEvents && promptOk && cropOk && settingsOk;
}

function startSyncLoop() {
    if (!active) return;
    syncAll().then((done) => {
        if (!active || done || initTimer !== null) return;
        let tries = 0;
        initTimer = setInterval(async () => {
            if (!active || (await syncAll()) || ++tries >= 24) {
                clearInterval(initTimer);
                initTimer = null;
            }
        }, 500);
    });
}

export function cleanup() {
    active = false;
    readyController?.abort();
    readyController = null;
    if (initTimer !== null) {
        clearInterval(initTimer);
        initTimer = null;
    }
    settingsObserver?.disconnect();
    settingsObserver = null;
    while (appDisposers.length) appDisposers.pop()();

    cleanupFloatingDock();
    cleanupGreetings();
    cleanupCompare();
    cleanupMessageControls();
    cleanupAvatarCrop();
    cleanupPromptMaximize();
    cleanupPromptActions();

    settingsElement?.remove();
    document.querySelector('.pocket-tweaks-settings')?.remove();
    settingsElement = null;
}

export const disable = cleanup;

export function enable() {
    if (active) return;
    active = true;
    if (document.readyState === 'loading') {
        readyController = new AbortController();
        document.addEventListener('DOMContentLoaded', () => {
            readyController = null;
            startSyncLoop();
        }, { once: true, signal: readyController.signal });
    } else {
        startSyncLoop();
    }
}

enable();
