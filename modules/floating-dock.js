// Unified floating dock (OOC Inject + Message Actions) and contextual jump-to-bottom arrow.

import {
    SCOPE_TOKEN,
    clamp,
    getContext,
    getSettings,
    readLocalJson,
    removeLocalKey,
    t,
    viewportRect,
    warn,
    writeLocalJson,
} from './core.js';

const META_KEY = 'ooc_inject';
const PROMPT_KEY = 'ooc-inject:chat';
const MAX_TEXT_LENGTH = 20000;
const MAX_DEPTH = 9999;

const FAB_STORE_KEY = 'dock-fab';
const PANEL_STORE_KEY = 'dock-panel';
const PANEL_EDGE_GAP = 8;
const PANEL_MIN_WIDTH = 228;
const PANEL_MIN_HEIGHT_SINGLE = 184;
const PANEL_MIN_HEIGHT_BOTH = 300;

const SVG_ICONS = Object.freeze({
    jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"/></svg>',
    actions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7"/><path d="m16 3 5 5M10 14l-1 4 4-1L22 8a2.1 2.1 0 0 0-5-5Z"/></svg>',
});

const DEFAULT_OOC_STATE = Object.freeze({
    schemaVersion: 1,
    enabled: false,
    text: '',
    depth: 0,
});

const ui = {};
const eventDisposers = [];
let running = false;
let domController = null;
let chatListeners = null;
let chatObserver = null;
let resizeObserver = null;
let targetMesObserver = null;
let chatEl = null;
let lastMesEl = null;
let watchedMesEl = null;
let rafId = 0;
let actionsDirty = false;

let availabilityBlocked = false;
let actionsOffset = 0;
let fabNormPos = null;
let panelGeom = null;
let activeGesture = null;
let suppressFabClick = false;
let suppressClickTimer = null;
let lastFabPointerType = '';
let wakeTimer = null;

function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function hasActiveChat(ctx = getContext()) {
    const id = ctx?.chatId ?? ctx?.getCurrentChatId?.();
    return id !== undefined && id !== null && id !== '';
}

function getChatState(ctx = getContext()) {
    const id = ctx?.chatId ?? ctx?.getCurrentChatId?.();
    const active = id !== undefined && id !== null && id !== '';
    return { id, active, chat: Array.isArray(ctx?.chat) ? ctx.chat : [] };
}

function normalizeOocState(value) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        schemaVersion: 1,
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_OOC_STATE.enabled,
        text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT_LENGTH) : DEFAULT_OOC_STATE.text,
        depth: clampInt(raw.depth, 0, MAX_DEPTH, DEFAULT_OOC_STATE.depth),
    };
}

function readOocState(ctx = getContext()) {
    if (!ctx?.chatMetadata || !hasActiveChat(ctx)) return { ...DEFAULT_OOC_STATE };
    return normalizeOocState(ctx.chatMetadata[META_KEY]);
}

function writeOocState(next, ctx = getContext()) {
    if (!ctx?.chatMetadata || !hasActiveChat(ctx)) return readOocState(ctx);
    const state = normalizeOocState(next);
    ctx.chatMetadata[META_KEY] = state;
    ctx.saveMetadataDebounced?.();
    return state;
}

function saveMetadataNow(ctx = getContext()) {
    try {
        ctx?.saveMetadata?.()?.catch?.((err) => warn('ooc-save', err));
    } catch (err) {
        warn('ooc-save', err);
    }
}

function imagePromptModelActive(ctx = getContext()) {
    const enabled = ctx?.extensionSettings?.inline_image_gen?.promptModel?.enabled === true;
    if (!enabled || ctx?.mainApi !== 'openai' || !hasActiveChat(ctx)) return false;
    const btn = document.getElementById('iig_pm_guidance_button');
    return Boolean(btn && !btn.classList.contains('iig-pm-guidance-hidden'));
}

function clearPromptInjection(ctx = getContext()) {
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    try {
        ctx.setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 1);
    } catch (err) {
        warn('ooc-clear', err);
    }
}

function applyOocInjection(state = readOocState(), ctx = getContext()) {
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    if (!getSettings().oocInject) {
        clearPromptInjection(ctx);
        return;
    }
    const content = state.enabled && state.text.trim() && !availabilityBlocked ? state.text : '';
    try {
        ctx.setExtensionPrompt(PROMPT_KEY, content, 1, state.depth, false, 1);
    } catch (err) {
        warn('ooc-prompt', err);
    }
}

function loadSavedGeometry() {
    const savedFab = readLocalJson(FAB_STORE_KEY);
    if (Number.isFinite(savedFab?.x) && Number.isFinite(savedFab?.y)) {
        fabNormPos = { x: clamp(savedFab.x, 0, 1), y: clamp(savedFab.y, 0, 1) };
    } else {
        fabNormPos = null;
    }

    const savedPanel = readLocalJson(PANEL_STORE_KEY);
    panelGeom = {
        left: Number.isFinite(savedPanel?.left) ? savedPanel.left : null,
        top: Number.isFinite(savedPanel?.top) ? savedPanel.top : null,
        width: Number.isFinite(savedPanel?.width) ? savedPanel.width : 300,
        heightSingle: Number.isFinite(savedPanel?.heightSingle) ? savedPanel.heightSingle : 236,
        heightBoth: Number.isFinite(savedPanel?.heightBoth) ? savedPanel.heightBoth : 380,
        splitRatio: Number.isFinite(savedPanel?.splitRatio) ? clamp(savedPanel.splitRatio, 0.24, 0.76) : 0.54,
        oocCollapsed: savedPanel?.oocCollapsed === true,
        actionsCollapsed: savedPanel?.actionsCollapsed === true,
    };
}

