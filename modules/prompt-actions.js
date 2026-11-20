import { getContext, getSettings, t, warn } from './core.js';

let stop;
let activePopup;
let dropdown;
const controls = '.prompt_manager_prompt_controls';
const icons = { duplicate: 'fa-clone', delete: 'fa-trash-can', more: 'fa-ellipsis' };

function decorate(row) {
    const bar = row.querySelector(controls), unlink = bar?.querySelector('.prompt-manager-detach-action');
    if (!unlink || bar.querySelector('[data-pt-prompt]')) return;
    unlink.dataset.ptOldTitle = unlink.title;
    unlink.title = t('prompt.unlink');
    for (const [action, icon] of Object.entries(icons)) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.dataset.ptPrompt = action;
        if (action === 'more') btn.setAttribute('aria-expanded', 'false');
        btn.title = t(`prompt.${action}`); btn.setAttribute('aria-label', btn.title);
        const glyph = document.createElement('i'); glyph.className = `fa-solid ${icon}`; glyph.setAttribute('aria-hidden', 'true');
        btn.append(glyph);
        if (action === 'duplicate') bar.querySelector('.prompt-manager-edit-action')?.after(btn);
        else bar.append(btn);
    }
}

function pickAction(btn) {
    const menu = document.createElement('div'); menu.className = 'pt_prompt_menu'; menu.id = 'pt_prompt_row_menu';
    const listeners = new AbortController(), { signal } = listeners;
    return new Promise(resolve => {
        const close = (action, restore = false) => {
            listeners.abort(); menu.remove(); btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-controls');
            dropdown = null;
            if (restore && btn.isConnected) btn.focus({ preventScroll: true });
            resolve(action);
        };
        dropdown = { btn, close };
        for (const key of ['duplicate', 'unlink', 'delete']) {
            const option = document.createElement('button'); option.type = 'button'; option.textContent = t(`prompt.${key}`);
            option.onclick = () => close(key, true); menu.append(option);
        }
        menu.setAttribute('popover', 'manual');
        document.body.append(menu); menu.showPopover?.();
        const anchor = btn.getBoundingClientRect(), box = menu.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
        const right = left + (viewport?.width ?? window.innerWidth), bottom = top + (viewport?.height ?? window.innerHeight);
        const below = bottom - anchor.bottom - 8, above = anchor.top - top - 8;
        const drop = below >= box.height || below >= above;
        const height = Math.min(box.height, Math.max(0, drop ? below : above));
        menu.style.maxHeight = `${height}px`;
        menu.style.left = `${Math.max(left + 4, Math.min(anchor.right - box.width, right - box.width - 4))}px`;
        menu.style.top = `${drop ? anchor.bottom + 4 : anchor.top - height - 4}px`;
        btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', menu.id);
        menu.firstElementChild.focus({ preventScroll: true });
        const outside = e => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
        document.addEventListener('pointerdown', outside, { capture: true, signal });
        document.addEventListener('focusin', outside, { signal });
        document.addEventListener('scroll', e => { if (!menu.contains(e.target)) close(); }, { capture: true, passive: true, signal });
        window.addEventListener('resize', () => close(), { signal });
        viewport?.addEventListener('resize', () => close(), { signal });
        viewport?.addEventListener('scroll', () => close(), { signal });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null, true); } }, { capture: true, signal });
        matchMedia('(pointer: coarse), (max-width: 768px)').addEventListener('change', () => close(), { signal });
    });
}

