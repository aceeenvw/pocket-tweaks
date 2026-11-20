import { getContext, t, warn } from './core.js';

let disarm;
export function clearStartingPersona() { disarm?.(); }

export function mountStartingPersona(checkbox, popup, ctx, card) {
    clearStartingPersona();
    const quick = document.querySelector('#quickPersona #quickPersonaImg');
    const power = ctx.powerUserSettings;
    if (!quick || !power?.personas || !ctx.eventSource?.makeFirst) return;
    let closed = false, finish;
    import('../../../../personas.js').then(async ({ getUserAvatars }) => {
        if (closed) return;
        const live = new Set(await getUserAvatars(false));
        if (!closed && checkbox.isConnected) finish = renderPersona(checkbox, popup, ctx, card, quick, power, live);
    }).catch(err => { if (!closed) warn('persona-list', err); });
    return () => { closed = true; finish?.(); };
}

function renderPersona(checkbox, popup, ctx, card, quick, power, live) {
    const names = Object.entries(power.personas).filter(([id, name]) => live.has(id) && typeof name === 'string' && name);
    if (!names.length) return;
    const linked = names.filter(([id]) => power.persona_descriptions?.[id]?.connections?.some(c => c.id === card.avatar && c.type === 'character'));
    const automatic = linked[0]?.[0] ?? (live.has(power.default_persona) ? power.default_persona : null);
    const multiple = linked.length > 1 && power.persona_allow_multi_connections;
    const origin = multiple ? 'persona.auto' : linked.length ? 'persona.character' : automatic ? 'persona.default' : 'persona.current';
    const row = document.createElement('label'); row.className = 'pt_start_persona';
    const img = document.createElement('img'); img.alt = ''; img.width = img.height = 32;
    const text = document.createElement('span'); text.textContent = t('persona.play');
    const select = document.createElement('select'); select.className = 'text_pole';
    const name = power.personas[automatic] || ctx.name1;
    select.add(new Option(multiple ? t(origin) : `${name} · ${t(origin)}`, ''));
    for (const [id, name] of names) {
        const title = power.persona_descriptions?.[id]?.title;
        select.add(new Option(title ? `${name} — ${title}` : name, id));
    }
    const portrait = () => {
        const id = select.value || automatic;
        img.hidden = !select.value && multiple;
        if (!img.hidden) img.src = id ? ctx.getThumbnailUrl('persona', id) : quick.src;
    };
    select.addEventListener('change', portrait); portrait();
    row.append(img, text, select); checkbox.closest('label').before(row);
    return () => {
        row.remove();
        const id = select.value;
        if (!id || popup.dlg.isConnected || popup.result !== ctx.POPUP_RESULT.AFFIRMATIVE) return;
        const { eventSource: ev, eventTypes: types } = ctx;
        // Set the new chat's lock before ST resolves its character/default persona.
        const apply = async chatId => {
            clearStartingPersona();
            const now = getContext();
            if (!chatId || chatId === ctx.chatId || now.chatId !== chatId || now.groupId || now.characterId !== ctx.characterId ||
                now.characters[now.characterId]?.avatar !== card.avatar || !now.powerUserSettings.personas[id] || now.chatMetadata.persona ||
                now.chat.length > 1 || now.chat[0]?.is_user || !quick.isConnected) return;
            now.chatMetadata.persona = id;
            await now.saveMetadata();
        };
        const timer = setTimeout(clearStartingPersona, 30000);
        disarm = () => { clearTimeout(timer); ev.removeListener(types.CHAT_CHANGED, apply); disarm = null; };
        ev.makeFirst(types.CHAT_CHANGED, apply);
    };
}