function savePanelGeom() {
    if (panelGeom) writeLocalJson(PANEL_STORE_KEY, panelGeom);
}

function getDockMode() {
    const s = getSettings();
    if (s.oocInject && s.chatControls) return 'both';
    if (s.oocInject) return 'ooc';
    if (s.chatControls) return 'actions';
    return 'none';
}

function scrollChatToBottom() {
    if (!chatEl) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
}

function isChatScrolledUp() {
    if (!chatEl) return false;
    return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight > 160;
}

function unwatchTargetMessage() {
    targetMesObserver?.disconnect();
    watchedMesEl = null;
}

function watchTargetMessage(mesEl) {
    if (watchedMesEl === mesEl) return;
    unwatchTargetMessage();
    if (!mesEl) return;
    watchedMesEl = mesEl;
    targetMesObserver ??= new MutationObserver(() => scheduleDockUpdate());
    targetMesObserver.observe(mesEl, {
        attributes: true,
        attributeFilter: ['mesid', 'is_system', 'bookmark_link', 'data-media-display', 'class', 'style', 'hidden', 'disabled', 'aria-disabled'],
        childList: true,
        subtree: true,
    });
}

const isFaToken = (c) => c === 'fa' || c === 'fas' || c === 'far' || c === 'fab' || c.startsWith('fa-');

function extractIconElement(srcEl) {
    const selfFa = [...srcEl.classList].filter(isFaToken);
    if (selfFa.length) {
        const icon = document.createElement('i');
        icon.className = `pt_act_icon ${selfFa.join(' ')}`;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }
    const childIcon = srcEl.querySelector('i');
    const childFa = childIcon ? [...childIcon.classList].filter(isFaToken) : [];
    if (childFa.length) {
        const icon = document.createElement('i');
        icon.className = `pt_act_icon ${childFa.join(' ')}`;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }
    const svg = srcEl.matches('svg') ? srcEl : srcEl.querySelector('svg');
    if (svg) {
        const clone = svg.cloneNode(true);
        clone.classList.add('pt_act_icon');
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('focusable', 'false');
        return clone;
    }
    const fallback = document.createElement('i');
    fallback.className = 'pt_act_icon fa-solid fa-circle-dot';
    fallback.setAttribute('aria-hidden', 'true');
    return fallback;
}

function collectMessageControls(messageEl) {
    const editWrap = messageEl.querySelector('.mes_edit_buttons');
    const normWrap = messageEl.querySelector('.mes_buttons');
    const isEditing = Boolean(editWrap && getComputedStyle(editWrap).display !== 'none');

    let candidates = [];
    if (isEditing) {
        candidates = [...editWrap.querySelectorAll('.menu_button')];
    } else if (normWrap) {
        const all = [...normWrap.querySelectorAll('.mes_button:not(.extraMesButtonsHint), .extraMesButtons > *')];
        const priority = ['.mes_edit', '.mes_copy', '.mes_bookmark'];
        const head = [];
        const rest = [];
        for (const el of all) {
            if (priority.some((sel) => el.matches(sel))) head.push(el);
            else rest.push(el);
        }
        head.sort((a, b) => priority.findIndex((s) => a.matches(s)) - priority.findIndex((s) => b.matches(s)));
        candidates = [...head, ...rest];
    }

    const items = [];
    for (const srcEl of candidates) {
        if (srcEl.hidden) continue;
        const cs = getComputedStyle(srcEl);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const fullLabel = (
            srcEl.getAttribute('data-tooltip')
            || srcEl.getAttribute('title')
            || srcEl.getAttribute('aria-label')
            || srcEl.textContent
            || ''
        ).trim();
        const shortLabel = fullLabel.split('\n')[0].trim();
        if (!shortLabel) continue;
        const disabled = srcEl.hasAttribute('disabled')
            || srcEl.classList.contains('disabled')
            || srcEl.getAttribute('aria-disabled') === 'true';
        items.push({ srcEl, shortLabel, fullLabel, disabled });
    }
    return items;
}

function isActionTargetValid(snap) {
    if (!snap) return false;
    const current = getChatState();
    return current.active
        && snap.chatId === current.id
        && snap.chat === current.chat
        && snap.message === current.chat[snap.index]
        && snap.messageEl?.isConnected
        && chatEl?.contains(snap.messageEl)
        && snap.messageEl.getAttribute('mesid') === String(snap.index);
}

function triggerNativeControl(srcEl, snap, mouseEvent) {
    if (!isActionTargetValid(snap) || !snap.messageEl.contains(srcEl)) {
        renderMessageActions();
        return;
    }
    const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: 1,
        shiftKey: Boolean(mouseEvent.shiftKey),
        ctrlKey: Boolean(mouseEvent.ctrlKey),
        metaKey: Boolean(mouseEvent.metaKey),
        altKey: Boolean(mouseEvent.altKey),
    };
    if (typeof PointerEvent === 'function') {
        srcEl.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, isPrimary: true }));
        srcEl.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, isPrimary: true }));
    }
    srcEl.dispatchEvent(new MouseEvent('click', init));
    queueMicrotask(() => scheduleDockUpdate());
}

