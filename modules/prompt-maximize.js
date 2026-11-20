// Prompt Manager expand button tweak.

import { fnv1a, getSettings, t } from './core.js';

const PROMPT_TARGET_ID = 'completion_prompt_manager_popup_entry_form_prompt';
const PROMPT_MARKER = `pt-${fnv1a(PROMPT_TARGET_ID)}`;

export function syncPromptMaximize() {
    const enabled = getSettings().promptMaximize;
    const textarea = document.getElementById(PROMPT_TARGET_ID);
    if (!textarea) return false;

    const control = textarea.closest('.completion_prompt_manager_popup_entry_form_control');
    const label = control?.querySelector(`.flex-container.alignItemsCenter .flex1 label[for="${PROMPT_TARGET_ID}"]`);
    if (!label) return false;

    const existing = label.querySelector(`.${PROMPT_MARKER}`);
    if (!enabled) {
        existing?.remove();
        return true;
    }
    if (existing) {
        existing.title = t('prompt.expand');
        return true;
    }

    label.classList.add('flex-container', 'alignItemsCenter');
    const btn = document.createElement('i');
    btn.className = `editor_maximize fa-solid fa-maximize right_menu_button ${PROMPT_MARKER}`;
    btn.dataset.for = PROMPT_TARGET_ID;
    btn.dataset.tab = 'true';
    btn.title = t('prompt.expand');
    btn.setAttribute('data-i18n', '[title]Expand the editor');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    label.appendChild(btn);
    return true;
}

export function cleanupPromptMaximize() {
    document.querySelector(`.${PROMPT_MARKER}`)?.remove();
}
