import { getContext, getSettings, t } from './core.js';
import { excerpt } from './starting-greeting.js';

let enabled, listening, timer;

function deleteContext(event) {
    const button = event.target.closest?.('.delete_alternate_greeting, .PastChat_cross, .mes_edit_delete');
    if (!button) return;
    const ctx = getContext();
    let label, question;
    if (button.matches('.delete_alternate_greeting')) {
        const row = button.closest('.pt_greetings .alternate_greeting');
        if (!row) return;
        const title = row.querySelector('.pt_greeting_name')?.value.trim();
        label = `#${Number(row.dataset.index) + 1} · ${title || excerpt(row.querySelector('textarea')?.value) || t('greetings.empty')}`;
        question = 'Are you sure you want to delete this alternate greeting?';
    } else if (!enabled) return;
    else if (button.matches('.PastChat_cross')) {
        label = button.getAttribute('file_name');
        question = 'Delete the Chat File?';
    } else {
        const msg = ctx?.chat?.[button.closest('.mes')?.getAttribute('mesid')];
        if (!msg) return;
        label = [msg.name, excerpt(msg.mes)].filter(Boolean).join(' · ');
        question = 'Are you sure you want to delete this message?';
    }
    if (!label || !ctx?.Popup) return;
    const previous = ctx.Popup.util.popups.at(-1);
    clearTimeout(timer);
    timer = setTimeout(() => {
        const p = ctx.Popup.util.popups.at(-1);
        const content = p?.dlg.querySelector('.popup-content');
        if (p === previous || p?.type !== ctx.POPUP_TYPE.CONFIRM || content?.textContent.trim() !== ctx.translate(question)) return;
        const detail = document.createElement('p'); detail.className = 'pt_delete_target';
        detail.textContent = label; content.append(detail);
    }, 0);
}

function copyLabels(on) {
    for (const btn of document.querySelectorAll('#message_template :is(.mes_copy,.mes_edit_copy), #chat :is(.mes_copy,.mes_edit_copy)')) {
        const duplicate = btn.matches('.mes_edit_copy');
        const original = duplicate ? 'Copy this message' : 'Copy';
        btn.title = on ? t(duplicate ? 'messages.duplicate' : 'messages.copy') : getContext()?.translate(original) || original;
        if (on) { btn.setAttribute('aria-label', btn.title); btn.removeAttribute('data-i18n'); }
        else { btn.removeAttribute('aria-label'); btn.setAttribute('data-i18n', `[title]${original}`); }
        if (duplicate) { btn.classList.toggle('fa-copy', !on); btn.classList.toggle('fa-clone', on); }
    }
}

export function syncMessageControls() {
    const s = getSettings();
    if (enabled !== s.chatControls) {
        if (enabled || s.chatControls) copyLabels(s.chatControls);
        enabled = s.chatControls;
    }
    if ((s.greetings || enabled) && !listening) {
        document.addEventListener('click', deleteContext, true); listening = true;
    } else if (!s.greetings && !enabled && listening) cleanupMessageControls();
}

export function cleanupMessageControls() {
    clearTimeout(timer);
    document.removeEventListener('click', deleteContext, true);
    if (enabled) copyLabels(false);
    enabled = listening = undefined;
}