function renderMessageActions() {
    if (!ui.actionsList) return;
    const panelVisible = ui.panel && !ui.panel.hidden && getSettings().chatControls;
    if (!panelVisible) {
        unwatchTargetMessage();
        return;
    }

    const current = getChatState();

    if (!current.active || !current.chat.length) {
        unwatchTargetMessage();
        ui.targetSelect.disabled = true;
        ui.msgCaption.textContent = '';
        ui.actionsBadge.textContent = '';
        ui.actionsList.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'pt_dock_empty';
        empty.textContent = t('dock.noChat');
        ui.actionsList.appendChild(empty);
        return;
    }

    if (current.chat.length < 2) actionsOffset = 0;
    ui.targetSelect.disabled = false;
    ui.targetSelect.options[0].textContent = t('dock.lastMsg');
    ui.targetSelect.options[1].textContent = t('dock.prevMsg');
    ui.targetSelect.options[1].disabled = current.chat.length < 2;
    ui.targetSelect.value = String(actionsOffset);

    const index = current.chat.length - 1 - actionsOffset;
    const msgName = current.chat[index]?.name || t('dock.unknownName');
    ui.msgCaption.textContent = `#${index} · ${msgName}`;
    ui.actionsBadge.textContent = `#${index}`;

    const messageEl = chatEl?.querySelector(`.mes[mesid="${index}"]`) ?? null;
    if (!messageEl) {
        unwatchTargetMessage();
        ui.actionsList.replaceChildren();
        const unavail = document.createElement('p');
        unavail.className = 'pt_dock_empty';
        unavail.textContent = t('dock.unavailable');
        ui.actionsList.appendChild(unavail);
        return;
    }

    watchTargetMessage(messageEl);
    const snap = {
        chatId: current.id,
        chat: current.chat,
        index,
        message: current.chat[index],
        messageEl,
    };

    const controls = collectMessageControls(messageEl);
    ui.actionsList.replaceChildren();
    if (!controls.length) {
        const unavail = document.createElement('p');
        unavail.className = 'pt_dock_empty';
        unavail.textContent = t('dock.unavailable');
        ui.actionsList.appendChild(unavail);
        return;
    }

    const frag = document.createDocumentFragment();
    for (const item of controls) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pt_dock_action interactable';
        btn.disabled = item.disabled;
        btn.title = item.fullLabel;
        btn.setAttribute('aria-label', item.shortLabel);
        btn.appendChild(extractIconElement(item.srcEl));
        btn.addEventListener('click', (e) => triggerNativeControl(item.srcEl, snap, e));
        frag.appendChild(btn);
    }
    ui.actionsList.appendChild(frag);
}

function createDockDom() {
    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.id = 'pt_jump_btn';
    jumpBtn.className = 'pt_float_icon interactable';
    jumpBtn.dataset.ptScope = SCOPE_TOKEN;
    jumpBtn.hidden = true;
    jumpBtn.innerHTML = SVG_ICONS.jump;

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'pt_dock_fab';
    fab.className = 'pt_float_icon interactable';
    fab.dataset.ptScope = SCOPE_TOKEN;
    fab.hidden = true;
    fab.setAttribute('aria-controls', 'pt_dock_panel');
    fab.setAttribute('aria-expanded', 'false');
    const fabGlyph = document.createElement('span');
    fabGlyph.className = 'pt_fab_glyph';
    fabGlyph.setAttribute('aria-hidden', 'true');
    fab.appendChild(fabGlyph);

    const panel = document.createElement('section');
    panel.id = 'pt_dock_panel';
    panel.className = 'pt_dock_panel';
    panel.dataset.ptScope = SCOPE_TOKEN;
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');

    const header = document.createElement('header');
    header.className = 'pt_dock_header';
    const titleEl = document.createElement('span');
    titleEl.className = 'pt_dock_title';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pt_dock_icon_btn interactable';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    header.append(titleEl, closeBtn);

    const body = document.createElement('div');
    body.className = 'pt_dock_body';

    // OOC Inject pane
    const oocPane = document.createElement('div');
    oocPane.className = 'pt_dock_pane pt_ooc_pane';

    const oocBar = document.createElement('div');
    oocBar.className = 'pt_pane_bar';
    const oocCollapseBtn = document.createElement('button');
    oocCollapseBtn.type = 'button';
    oocCollapseBtn.className = 'pt_pane_toggle interactable';
    oocCollapseBtn.innerHTML = '<i class="fa-solid fa-chevron-down pt_pane_chev" aria-hidden="true"></i><span class="pt_pane_name"></span>';
    const oocSwitchLabel = document.createElement('label');
    oocSwitchLabel.className = 'pt_ooc_enable';
    const oocEnabled = document.createElement('input');
    oocEnabled.type = 'checkbox';
    oocEnabled.id = 'pt_ooc_enabled';
    const oocEnableText = document.createElement('span');
    oocEnableText.className = 'pt_ooc_enable_text';
    oocSwitchLabel.append(oocEnabled, oocEnableText);
    const oocStatus = document.createElement('span');
    oocStatus.className = 'pt_ooc_status';
    oocStatus.setAttribute('role', 'status');
    oocStatus.setAttribute('aria-live', 'polite');
    oocBar.append(oocCollapseBtn, oocStatus, oocSwitchLabel);

    const oocContent = document.createElement('div');
    oocContent.className = 'pt_pane_content pt_ooc_content';
    const oocTextarea = document.createElement('textarea');
    oocTextarea.id = 'pt_ooc_text';
    oocTextarea.className = 'text_pole pt_ooc_textarea';
    oocTextarea.maxLength = MAX_TEXT_LENGTH;
    oocTextarea.spellcheck = true;

    const oocFooter = document.createElement('div');
    oocFooter.className = 'pt_ooc_footer';
    const oocDepthLabel = document.createElement('label');
    oocDepthLabel.className = 'pt_ooc_depth';
    const oocDepthText = document.createElement('span');
    const oocDepth = document.createElement('input');
    oocDepth.type = 'number';
    oocDepth.id = 'pt_ooc_depth';
    oocDepth.className = 'text_pole pt_ooc_depth_input';
    oocDepth.min = '0';
    oocDepth.max = String(MAX_DEPTH);
    oocDepth.step = '1';
    oocDepthLabel.append(oocDepthText, oocDepth);
    oocFooter.append(oocDepthLabel);
    oocContent.append(oocTextarea, oocFooter);
    oocPane.append(oocBar, oocContent);

    // Adjustable splitter between panes when both are enabled
    const splitter = document.createElement('div');
    splitter.className = 'pt_dock_splitter';
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'horizontal');
    splitter.setAttribute('tabindex', '0');

    // Message Actions pane
    const actionsPane = document.createElement('div');
    actionsPane.className = 'pt_dock_pane pt_actions_pane';

    const actionsBar = document.createElement('div');
    actionsBar.className = 'pt_pane_bar pt_actions_bar';
    const actionsCollapseBtn = document.createElement('button');
    actionsCollapseBtn.type = 'button';
    actionsCollapseBtn.className = 'pt_pane_toggle interactable';
    actionsCollapseBtn.innerHTML = '<i class="fa-solid fa-chevron-down pt_pane_chev" aria-hidden="true"></i><span class="pt_pane_name"></span>';
    const actionsBadge = document.createElement('span');
    actionsBadge.className = 'pt_actions_badge';
    actionsBar.append(actionsCollapseBtn, actionsBadge);

    const actionsContent = document.createElement('div');
    actionsContent.className = 'pt_pane_content pt_actions_content';
    const targetSelect = document.createElement('select');
    targetSelect.className = 'pt_target_select';
    targetSelect.add(new Option('', '0'));
    targetSelect.add(new Option('', '1'));

    const msgCaption = document.createElement('div');
    msgCaption.className = 'pt_msg_caption';
    const actionsList = document.createElement('div');
    actionsList.className = 'pt_actions_list';
    actionsContent.append(targetSelect, msgCaption, actionsList);
    actionsPane.append(actionsBar, actionsContent);

    body.append(oocPane, splitter, actionsPane);

    const grip = document.createElement('div');
    grip.className = 'pt_dock_grip';
    grip.setAttribute('aria-hidden', 'true');

    panel.append(header, body, grip);
    document.body.append(jumpBtn, fab, panel);

    Object.assign(ui, {
        jumpBtn,
        fab,
        fabGlyph,
        panel,
        header,
        titleEl,
        closeBtn,
        body,
        oocPane,
        oocCollapseBtn,
        oocPaneName: oocCollapseBtn.querySelector('.pt_pane_name'),
        oocEnabled,
        oocEnableText,
        oocStatus,
        oocContent,
        oocTextarea,
        oocDepthText,
        oocDepth,
        splitter,
        actionsPane,
        actionsBar,
        actionsCollapseBtn,
        actionsPaneName: actionsCollapseBtn.querySelector('.pt_pane_name'),
        actionsBadge,
        actionsContent,
        targetSelect,
        msgCaption,
        actionsList,
        grip,
    });
}