async function activate(event) {
    const btn = event.target.closest?.('[data-pt-prompt]');
    if (!btn) return;
    if (dropdown) { const same = dropdown.btn === btn; dropdown.close(null, same); if (same) return; }
    const row = btn.closest('[data-pm-identifier]'), id = row.dataset.pmIdentifier;
    const { promptManager: pm } = await import('../../../../openai.js');
    const ctx = getContext(), source = pm?.getPromptById(id), character = pm?.activeCharacter;
    if (!source || !character || !pm.isPromptDeletionAllowed(source)) return;
    const order = pm.getPromptOrderForCharacter(character);
    const valid = () => btn.isConnected && pm.getPromptById(id) === source && pm.getPromptOrderForCharacter(pm.activeCharacter) === order && order.some(e => e.identifier === id);
    if (!valid()) return;
    let action = btn.dataset.ptPrompt;
    if (action === 'more') {
        if (dropdown) return;
        action = await pickAction(btn);
        if (!action || !valid()) return;
    }
    if (action === 'unlink') { row.querySelector('.prompt-manager-detach-action').click(); return; }
    if (action === 'duplicate') {
        const copy = structuredClone(source);
        copy.identifier = pm.getUuidv4(); copy.name = `${source.name} (${t('greetings.copy')})`; copy.enabled = false;
        pm.addPrompt(copy, copy.identifier);
        order.splice(order.findIndex(e => e.identifier === id) + 1, 0, { identifier: copy.identifier, enabled: false });
        pm.saveServiceSettings(); pm.render(false);
        pm.clearEditForm(); pm.clearInspectForm(); pm.loadPromptIntoEditForm(pm.getPromptById(copy.identifier)); pm.showPopup();
    } else if (action === 'delete') {
        const otherOrders = () => pm.serviceSettings.prompt_order.filter(list => list.order !== order && list.order.some(e => e.identifier === id)).length;
        const count = otherOrders(), name = source.name;
        const message = document.createElement('div'); message.textContent = t('prompt.confirm').replace('{name}', () => name);
        if (count) { const note = document.createElement('p'); note.textContent = `${t('prompt.references')}: ${count}`; message.append(note); }
        const yes = await show(new ctx.Popup(message, ctx.POPUP_TYPE.CONFIRM, null, { okButton: t('prompt.delete'), cancelButton: ctx.translate('Cancel'), defaultResult: ctx.POPUP_RESULT.NEGATIVE }));
        if (yes !== ctx.POPUP_RESULT.AFFIRMATIVE || !valid() || source.name !== name || !pm.isPromptDeletionAllowed(source) || count !== otherOrders()) return;
        for (const { order: entries } of pm.serviceSettings.prompt_order) {
            for (let i = entries.length - 1; i >= 0; i--) if (entries[i].identifier === id) entries.splice(i, 1);
        }
        pm.serviceSettings.prompts.splice(pm.getPromptIndexById(id), 1);
        pm.hidePopup(); pm.clearEditForm(); pm.render(); pm.saveServiceSettings();
    }
}

async function show(popup) {
    if (activePopup) return;
    activePopup = popup;
    try { return await popup.show(); } finally { activePopup = null; }
}

export function cleanupPromptActions() { stop?.(); stop = null; activePopup?.completeCancelled(); }
export function syncPromptActions() {
    if (!getSettings().promptActions) return cleanupPromptActions();
    const root = document.getElementById('completion_prompt_manager');
    if (!root || stop) return;
    root.querySelectorAll('li[data-pm-identifier]').forEach(decorate);
    const observer = new MutationObserver(records => {
        if (dropdown && !dropdown.btn.isConnected) dropdown.close();
        for (const r of records) if (r.target.id === 'completion_prompt_manager_list') {
            for (const node of r.addedNodes) if (node.matches?.('li[data-pm-identifier]')) decorate(node);
        }
    });
    observer.observe(root, { childList: true, subtree: true });
    const click = e => activate(e).catch(err => warn('prompt-actions', err));
    root.addEventListener('click', click);
    stop = () => {
        dropdown?.close();
        observer.disconnect(); root.removeEventListener('click', click);
        root.querySelectorAll('[data-pt-prompt]').forEach(el => el.remove());
        root.querySelectorAll('[data-pt-old-title]').forEach(el => { el.title = el.dataset.ptOldTitle; delete el.dataset.ptOldTitle; });
    };
}
