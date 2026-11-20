import { getContext, getSettings, SCOPE_TOKEN, t } from './core.js';

const MB = 1024 * 1024;
let controller, replay;

async function readCard(file) {
    if (/\.json$/i.test(file.name)) {
        if (file.size > 8 * MB) throw new RangeError();
        return JSON.parse(await file.text());
    }
    if (file.size > 32 * MB) throw new RangeError();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) throw new Error();
    let chunk;
    for (let p = 8; p + 12 <= bytes.length;) {
        const n = view.getUint32(p), end = p + 8 + n;
        if (end + 4 > bytes.length) throw new Error();
        if (view.getUint32(p + 4) === 0x74455874 && n > 5) {
            const start = p + 8;
            const key = String.fromCharCode(...bytes.subarray(start, start + 5)).toLowerCase();
            const v3 = key === 'ccv3\0';
            if (v3 || (!chunk && key === 'chara' && bytes[start + 5] === 0)) {
                chunk = bytes.subarray(start + (v3 ? 5 : 6), end);
                if (v3) break;
            }
        }
        p = end + 4;
    }
    if (!chunk || chunk.length > 10 * MB) throw new Error();
    const binary = atob(new TextDecoder().decode(chunk));
    const decoded = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) decoded[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(decoded));
}

const fields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes'];
function changes(before, after) {
    const rows = [];
    for (const key of fields) {
        const a = before[key] ?? '', b = after[key] ?? '';
        if (typeof a !== 'string' || typeof b !== 'string') throw new Error();
        if (a !== b) rows.push({ key, a, b, status: !b.trim() ? 'cleared' : !a.trim() ? 'added' : 'changed', loss: !!a.trim() && !b.trim() });
    }
    const a = before.alternate_greetings ?? [], b = after.alternate_greetings ?? [];
    if (![a, b].every(arr => Array.isArray(arr) && arr.every(s => typeof s === 'string'))) throw new Error();
    if (a.length !== b.length || a.some((s, i) => s !== b[i])) {
        const counts = new Map();
        for (const s of b) counts.set(s, (counts.get(s) || 0) + 1);
        let missing = 0;
        for (const s of a) { const n = counts.get(s); if (n) counts.set(s, n - 1); else missing++; }
        rows.push({ key: 'alternate_greetings', a, b, missing, loss: missing > 0 });
    }
    return rows.sort((a, b) => Number(b.loss) - Number(a.loss));
}

function node(tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
}

function showRows(root, rows) {
    if (!rows.length) root.append(node('p', t('compare.same')));
    const labels = t('compare.fields').split('|');
    for (const row of rows) {
        const group = document.createElement('details');
        const summary = document.createElement('summary');
        const list = Array.isArray(row.a);
        const state = list ? `${row.a.length} → ${row.b.length}${row.missing ? ` · −${row.missing}` : ''}` : t(`compare.${row.status}`);
        summary.append(node('strong', labels[list ? fields.length : fields.indexOf(row.key)]), node('small', state));
        group.classList.toggle('pt_compare_loss', row.loss);
        group.append(summary);
        group.addEventListener('toggle', () => {
            if (!group.open || group.childElementCount > 1) return;
            const sides = document.createElement('div');
            for (const [key, value] of [['current', row.a], ['incoming', row.b]]) {
                const side = document.createElement('section');
                const text = list ? value.slice(0, 80).map((s, i) => `#${i + 1} · ${s.slice(0, 160).trim() || '—'}${s.length > 160 ? '…' : ''}`).join('\n') + (value.length > 80 ? '\n…' : '') : value;
                side.append(node('b', t(`compare.${key}`)), node('p', text.length > 12000 ? `${text.slice(0, 12000)}…` : text || '—'));
                sides.append(side);
            }
            group.append(sides);
        });
        root.append(group);
    }
}

async function onFile(event) {
    const input = event.target, file = input.files?.[0];
    if (event === replay || !file || !/\.(png|json)$/i.test(file.name)) return;
    event.stopImmediatePropagation();
    const signal = controller.signal, ctx = getContext(), card = ctx.characters[ctx.characterId];
    const current = () => {
        const now = getContext();
        return !signal.aborted && input.files[0] === file && card?.avatar && now?.characters?.[now.characterId]?.avatar === card.avatar;
    };
    const root = document.createElement('div'); root.className = 'pt_compare';
    root.append(node('h3', t('compare.heading')), node('small', `${card?.name ?? ''} ← ${file.name}`));
    try {
        const raw = await readCard(file);
        const data = raw.spec ? raw.data : raw;
        if (typeof data?.name !== 'string' || !card?.data) throw new Error();
        showRows(root, changes(card.data, raw.spec ? data : { ...data, creator_notes: data.creatorcomment ?? data.creator_notes,
            system_prompt: '', post_history_instructions: '', alternate_greetings: [] }));
        root.append(node('small', t('compare.scope')));
    } catch {
        root.append(node('p', t('compare.unavailable')));
    }
    try {
        if (!current()) return;
        const p = new ctx.Popup(root, ctx.POPUP_TYPE.CONFIRM, null, { okButton: t('compare.replace'), cancelButton: ctx.translate('Cancel'), defaultResult: ctx.POPUP_RESULT.NEGATIVE });
        p.dlg.classList.add('pt-themed-popup', 'pt_compare_popup'); p.dlg.dataset.ptScope = SCOPE_TOKEN;
        if (await p.show() !== ctx.POPUP_RESULT.AFFIRMATIVE || !current()) return;
        replay = new Event('change', { bubbles: true });
        input.dispatchEvent(replay);
    } finally {
        replay = null;
        if (input.files[0] === file) input.value = '';
    }
}

export function cleanupCompare() { controller?.abort(); controller = null; }
export function syncCompare() {
    if (!getSettings().compareCards) return cleanupCompare();
    const input = document.getElementById('character_replace_file');
    if (!input || controller || !getContext()?.Popup) return;
    controller = new AbortController();
    input.addEventListener('change', onFile, { capture: true, signal: controller.signal });
}