function syncDockLabels() {
    if (!ui.panel) return;
    const mode = getDockMode();
    const titleKey = mode === 'both' ? 'dock.titleBoth' : mode === 'ooc' ? 'dock.titleOoc' : 'dock.titleActions';
    const titleText = t(titleKey);
    ui.titleEl.textContent = titleText;
    ui.panel.setAttribute('aria-label', titleText);

    const fabLabel = mode === 'ooc' ? t('dock.titleOoc') : mode === 'actions' ? t('dock.titleActions') : t('dock.open');
    ui.fab.title = `${fabLabel} · ${t('dock.dragHint')}`;
    ui.fab.setAttribute('aria-label', fabLabel);

    ui.jumpBtn.title = t('dock.jump');
    ui.jumpBtn.setAttribute('aria-label', t('dock.jump'));
    ui.closeBtn.title = t('dock.close');
    ui.closeBtn.setAttribute('aria-label', t('dock.close'));
    ui.splitter.setAttribute('aria-label', t('dock.split'));
    ui.grip.title = t('dock.resize');

    ui.oocPaneName.textContent = t('dock.oocSection');
    ui.oocEnableText.textContent = mode === 'both' ? '' : t('dock.oocToggle');
    ui.oocEnabled.title = t('dock.oocToggle');
    ui.oocEnabled.setAttribute('aria-label', t('dock.oocToggle'));
    ui.oocTextarea.placeholder = t('dock.oocPlaceholder');
    ui.oocTextarea.setAttribute('aria-label', t('dock.oocText'));
    ui.oocDepthText.textContent = t('dock.oocDepth');
    ui.actionsPaneName.textContent = t('dock.actionsSection');
    ui.targetSelect.setAttribute('aria-label', t('dock.targetLabel'));
}

function refreshOocUi(state = readOocState()) {
    if (!ui.fab) return;
    const s = getSettings();
    const hasChat = hasActiveChat();

    if (ui.oocEnabled.checked !== state.enabled) ui.oocEnabled.checked = state.enabled;
    ui.oocEnabled.disabled = !hasChat || availabilityBlocked;
    if (ui.oocTextarea.value !== state.text) ui.oocTextarea.value = state.text;
    ui.oocTextarea.disabled = !hasChat;
    if (ui.oocDepth.value !== String(state.depth)) ui.oocDepth.value = String(state.depth);
    ui.oocDepth.disabled = !hasChat;

    const oocLive = s.oocInject && hasChat && state.enabled && Boolean(state.text.trim()) && !availabilityBlocked;
    ui.fab.classList.toggle('is-active', oocLive);
    ui.fab.classList.toggle('is-blocked', s.oocInject && availabilityBlocked);
    ui.oocStatus.classList.toggle('is-active', oocLive);

    if (availabilityBlocked) ui.oocStatus.textContent = t('dock.oocBlocked');
    else if (!hasChat) ui.oocStatus.textContent = t('dock.oocNoChat');
    else if (!state.enabled) ui.oocStatus.textContent = t('dock.oocOff');
    else if (!state.text.trim()) ui.oocStatus.textContent = t('dock.oocEmpty');
    else ui.oocStatus.textContent = t('dock.oocActive');
}

