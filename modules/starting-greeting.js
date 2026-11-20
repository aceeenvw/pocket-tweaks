import { getContext, t } from './core.js';
import { clearStartingPersona, mountStartingPersona } from './starting-persona.js';

export function excerpt(text) {
    const lines = [];
    for (const match of String(text ?? '').matchAll(/[^\r\n]+/g)) {
        const line = match[0].trim();
        if (line) lines.push(line.length > 80 ? `${line.slice(0, 79)}…` : line);
        if (lines.length === 2) break;
    }
    return lines.join(' / ');
}

let release;
export function clearStartingGreeting() { release?.(); clearStartingPersona(); }

export function mountStartingGreeting(dialog, checkbox) {
    clearStartingGreeting();
    const ctx = getContext();
    const card = ctx?.characters?.[ctx.characterId];
    const alts = card?.data?.alternate_greetings;
    const popup = ctx?.Popup?.util.popups.find(p => p.dlg === dialog);
    if (!popup || ctx.groupId || !card) return;
    const finishPersona = mountStartingPersona(checkbox, popup, ctx, card);
    if (!alts?.length || !ctx.swipe?.to) return finishPersona;
    const box = document.createElement('details');
    box.className = 'pt_start_picker';
    const head = document.createElement('summary');
    const initial = t('start.default');
    const setLabel = value => { head.textContent = `${t('start.label')} · ${value}`; };
    setLabel(initial);
    box.append(head);
    checkbox.closest('label').before(box);
    let selected = -1;
    box.addEventListener('toggle', () => {
        if (!box.open || box.childElementCount > 1) return;
        const list = document.createElement('div');
        function option(index, label, preview, disabled) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            if (preview) { const small = document.createElement('small'); small.textContent = preview; btn.append(small); }
            btn.disabled = disabled;
            btn.setAttribute('aria-pressed', String(selected === index));
            btn.addEventListener('click', () => {
                list.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
                btn.setAttribute('aria-pressed', 'true'); selected = index;
                setLabel(label); box.open = false; head.focus();
            });
            list.append(btn);
        }
        option(-1, initial, '', false);
        alts.forEach((text, i) => {
            const preview = excerpt(text);
            const title = card.data.extensions?.pocket_tweaks?.greetingTitles?.[i];
            const name = typeof title === 'string' ? title.trim() : '';
            option(i, `#${i + 1} · ${name || preview || t('greetings.empty')}`, name ? preview || t('greetings.empty') : '', !preview);
        });
        box.append(list);
    });
    return () => {
        box.remove();
        finishPersona?.();
        if (dialog.isConnected || popup.result !== ctx.POPUP_RESULT.AFFIRMATIVE || selected < 0) return;
        const { eventSource: ev, eventTypes: types } = ctx;
        const raw = alts[selected];
        const sameCard = now => !now.groupId && now.characters[now.characterId]?.avatar === card.avatar &&
            now.characters[now.characterId]?.data?.alternate_greetings?.[selected] === raw;
        // ST omits the greeting entirely when both First Message and alternate #1 are empty.
        const emptyStart = async () => {
            const now = getContext();
            if (now.chat.length || now.chatId === ctx.chatId || !sameCard(now)) return;
            const pending = release;
            const [{ getRegexedString, regex_placement }, { getMessageTimeStamp }] = await Promise.all([
                import('../../../../extensions/regex/engine.js'), import('../../../../RossAscends-mods.js'),
            ]);
            if (pending !== release || getContext().chatId !== now.chatId || now.chat.length) return;
            clearStartingGreeting();
            const swipes = alts.map(text => getRegexedString(text, regex_placement.AI_OUTPUT));
            if (!swipes[selected]) return;
            const date = getMessageTimeStamp();
            const message = { name: card.name, is_user: false, is_system: false, send_date: date, mes: swipes[selected],
                swipe_id: selected, swipes, swipe_info: swipes.map(() => ({ send_date: date, extra: {} })), extra: {} };
            now.chat.push(message); now.addOneMessage(message);
            await now.saveChat();
            await ev.emit(types.CHAT_CREATED);
        };
        const apply = async () => {
            clearStartingGreeting();
            const now = getContext(), msg = now.chat[0];
            const offset = msg?.swipes?.length - alts.length;
            if (!sameCard(now) || now.chat.length !== 1 || ![0, 1].includes(offset)) return;
            const id = selected + offset;
            if (id !== msg.swipe_id && msg.swipes[id]) await now.swipe.to(null, 'left', { source: 'swipe_picker', forceSwipeId: id, forceDuration: 0 });
        };
        const timer = setTimeout(clearStartingGreeting, 30000);
        release = () => {
            clearTimeout(timer); release = null;
            ev.removeListener(types.CHAT_CREATED, apply);
            ev.removeListener(types.CHAT_LOADED, clearStartingGreeting);
            ev.removeListener(types.CHAT_CHANGED, emptyStart);
        };
        ev.on(types.CHAT_CREATED, apply);
        ev.on(types.CHAT_LOADED, clearStartingGreeting);
        if (!card.first_mes && !alts[0]) ev.on(types.CHAT_CHANGED, emptyStart);
    };
}
