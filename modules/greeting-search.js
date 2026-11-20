import { getContext, t } from './core.js';

export function mountGreetingSearch(list, before, signal) {
    if (!globalThis.CodeMirrorPro?.selectRange) return;
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'menu_button';
    const icon = document.createElement('i'); icon.className = 'fa-solid fa-magnifying-glass';
    icon.setAttribute('aria-hidden', 'true'); trigger.append(icon);
    trigger.title = t('find.label'); trigger.setAttribute('aria-label', trigger.title);
    before.before(trigger);
    signal.addEventListener('abort', () => trigger.remove(), { once: true });
    trigger.addEventListener('click', async () => {
        const ctx = getContext(), root = document.createElement('div'); root.className = 'pt_greeting_find';
        const label = document.createElement('label'), query = document.createElement('input');
        label.textContent = t('find.label'); query.type = 'search'; query.className = 'text_pole';
        label.append(query);
        const results = document.createElement('div'); root.append(label, results);
        const p = new ctx.Popup(root, ctx.POPUP_TYPE.TEXT);
        let hit, timer;
        const close = () => p.completeCancelled();
        signal.addEventListener('abort', close, { once: true });
        function search() {
            results.replaceChildren();
            const needle = query.value.trim();
            if (!needle) return;
            const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
            for (const field of list.querySelectorAll('.alternate_greeting_text')) {
                const match = pattern.exec(field.value);
                if (!match) continue;
                const row = field.closest('.alternate_greeting'), btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'menu_button';
                btn.textContent = row.querySelector('.pt_greeting_label').textContent;
                const preview = document.createElement('small');
                preview.textContent = field.value.slice(Math.max(0, match.index - 30), match.index + Math.min(needle.length, 60) + 40);
                btn.append(preview); results.append(btn);
                btn.onclick = () => { hit = { field, pattern }; p.completeAffirmative(); };
            }
            if (!results.childElementCount) results.textContent = t('find.none');
        }
        query.addEventListener('input', () => { clearTimeout(timer); results.replaceChildren(); timer = setTimeout(search, 120); });
        try { await p.show(); } finally { clearTimeout(timer); signal.removeEventListener('abort', close); }
        if (!hit || signal.aborted || !hit.field.isConnected) return;
        const { field, pattern } = hit, match = pattern.exec(field.value);
        if (!match) return;
        const details = field.closest('details'); details.open = true;
        details.querySelector('.editor_maximize').click();
        queueMicrotask(() => {
            const target = document.querySelector(`dialog[open]:not([closing]) .maximized_textarea[data-for="${CSS.escape(field.id)}"]`);
            if (target && target.value === field.value) globalThis.CodeMirrorPro?.selectRange?.(target, match.index, match.index + match[0].length);
        });
    }, { signal });
}