function reconcileOocAvailability() {
    const ctx = getContext();
    const s = getSettings();
    availabilityBlocked = s.oocInject && imagePromptModelActive(ctx);
    const state = readOocState(ctx);
    refreshOocUi(state);
    applyOocInjection(state, ctx);
}

function syncDockStructure() {
    if (!ui.panel) return;
    const s = getSettings();
    const mode = getDockMode();
    ui.panel.dataset.dockMode = mode;

    const fabGlyphMode = s.oocInject ? 'ooc' : 'actions';
    if (ui.fab.dataset.glyphMode !== fabGlyphMode) {
        ui.fab.dataset.glyphMode = fabGlyphMode;
        ui.fabGlyph.innerHTML = fabGlyphMode === 'ooc'
            ? '<i class="fa-solid fa-star" aria-hidden="true"></i>'
            : SVG_ICONS.actions;
    }

    ui.fab.classList.toggle('is-shy', s.dockShy);
    if (!s.dockShy) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
        ui.fab.classList.remove('is-awake');
    }

    ui.oocPane.hidden = !s.oocInject;
    ui.actionsPane.hidden = !s.chatControls;

    const isBoth = mode === 'both';
    ui.oocCollapseBtn.hidden = !isBoth;
    ui.actionsBar.hidden = !isBoth;

    let oocCollapsed = isBoth && Boolean(panelGeom?.oocCollapsed);
    let actionsCollapsed = isBoth && Boolean(panelGeom?.actionsCollapsed);
    if (oocCollapsed && actionsCollapsed) actionsCollapsed = false;

    ui.oocPane.classList.toggle('is-collapsed', oocCollapsed);
    ui.oocContent.hidden = oocCollapsed;
    ui.oocCollapseBtn.setAttribute('aria-expanded', String(!oocCollapsed));

    ui.actionsPane.classList.toggle('is-collapsed', actionsCollapsed);
    ui.actionsContent.hidden = actionsCollapsed;
    ui.actionsCollapseBtn.setAttribute('aria-expanded', String(!actionsCollapsed));

    const showSplitter = isBoth && !oocCollapsed && !actionsCollapsed;
    ui.splitter.hidden = !showSplitter;
    ui.body.style.setProperty('--pt-split', `${((panelGeom?.splitRatio ?? 0.54) * 100).toFixed(1)}%`);

    syncDockLabels();
}

function setXY(el, x, y) {
    const px = `${Math.round(x)}px`;
    const py = `${Math.round(y)}px`;
    if (el.style.getPropertyValue('--pt-x') !== px) el.style.setProperty('--pt-x', px);
    if (el.style.getPropertyValue('--pt-y') !== py) el.style.setProperty('--pt-y', py);
}

function getFabAnchorBounds() {
    const vp = viewportRect(0);
    const w = ui.fab.offsetWidth || 32;
    const h = ui.fab.offsetHeight || 32;
    const glyphRect = ui.fabGlyph.getBoundingClientRect();
    const gw = glyphRect.width || 16;
    const gh = glyphRect.height || 16;
    const insetX = Math.max(0, (w - gw * 1.2) / 2);
    const insetY = Math.max(0, (h - gh * 1.2) / 2);
    return {
        minX: vp.left + w - insetX,
        minY: vp.top + h - insetY,
        maxX: vp.right + insetX,
        maxY: vp.bottom + insetY,
    };
}

function getEffectiveMinHeight() {
    const mode = getDockMode();
    if (mode === 'both' && !panelGeom?.oocCollapsed && !panelGeom?.actionsCollapsed) {
        return PANEL_MIN_HEIGHT_BOTH;
    }
    return PANEL_MIN_HEIGHT_SINGLE;
}

function clampPanelToViewport() {
    if (!ui.panel || ui.panel.hidden || !panelGeom) return;
    const vp = viewportRect(PANEL_EDGE_GAP);
    const mode = getDockMode();
    const maxW = Math.max(180, vp.width);
    const maxH = Math.max(170, vp.height);
    const minW = Math.min(PANEL_MIN_WIDTH, maxW);
    const minH = Math.min(getEffectiveMinHeight(), maxH);

    const desiredH = mode === 'both' ? panelGeom.heightBoth : panelGeom.heightSingle;
    const width = clamp(panelGeom.width, minW, maxW);
    const height = clamp(desiredH, minH, maxH);

    let left = panelGeom.left;
    let top = panelGeom.top;
    if (left === null || top === null) {
        const fabRect = !ui.fab.hidden ? ui.fab.getBoundingClientRect() : null;
        left = fabRect ? fabRect.right - width : vp.right - width - 8;
        top = fabRect ? fabRect.top - height - 8 : vp.bottom - height - 48;
        if (top < vp.top && fabRect) top = fabRect.bottom + 8;
    }

    left = clamp(left, vp.left, Math.max(vp.left, vp.right - width));
    top = clamp(top, vp.top, Math.max(vp.top, vp.bottom - height));

    ui.panel.style.width = `${Math.round(width)}px`;
    ui.panel.style.height = `${Math.round(height)}px`;
    ui.panel.style.left = `${Math.round(left)}px`;
    ui.panel.style.top = `${Math.round(top)}px`;
}

function setDockOpen(open, restoreFocus = false) {
    if (!ui.panel) return;
    const mode = getDockMode();
    const nextOpen = Boolean(open && mode !== 'none');
    ui.panel.hidden = !nextOpen;
    ui.fab?.setAttribute('aria-expanded', String(nextOpen));

    if (nextOpen) {
        syncDockStructure();
        reconcileOocAvailability();
        renderMessageActions();
        clampPanelToViewport();
        ui.closeBtn?.focus({ preventScroll: true });
    } else {
        unwatchTargetMessage();
        if (restoreFocus && ui.fab && !ui.fab.hidden) {
            ui.fab.focus({ preventScroll: true });
        }
    }
}

