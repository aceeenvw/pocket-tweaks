import { getContext, getSettings, SCOPE_TOKEN, t } from './core.js';
import { clearStartingGreeting, excerpt, mountStartingGreeting } from './starting-greeting.js';
import { mountGreetingSearch } from './greeting-search.js';

let dialogs;
const mounted = new Map();

function writeTitles(extensions, names, firstTitle) {
    const fields = { ...extensions.pocket_tweaks };
    if (firstTitle) fields.firstGreetingTitle = firstTitle;
    else delete fields.firstGreetingTitle;
    if (names.some(Boolean)) fields.greetingTitles = names.slice();
    else delete fields.greetingTitles;
    if (Object.keys(fields).length) extensions.pocket_tweaks = fields;
    else delete extensions.pocket_tweaks;
}

function mount(dialog) {
    if (mounted.has(dialog)) return;
    const newChat = dialog.querySelector('#del_chat_checkbox');
    if (newChat) {
        const dispose = mountStartingGreeting(dialog, newChat);
        if (dispose) mounted.set(dialog, () => { dispose(); mounted.delete(dialog); });
        return;
    }
    const list = dialog.querySelector('.popup-content > .alternate_grettings > .alternate_greetings_list');
    const add = list?.parentElement.querySelector('.add_alternate_greeting');
    if (!add) return;

    const controller = new AbortController();
    const { signal } = controller;
    const rows = new Map();
    const ctx = getContext();
    if (!ctx) return;
    const draft = ctx.menuType === 'create';
    const card = draft ? ctx.createCharacterData : ctx.characters[globalThis.jQuery('.open_alternate_greetings').data('chid')];
    const data = draft ? card : card?.data;
    if (!data) return;
    const stored = data.extensions?.pocket_tweaks?.greetingTitles;
    const saved = Array.isArray(stored) ? stored : [];
    const titles = data.alternate_greetings.map((_, i) => typeof saved?.[i] === 'string' ? saved[i].slice(0, 100) : '');
    const json = document.getElementById('character_json_data');
    const first = document.getElementById('firstmessage_textarea');
    let firstTitle = data.extensions?.pocket_tweaks?.firstGreetingTitle;
    let deleting = -1;
    let copyIndex = -1;

    function save() {
        writeTitles(data.extensions ??= {}, titles, firstTitle);
        if (draft || !json?.value) return;
        const raw = JSON.parse(json.value);
        raw.data ??= {};
        writeTitles(raw.data.extensions ??= {}, titles, firstTitle);
        card.json_data = json.value = JSON.stringify(raw);
    }

    // Native delete splices the array only after confirmation, then saves and reopens.
    function finishDelete(event) {
        if (deleting < 0 || data.alternate_greetings.length !== titles.length - 1) return;
        titles.splice(deleting, 1);
        deleting = -1;
        save();
        if (!draft && event) event.formData.set('json_data', json.value);
    }
    json?.form?.addEventListener('formdata', finishDelete, { signal });
    const bulk = document.createElement('button');
    bulk.type = 'button';
    bulk.className = 'menu_button pt_greetings_bulk';
    add.before(bulk);
    mountGreetingSearch(list, bulk, signal);
    dialog.classList.add('pt-themed-popup', 'pt_greetings');
    dialog.dataset.ptScope = SCOPE_TOKEN;

    function refreshBulk() {
        bulk.hidden = rows.size < 2;
        bulk.textContent = t(list.querySelector('details[open]') ? 'greetings.collapse' : 'greetings.expand');
    }

    function decorate(row, open) {
        const details = row.querySelector('details');
        const summary = details?.querySelector('summary');
        const tools = summary?.querySelector('.title_restorable');
        const title = tools?.querySelector('strong');
        const text = row.querySelector('.alternate_greeting_text');
        if (!title || !text) return;
        const original = title.parentNode;
        const i = Number(row.dataset.index);
        const fallback = title.textContent;
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'pt_greeting_name';
        name.maxLength = 100;
        name.placeholder = fallback;
        name.setAttribute('aria-label', `${t('greetings.name')} · ${fallback}`);
        const label = document.createElement('span');
        label.className = 'pt_greeting_label';
        const editBar = document.createElement('div');
        editBar.className = 'pt_greeting_editbar';
        editBar.append(name);
        const button = (icon, key) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu_button';
            const glyph = document.createElement('i');
            glyph.className = `fa-solid ${icon}`;
            glyph.setAttribute('aria-hidden', 'true');
            btn.append(glyph);
            btn.title = t(key);
            btn.setAttribute('aria-label', btn.title);
            return btn;
        };
        const duplicate = button('fa-clone', 'greetings.duplicate');
        const swap = button('fa-right-left', 'greetings.swap');
        const more = button('fa-ellipsis', 'greetings.actions');
        more.classList.add('pt_greeting_more');
        more.setAttribute('aria-expanded', 'false');
        tools.querySelector('.delete_alternate_greeting').before(duplicate, swap);
        swap.disabled = !first;
        swap.addEventListener('click', async e => {
            e.preventDefault();
            const before = first.value, after = text.value;
            const content = document.createElement('div');
            for (const line of [t('greetings.swap'), `${t('start.first')}: ${excerpt(after) || t('greetings.empty')}`, `#${i + 1}: ${excerpt(before) || t('greetings.empty')}`]) {
                const p = document.createElement('p'); p.textContent = line; content.append(p);
            }
            const result = await ctx.callGenericPopup(content, ctx.POPUP_TYPE.CONFIRM);
            if (signal.aborted || result !== ctx.POPUP_RESULT.AFFIRMATIVE || first.value !== before || text.value !== after) return;
            first.value = after;
            if (draft) data.first_message = after;
            text.value = before;
            text.dispatchEvent(new Event('input', { bubbles: true }));
            [firstTitle, titles[i]] = [titles[i], firstTitle || ''];
            save(); update();
        }, { signal });
        const preview = document.createElement('span');
        preview.className = 'pt_greeting_preview';
        const update = () => {
            name.value = titles[i] || '';
            label.textContent = name.value ? `#${i + 1} · ${name.value}` : fallback;
            const line = text.value.trimStart().split(/\r?\n/, 1)[0];
            preview.textContent = line.length > 120 ? `${line.slice(0, 120)}…` : line || t('greetings.empty');
        };
        title.remove();
        summary.prepend(label);
        summary.append(preview);
        summary.after(editBar);
        function placeActions() {
            const header = details.open ? editBar : summary;
            if (tools.parentNode !== header || more.parentNode !== header) {
                header.insertBefore(more, details.open ? null : preview);
                header.insertBefore(tools, details.open ? null : preview);
            }
        }
        name.addEventListener('input', e => e.stopPropagation(), { signal });
        name.addEventListener('change', e => {
            e.stopPropagation();
            titles[i] = name.value.trim();
            save();
            update();
        }, { signal });
        name.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); name.blur(); }
        }, { signal });
        more.addEventListener('click', e => {
            e.preventDefault();
            const opening = more.getAttribute('aria-expanded') !== 'true';
            if (opening) list.querySelector('.pt_greeting_more[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
            more.setAttribute('aria-expanded', String(opening));
        }, { signal });
        duplicate.addEventListener('click', e => {
            e.preventDefault();
            const dest = i + 1;
            add.click();
            const fields = [...list.querySelectorAll('.alternate_greeting_text')];
            for (let j = fields.length - 1; j >= dest; j--) {
                fields[j].value = fields[j - 1].value;
                fields[j].dispatchEvent(new Event('input', { bubbles: true }));
            }
            const suffix = ` (${t('greetings.copy')})`;
            titles.splice(dest, 0, titles[i] ? titles[i].slice(0, 100 - suffix.length) + suffix : '');
            copyIndex = dest;
            save();
        }, { signal });
        details.open = open;
        placeActions();
        update();
        text.addEventListener('input', () => { if (!details.open) update(); }, { signal });
        details.addEventListener('toggle', () => {
            placeActions();
            if (!details.open) update();
            refreshBulk();
        }, { signal });
        rows.set(row, { details, update, restore() {
            original.prepend(title);
            summary.append(tools);
            editBar.remove(); label.remove(); duplicate.remove(); swap.remove(); more.remove();
            preview.remove();
            details.open = true;
        } });
    }

    const initial = list.querySelectorAll('.alternate_greeting');
    initial.forEach(row => decorate(row, initial.length === 1));
    refreshBulk();
    bulk.addEventListener('click', () => {
        const open = !list.querySelector('details[open]');
        for (const { details } of rows.values()) details.open = open;
    }, { signal });

    const added = new MutationObserver(records => {
        for (const record of records) for (const row of record.addedNodes) {
            if (!row.matches?.('.alternate_greeting') || rows.has(row)) continue;
            decorate(row, true);
            if (copyIndex < 0) {
                titles[Number(row.dataset.index)] ??= '';
                row.scrollIntoView({ block: 'nearest' });
            } else {
                for (const entry of rows.values()) entry.update();
                const dest = list.querySelector(`[data-index="${copyIndex}"]`);
                if (dest !== row) rows.get(row).details.open = false;
                rows.get(dest).details.open = true;
                dest.querySelector('textarea').focus();
                copyIndex = -1;
            }
        }
        refreshBulk();
    });
    added.observe(list, { childList: true });

    // Native move handlers swap textarea values without dispatching input.
    list.addEventListener('click', event => {
        const del = event.target.closest('.delete_alternate_greeting');
        if (del) deleting = Number(del.closest('.alternate_greeting').dataset.index);
        const btn = event.target.closest('.move_up_alternate_greeting, .move_down_alternate_greeting');
        if (!btn) return;
        const row = btn.closest('.alternate_greeting');
        const up = btn.classList.contains('move_up_alternate_greeting');
        const next = up ? row.previousElementSibling : row.nextElementSibling;
        const from = rows.get(row), to = rows.get(next);
        if (!from || !to) return;
        queueMicrotask(() => {
            if (signal.aborted) return;
            const a = Number(row.dataset.index), b = Number(next.dataset.index);
            [titles[a], titles[b]] = [titles[b], titles[a]];
            if (titles[a] || titles[b]) save();
            from.details.open = to.details.open;
            to.details.open = true;
            from.update();
            to.update();
            next.querySelector('summary').focus();
        });
    }, { capture: true, signal });

    const viewport = window.visualViewport;
    const size = () => dialog.style.setProperty('--pt-greetings-height', `${viewport.height}px`);
    if (viewport) {
        size();
        viewport.addEventListener('resize', size, { signal });
    }
    mounted.set(dialog, () => {
        finishDelete();
        controller.abort();
        added.disconnect();
        for (const row of rows.values()) row.restore();
        bulk.remove();
        dialog.classList.remove('pt-themed-popup', 'pt_greetings');
        delete dialog.dataset.ptScope;
        dialog.style.removeProperty('--pt-greetings-height');
        mounted.delete(dialog);
    });
}

export function cleanupGreetings() {
    dialogs?.disconnect();
    dialogs = null;
    for (const restore of mounted.values()) restore();
    clearStartingGreeting();
}

export function syncGreetings() {
    if (!getSettings().greetings) return cleanupGreetings();
    if (dialogs || !document.body) return;
    dialogs = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.removedNodes) if (!node.isConnected) mounted.get(node)?.();
            for (const node of record.addedNodes) if (node.matches?.('dialog.popup[open]')) mount(node);
        }
    });
    dialogs.observe(document.body, { childList: true });
    document.querySelectorAll('body > dialog.popup[open]').forEach(mount);
}