function wakeFab() {
    ui.fab?.classList.add('is-awake');
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
        wakeTimer = null;
        ui.fab?.classList.remove('is-awake');
    }, 2600);
}

function bindChatElement() {
    const next = document.getElementById('chat');
    if (next !== chatEl) {
        chatListeners?.abort();
        chatObserver?.disconnect();
        resizeObserver?.disconnect();
        unwatchTargetMessage();
        chatEl = next;
        lastMesEl = null;
        if (next) {
            chatListeners = new AbortController();
            next.addEventListener('scroll', scheduleLayout, { passive: true, signal: chatListeners.signal });
            next.addEventListener('load', scheduleLayout, { capture: true, signal: chatListeners.signal });
            chatObserver?.observe(next, { childList: true });
            resizeObserver?.observe(next);
        }
    }
    const latest = chatEl?.lastElementChild ?? null;
    if (latest !== lastMesEl) {
        if (lastMesEl) resizeObserver?.unobserve(lastMesEl);
        lastMesEl = latest;
        if (lastMesEl) resizeObserver?.observe(lastMesEl);
    }
}

function updateDockLayout(refreshActions = true) {
    if (!running || !ui.fab) return;
    bindChatElement();
    const s = getSettings();
    const mode = getDockMode();
    const current = getChatState();
    const chatRect = chatEl?.getBoundingClientRect();
    const vp = viewportRect(8);

    const bounds = {
        left: Math.max(vp.left, (chatRect?.left || 0) + 8),
        top: Math.max(vp.top, (chatRect?.top || 0) + 8),
        right: Math.min(vp.right, (chatRect?.right || 0) - 12),
        bottom: Math.min(vp.bottom, (chatRect?.bottom || 0) - 12),
    };
    const chatVisible = current.active
        && current.chat.length > 0
        && Boolean(chatRect && chatRect.width > 0 && chatRect.height > 0)
        && bounds.right - bounds.left >= 46
        && bounds.bottom - bounds.top >= 110;

    const showJump = s.jumpToBottom && chatVisible && isChatScrolledUp();
    ui.jumpBtn.hidden = !showJump;
    if (showJump) {
        setXY(ui.jumpBtn, bounds.right, bounds.bottom);
    }

    const showFab = mode === 'ooc' || mode === 'both'
        ? true
        : (mode === 'actions' && chatVisible);

    ui.fab.hidden = !showFab;
    if (!showFab) {
        activeGesture?.abort();
        activeGesture = null;
        if (!ui.panel.hidden) setDockOpen(false);
        return;
    }

    syncDockStructure();

    if (activeGesture?.mode !== 'fab') {
        let fx;
        let fy;
        if (fabNormPos) {
            const { minX, minY, maxX, maxY } = getFabAnchorBounds();
            fx = minX + fabNormPos.x * Math.max(0, maxX - minX);
            fy = minY + fabNormPos.y * Math.max(0, maxY - minY);
        } else if (chatVisible) {
            const jumpOffset = showJump ? (ui.jumpBtn.offsetHeight || 32) + 8 : 0;
            fx = bounds.right;
            fy = bounds.bottom - jumpOffset;
        } else {
            fx = vp.right - 6;
            fy = Math.max(vp.top + 48, vp.bottom - 128);
        }
        setXY(ui.fab, fx, fy);
    }

    if (!ui.panel.hidden) {
        if (refreshActions) renderMessageActions();
        if (!activeGesture) clampPanelToViewport();
    }
}

function scheduleDockUpdate() {
    actionsDirty = true;
    scheduleLayout();
}

function scheduleLayout() {
    if (!running || rafId) return;
    rafId = requestAnimationFrame(() => {
        rafId = 0;
        const refreshActions = actionsDirty;
        actionsDirty = false;
        updateDockLayout(refreshActions);
    });
}

function startDockGesture(event, mode) {
    if (!event.isPrimary || event.button !== 0) return;
    if (mode === 'panel-drag' && event.target instanceof Element && event.target.closest('button, input, textarea, select, label')) {
        return;
    }

    activeGesture?.abort();
    const ctrl = new AbortController();
    ctrl.mode = mode;
    activeGesture = ctrl;

    const source = event.currentTarget;
    const panelRect = ui.panel.getBoundingClientRect();
    const bodyRect = ui.body.getBoundingClientRect();
    const startFabX = Number.parseFloat(ui.fab.style.getPropertyValue('--pt-x')) || 0;
    const startFabY = Number.parseFloat(ui.fab.style.getPropertyValue('--pt-y')) || 0;
    const startSplit = panelGeom?.splitRatio ?? 0.54;

    let curFabX = startFabX;
    let curFabY = startFabY;
    let moved = false;

    source.setPointerCapture?.(event.pointerId);
    if (mode !== 'fab') event.preventDefault();

    const onMove = (ev) => {
        if (ev.pointerId !== event.pointerId) return;
        const dx = ev.clientX - event.clientX;
        const dy = ev.clientY - event.clientY;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        if (!moved) {
            moved = true;
            if (mode === 'fab') ui.fab.classList.add('is-dragging');
        }

        if (mode === 'fab') {
            const { minX, minY, maxX, maxY } = getFabAnchorBounds();
            curFabX = clamp(startFabX + dx, minX, maxX);
            curFabY = clamp(startFabY + dy, minY, maxY);
            setXY(ui.fab, curFabX, curFabY);
            return;
        }

        const vp = viewportRect(PANEL_EDGE_GAP);
        if (mode === 'panel-drag') {
            const left = clamp(panelRect.left + dx, vp.left, Math.max(vp.left, vp.right - panelRect.width));
            const top = clamp(panelRect.top + dy, vp.top, Math.max(vp.top, vp.bottom - panelRect.height));
            ui.panel.style.left = `${Math.round(left)}px`;
            ui.panel.style.top = `${Math.round(top)}px`;
        } else if (mode === 'panel-resize') {
            const minW = Math.min(PANEL_MIN_WIDTH, vp.width);
            const minH = Math.min(getEffectiveMinHeight(), vp.height);
            const maxW = Math.max(minW, vp.right - panelRect.left);
            const maxH = Math.max(minH, vp.bottom - panelRect.top);
            const w = clamp(panelRect.width + dx, minW, maxW);
            const h = clamp(panelRect.height + dy, minH, maxH);
            ui.panel.style.width = `${Math.round(w)}px`;
            ui.panel.style.height = `${Math.round(h)}px`;
        } else if (mode === 'splitter') {
            const nextRatio = clamp(startSplit + dy / Math.max(120, bodyRect.height), 0.24, 0.76);
            panelGeom.splitRatio = nextRatio;
            ui.body.style.setProperty('--pt-split', `${(nextRatio * 100).toFixed(1)}%`);
        }
    };

    const finish = (cancelled) => {
        try { source.releasePointerCapture?.(event.pointerId); } catch { /* Already released. */ }
        if (activeGesture === ctrl) activeGesture = null;
        ctrl.abort();

        if (mode === 'fab') {
            ui.fab.classList.remove('is-dragging');
            suppressFabClick = moved && !cancelled;
            clearTimeout(suppressClickTimer);
            suppressClickTimer = suppressFabClick
                ? setTimeout(() => {
                    suppressFabClick = false;
                    suppressClickTimer = null;
                }, 300)
                : null;
            if (cancelled) lastFabPointerType = '';
            if (moved && !cancelled) {
                const { minX, minY, maxX, maxY } = getFabAnchorBounds();
                fabNormPos = {
                    x: clamp((curFabX - minX) / Math.max(1, maxX - minX), 0, 1),
                    y: clamp((curFabY - minY) / Math.max(1, maxY - minY), 0, 1),
                };
                writeLocalJson(FAB_STORE_KEY, fabNormPos);
            }
            scheduleLayout();
            return;
        }

        if (moved && !cancelled && panelGeom) {
            const r = ui.panel.getBoundingClientRect();
            if (mode === 'panel-drag') {
                panelGeom.left = r.left;
                panelGeom.top = r.top;
            } else if (mode === 'panel-resize') {
                panelGeom.width = r.width;
                if (getDockMode() === 'both') panelGeom.heightBoth = r.height;
                else panelGeom.heightSingle = r.height;
            }
            savePanelGeom();
            clampPanelToViewport();
        }
    };

    source.addEventListener('pointermove', onMove, { signal: ctrl.signal });
    source.addEventListener('pointerup', () => finish(false), { signal: ctrl.signal, once: true });
    source.addEventListener('pointercancel', () => finish(true), { signal: ctrl.signal, once: true });
    source.addEventListener('lostpointercapture', () => finish(false), { signal: ctrl.signal, once: true });
}

function updateOocStatePatch(patch) {
    const current = readOocState();
    const next = writeOocState({ ...current, ...patch });
    refreshOocUi(next);
    applyOocInjection(next);
}

function bindDockDomEvents() {
    const sig = domController.signal;

    ui.jumpBtn.addEventListener('click', scrollChatToBottom, { signal: sig });

    ui.fab.addEventListener('pointerdown', (e) => {
        lastFabPointerType = e.pointerType || '';
        startDockGesture(e, 'fab');
    }, { signal: sig });

    ui.fab.addEventListener('click', (e) => {
        const pointerType = e.pointerType || lastFabPointerType;
        lastFabPointerType = '';
        if (suppressFabClick && e.detail !== 0) {
            suppressFabClick = false;
            clearTimeout(suppressClickTimer);
            suppressClickTimer = null;
            e.preventDefault();
            return;
        }
        const shy = getSettings().dockShy;
        if (shy && pointerType === 'touch' && e.detail !== 0 && !ui.fab.classList.contains('is-awake')) {
            wakeFab();
            return;
        }
        if (shy) wakeFab();
        setDockOpen(ui.panel.hidden, !ui.panel.hidden);
    }, { signal: sig });

    ui.header.addEventListener('pointerdown', (e) => startDockGesture(e, 'panel-drag'), { signal: sig });
    ui.grip.addEventListener('pointerdown', (e) => startDockGesture(e, 'panel-resize'), { signal: sig });
    ui.splitter.addEventListener('pointerdown', (e) => startDockGesture(e, 'splitter'), { signal: sig });
    ui.splitter.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 0.05 : -0.05;
        panelGeom.splitRatio = clamp((panelGeom.splitRatio ?? 0.54) + delta, 0.24, 0.76);
        ui.body.style.setProperty('--pt-split', `${(panelGeom.splitRatio * 100).toFixed(1)}%`);
        savePanelGeom();
    }, { signal: sig });

    ui.closeBtn.addEventListener('click', () => setDockOpen(false, true), { signal: sig });

    ui.oocCollapseBtn.addEventListener('click', () => {
        if (getDockMode() !== 'both') return;
        panelGeom.oocCollapsed = !panelGeom.oocCollapsed;
        if (panelGeom.oocCollapsed && panelGeom.actionsCollapsed) {
            panelGeom.actionsCollapsed = false;
        }
        savePanelGeom();
        syncDockStructure();
        clampPanelToViewport();
    }, { signal: sig });

    ui.actionsCollapseBtn.addEventListener('click', () => {
        if (getDockMode() !== 'both') return;
        panelGeom.actionsCollapsed = !panelGeom.actionsCollapsed;
        if (panelGeom.actionsCollapsed && panelGeom.oocCollapsed) {
            panelGeom.oocCollapsed = false;
        }
        savePanelGeom();
        syncDockStructure();
        renderMessageActions();
        clampPanelToViewport();
    }, { signal: sig });

    ui.oocEnabled.addEventListener('change', () => {
        const requested = ui.oocEnabled.checked;
        reconcileOocAvailability();
        if (availabilityBlocked) return;
        updateOocStatePatch({ enabled: requested });
        saveMetadataNow();
    }, { signal: sig });

    ui.oocTextarea.addEventListener('input', () => updateOocStatePatch({ text: ui.oocTextarea.value }), { signal: sig });
    ui.oocTextarea.addEventListener('change', () => saveMetadataNow(), { signal: sig });
    ui.oocDepth.addEventListener('change', () => {
        const depth = clampInt(ui.oocDepth.value, 0, MAX_DEPTH, 0);
        updateOocStatePatch({ depth });
        saveMetadataNow();
    }, { signal: sig });

    ui.targetSelect.addEventListener('change', () => {
        actionsOffset = ui.targetSelect.value === '1' ? 1 : 0;
        renderMessageActions();
    }, { signal: sig });

    document.addEventListener('change', (e) => {
        if (e.target instanceof Element && e.target.id === 'iig_pm_enabled') {
            queueMicrotask(() => { if (running) reconcileOocAvailability(); });
        }
    }, { signal: sig });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || ui.panel.hidden) return;
        if (document.querySelector('dialog[open]')) return;
        if (e.target instanceof Element
            && e.target !== document.body
            && !e.target.closest('#pt_dock_fab, #pt_dock_panel')) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setDockOpen(false, true);
    }, { capture: true, signal: sig });

    window.addEventListener('resize', scheduleDockUpdate, { passive: true, signal: sig });
    window.visualViewport?.addEventListener('resize', scheduleDockUpdate, { passive: true, signal: sig });
    window.visualViewport?.addEventListener('scroll', scheduleLayout, { passive: true, signal: sig });
}

export function bindDockRuntimeEvents() {
    if (eventDisposers.length > 0) return true;
    const ctx = getContext();
    const ev = ctx?.eventSource;
    const types = ctx?.eventTypes || ctx?.event_types;
    if (!ev?.on || !types) return false;

    const add = (key, fn) => {
        const name = types[key];
        if (!name) return;
        ev.on(name, fn);
        eventDisposers.push(() => ev.removeListener?.(name, fn));
    };

    add('CHAT_CHANGED', () => {
        actionsOffset = 0;
        activeGesture?.abort();
        activeGesture = null;
        reconcileOocAvailability();
        scheduleDockUpdate();
    });
    add('GENERATION_AFTER_COMMANDS', (_type, _opts, dryRun) => {
        if (!dryRun) reconcileOocAvailability();
    });
    add('MAIN_API_CHANGED', () => reconcileOocAvailability());

    for (const key of [
        'APP_READY',
        'CHARACTER_MESSAGE_RENDERED',
        'USER_MESSAGE_RENDERED',
        'MORE_MESSAGES_LOADED',
        'MESSAGE_SWIPED',
        'MESSAGE_EDITED',
        'MESSAGE_UPDATED',
        'MESSAGE_DELETED',
        'GENERATION_STARTED',
        'GENERATION_STOPPED',
        'GENERATION_ENDED',
    ]) {
        add(key, scheduleDockUpdate);
    }

    return true;
}

export function syncFloatingDock() {
    if (!running) return false;
    syncDockStructure();
    reconcileOocAvailability();
    updateDockLayout();
    return true;
}

export function resetDockGeometry() {
    activeGesture?.abort();
    activeGesture = null;
    fabNormPos = null;
    removeLocalKey(FAB_STORE_KEY);
    removeLocalKey(PANEL_STORE_KEY);
    loadSavedGeometry();
    if (running) {
        syncDockStructure();
        updateDockLayout();
        if (ui.panel && !ui.panel.hidden) clampPanelToViewport();
    }
}

export function enableFloatingDock() {
    if (running) {
        bindDockRuntimeEvents();
        syncFloatingDock();
        return true;
    }
    if (!document.body) return false;
    running = true;
    domController = new AbortController();
    loadSavedGeometry();
    try {
        createDockDom();
        resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleLayout) : null;
        chatObserver = new MutationObserver(scheduleDockUpdate);
        bindDockDomEvents();
        bindDockRuntimeEvents();
        syncFloatingDock();
        return true;
    } catch (err) {
        cleanupFloatingDock();
        warn('dock-init', err);
        return false;
    }
}

export function cleanupFloatingDock() {
    running = false;
    actionsDirty = false;
    activeGesture?.abort();
    activeGesture = null;
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
    }
    clearTimeout(suppressClickTimer);
    suppressClickTimer = null;
    suppressFabClick = false;
    lastFabPointerType = '';
    clearTimeout(wakeTimer);
    wakeTimer = null;

    clearPromptInjection();

    unwatchTargetMessage();
    targetMesObserver = null;
    domController?.abort();
    domController = null;
    chatListeners?.abort();
    chatListeners = null;
    chatObserver?.disconnect();
    chatObserver = null;
    resizeObserver?.disconnect();
    resizeObserver = null;

    while (eventDisposers.length) eventDisposers.pop()();

    ui.jumpBtn?.remove();
    ui.fab?.remove();
    ui.panel?.remove();
    for (const k of Object.keys(ui)) delete ui[k];
    chatEl = null;
    lastMesEl = null;
    availabilityBlocked = false;
    actionsOffset = 0;
}
