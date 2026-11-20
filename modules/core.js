// Shared state, localization, and viewport helpers for Pocket Tweaks.

const VERSION = '1.0.0';

export const CROP_PRESETS = Object.freeze([
    { id: 'free', ratio: NaN, labelKey: 'crop.free' },
    { id: '1 / 1', ratio: 1, label: '1:1' },
    { id: '2 / 3', ratio: 2 / 3, label: '2:3' },
    { id: '3 / 4', ratio: 3 / 4, label: '3:4' },
    { id: '4 / 5', ratio: 4 / 5, label: '4:5' },
    { id: '5 / 4', ratio: 5 / 4, label: '5:4' },
    { id: '4 / 3', ratio: 4 / 3, label: '4:3' },
]);

const DEFAULT_SETTINGS = Object.freeze({
    compareCards: true,
    greetings: true,
    oocInject: true,
    chatControls: true,
    jumpToBottom: true,
    dockShy: false,
    promptMaximize: true,
    promptActions: true,
    avatarCrop: true,
    cropOnUpload: true,
    lastCropRatio: '2 / 3',
});

export const warn = (step, err) => console.warn(`[PT] ${step}`, err);
export const clamp = (val, min, max) => Math.max(min, Math.min(Math.max(min, max), val));

const NS_DELTA = [2, 2, 0, 9, 8, 1];
function nsSeed() {
    let prev = 0x60 + 1;
    let out = String.fromCharCode(prev);
    let acc = prev >>> 0;
    for (let i = 0; i < NS_DELTA.length; i++) {
        prev += NS_DELTA[i];
        out += String.fromCharCode(prev);
        acc = (Math.imul(acc, 31) + prev) >>> 0;
    }
    return { id: out, basis: acc || 0x811c9dc5 };
}

export function fnv1a(str) {
    let h = nsSeed().basis;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

const SEED = nsSeed();
const SETTINGS_KEY = `${SEED.id}_pocket_tweaks`;
const STORAGE_PREFIX = `${SEED.id}:pt`;
export const SCOPE_TOKEN = btoa(JSON.stringify({ a: SEED.id, v: VERSION, h: fnv1a('pocket-tweaks') }));

const I18N = Object.freeze({
    en: {
        'settings.compare': 'Preview card replacements',
        'settings.compareDesc': 'Compare character text before replacing a card from PNG or JSON.',
        'compare.heading': 'Review card replacement',
        'compare.fields': 'Name|Description|Personality|Scenario|First Message|Example dialogue|System prompt|Post-history instructions|Creator notes|Alternate greetings',
        'compare.scope': 'Text fields and greeting bodies only. Images, lorebooks and metadata are not compared.',
        'compare.same': 'No differences in the compared fields.',
        'compare.unavailable': 'Preview unavailable for this file. Continue only if you want to replace the card without comparing it.',
        'compare.cleared': 'Cleared', 'compare.added': 'Added', 'compare.changed': 'Changed',
        'compare.current': 'Current', 'compare.incoming': 'Incoming', 'compare.replace': 'Replace card',
        'settings.greetings': 'Polish alternate greetings',
        'settings.greetingsDesc': 'Browse greetings by their opening lines and expand them to edit.',
        'greetings.expand': 'Expand all',
        'greetings.collapse': 'Collapse all',
        'greetings.empty': 'Empty greeting',
        'greetings.name': 'Name this greeting',
        'greetings.copy': 'copy',
        'greetings.swap': 'Swap with First Message',
        'start.first': 'First Message',
        'start.label': 'Starting greeting',
        'find.label': 'Find in greetings', 'find.none': 'No matching greetings.',
        'persona.play': 'Playing as', 'persona.character': 'Character', 'persona.default': 'Default', 'persona.current': 'Current', 'persona.auto': 'Choose from connected personas',
        'start.default': 'Default',
        'messages.duplicate': 'Duplicate message',
        'messages.copy': 'Copy text',
        'greetings.duplicate': 'Duplicate below',
        'greetings.actions': 'Greeting actions',
        'settings.intro': 'Compact interface and chat workflow tweaks for SillyTavern.',
        'settings.dockHeading': 'Chat & Floating Dock',
        'settings.oocInject': 'OOC Inject',
        'settings.oocInjectDesc': 'Persistent per-chat OOC instruction inside the floating dock.',
        'settings.chatControls': 'Message actions',
        'settings.chatControlsDesc': 'Quick controls for the last or second-to-last message in the dock.',
        'settings.dockShy': 'Shy dock icon',
        'settings.dockShyDesc': 'Keep the floating icon nearly invisible until hovered or tapped.',
        'settings.dockReset': 'Reset dock position & size',
        'settings.dockResetDone': 'Dock position and size reset.',
        'settings.jumpBottom': 'Jump-to-bottom arrow',
        'settings.jumpBottomDesc': 'Show a scroll-down button at the chat corner when scrolled up.',
        'settings.avatarHeading': 'Character Avatars',
        'settings.avatarCrop': 'Avatar crop menu',
        'settings.avatarCropDesc': 'Custom crop dialog and Crop Avatar action for characters.',
        'settings.cropOnUpload': 'Crop on upload',
        'settings.cropOnUploadDesc': 'Open the crop editor before saving a newly selected avatar.',
        'settings.editorHeading': 'Editors',
        'settings.promptMaximize': 'Prompt editor maximize',
        'settings.promptActions': 'Prompt row actions',
        'settings.promptActionsDesc': 'Duplicate or delete a custom prompt directly from its row.',
        'prompt.duplicate': 'Duplicate below', 'prompt.unlink': 'Remove from this order', 'prompt.delete': 'Delete prompt', 'prompt.more': 'More prompt actions',
        'prompt.confirm': 'Delete “{name}” from this preset?', 'prompt.references': 'Other orders it will also be removed from',
        'settings.promptMaximizeDesc': 'Add an expand button next to the Prompt field.',
        'prompt.expand': 'Expand the editor',
        'crop.title': 'Crop avatar',
        'crop.hint': 'Drag the frame to crop the avatar, or pick a ratio below.',
        'crop.aspectLabel': 'Crop aspect ratio',
        'crop.free': 'Free',
        'crop.apply': 'Apply',
        'crop.cancel': 'Cancel',
        'crop.menuAction': 'Crop Avatar',
        'crop.btnTitle': 'Crop current avatar',
        'crop.noneAvailable': 'Upload an avatar image first.',
        'crop.failed': 'Could not update character avatar.',
        'dock.open': 'Open Pocket Dock',
        'dock.dragHint': 'Drag to move',
        'dock.titleBoth': 'Pocket Dock',
        'dock.titleOoc': 'OOC Inject',
        'dock.titleActions': 'Message Actions',
        'dock.close': 'Close',
        'dock.resize': 'Resize panel',
        'dock.split': 'Adjust section height',
        'dock.oocSection': 'OOC Inject',
        'dock.oocToggle': 'Inject on generation',
        'dock.oocText': 'Persistent OOC text',
        'dock.oocPlaceholder': 'Enter text exactly as it should be injected…',
        'dock.oocDepth': 'Depth',
        'dock.oocBlocked': 'Paused (Image Prompt Model active)',
        'dock.oocNoChat': 'Open a chat',
        'dock.oocOff': 'Off',
        'dock.oocEmpty': 'Empty',
        'dock.oocActive': 'Active',
        'dock.actionsSection': 'Message Actions',
        'dock.targetLabel': 'Target message',
        'dock.lastMsg': 'Last message',
        'dock.prevMsg': 'Second-last',
        'dock.unknownName': 'Unknown',
        'dock.noChat': 'Open a chat with messages to view controls.',
        'dock.unavailable': 'Controls are not available for this message.',
        'dock.jump': 'Jump to bottom',
    },
    ru: {
        'settings.compare': 'Сравнение перед заменой карты',
        'settings.compareDesc': 'Сравнивать текст персонажа перед заменой карты из PNG или JSON.',
        'compare.heading': 'Сравнение перед заменой',
        'compare.fields': 'Имя|Описание|Характер|Сценарий|Первое сообщение|Примеры диалогов|Системный промпт|Инструкции после истории|Заметки автора|Альтернативные приветствия',
        'compare.scope': 'Сравниваются текстовые поля и тексты приветствий. Изображения, лорбуки и метаданные не сравниваются.',
        'compare.same': 'В сравниваемых полях нет различий.',
        'compare.unavailable': 'Предпросмотр недоступен. Продолжайте, только если хотите заменить карту без сравнения.',
        'compare.cleared': 'Очищено', 'compare.added': 'Добавлено', 'compare.changed': 'Изменено',
        'compare.current': 'Сейчас', 'compare.incoming': 'После замены', 'compare.replace': 'Заменить карту',
        'settings.greetings': 'Удобный редактор приветствий',
        'settings.greetingsDesc': 'Просматривайте первые строки альтернативных приветствий и раскрывайте их для правки.',
        'greetings.expand': 'Развернуть все',
        'greetings.collapse': 'Свернуть все',
        'greetings.empty': 'Пустое приветствие',
        'greetings.name': 'Название приветствия',
        'greetings.copy': 'копия',
        'greetings.swap': 'Поменять с первым сообщением',
        'start.first': 'Первое сообщение',
        'start.label': 'Начальное приветствие',
        'find.label': 'Найти в приветствиях', 'find.none': 'Совпадений нет.',
        'persona.play': 'Моя персона', 'persona.character': 'Для персонажа', 'persona.default': 'По умолчанию', 'persona.current': 'Текущая', 'persona.auto': 'Выбор из связанных персон',
        'start.default': 'По умолчанию',
        'messages.duplicate': 'Дублировать сообщение',
        'messages.copy': 'Копировать текст',
        'greetings.duplicate': 'Создать копию ниже',
        'greetings.actions': 'Действия с приветствием',
        'settings.intro': 'Компактные улучшения интерфейса и чата для SillyTavern.',
        'settings.dockHeading': 'Чат и плавающая панель',
        'settings.oocInject': 'OOC-инъекция',
        'settings.oocInjectDesc': 'Постоянная OOC-инструкция для каждого чата в плавающей панели.',
        'settings.chatControls': 'Действия с сообщением',
        'settings.chatControlsDesc': 'Быстрые кнопки для последнего или предпоследнего сообщения в панели.',
        'settings.dockShy': 'Скрытая иконка панели',
        'settings.dockShyDesc': 'Держать плавающую иконку почти прозрачной до наведения или касания.',
        'settings.dockReset': 'Сбросить позицию и размер панели',
        'settings.dockResetDone': 'Позиция и размер панели сброшены.',
        'settings.jumpBottom': 'Кнопка прокрутки вниз',
        'settings.jumpBottomDesc': 'Показывать стрелку в углу чата при прокрутке вверх.',
        'settings.avatarHeading': 'Аватары персонажей',
        'settings.avatarCrop': 'Меню обрезки аватара',
        'settings.avatarCropDesc': 'Окно кадрирования и действие «Обрезать аватар» для персонажей.',
        'settings.cropOnUpload': 'Обрезать при загрузке',
        'settings.cropOnUploadDesc': 'Открывать редактор обрезки перед сохранением нового аватара.',
        'settings.editorHeading': 'Редакторы',
        'settings.promptMaximize': 'Разворачивание редактора промптов',
        'settings.promptActions': 'Действия в строке промпта',
        'settings.promptActionsDesc': 'Создавайте копии и удаляйте пользовательские промпты прямо из списка.',
        'prompt.duplicate': 'Создать копию ниже', 'prompt.unlink': 'Убрать из текущего списка', 'prompt.delete': 'Удалить промпт', 'prompt.more': 'Другие действия с промптом',
        'prompt.confirm': 'Удалить «{name}» из этого пресета?', 'prompt.references': 'Количество других списков, из которых промпт также будет удалён',
        'settings.promptMaximizeDesc': 'Добавляет кнопку разворачивания рядом с полем Prompt.',
        'prompt.expand': 'Развернуть редактор',
        'crop.title': 'Обрезка аватара',
        'crop.hint': 'Перетащите рамку для кадрирования или выберите пропорции ниже.',
        'crop.aspectLabel': 'Пропорции обрезки',
        'crop.free': 'Свободно',
        'crop.apply': 'Применить',
        'crop.cancel': 'Отмена',
        'crop.menuAction': 'Обрезать аватар',
        'crop.btnTitle': 'Обрезать текущий аватар',
        'crop.noneAvailable': 'Сначала загрузите изображение аватара.',
        'crop.failed': 'Не удалось обновить аватар персонажа.',
        'dock.open': 'Открыть панель быстрого доступа',
        'dock.dragHint': 'Перетащите для перемещения',
        'dock.titleBoth': 'Быстрая панель',
        'dock.titleOoc': 'OOC-инъекция',
        'dock.titleActions': 'Действия с сообщением',
        'dock.close': 'Закрыть',
        'dock.resize': 'Изменить размер окна',
        'dock.split': 'Изменить высоту секций',
        'dock.oocSection': 'OOC-инъекция',
        'dock.oocToggle': 'Добавлять при генерации',
        'dock.oocText': 'Постоянный OOC-текст',
        'dock.oocPlaceholder': 'Введите текст точно в том виде, в котором его нужно добавить…',
        'dock.oocDepth': 'Глубина',
        'dock.oocBlocked': 'Пауза (активна модель изображений)',
        'dock.oocNoChat': 'Откройте чат',
        'dock.oocOff': 'Выкл.',
        'dock.oocEmpty': 'Пусто',
        'dock.oocActive': 'Активно',
        'dock.actionsSection': 'Действия с сообщением',
        'dock.targetLabel': 'Выбор сообщения',
        'dock.lastMsg': 'Последнее',
        'dock.prevMsg': 'Предпоследнее',
        'dock.unknownName': 'Неизвестно',
        'dock.noChat': 'Откройте чат с сообщениями для показа кнопок.',
        'dock.unavailable': 'Кнопки управления для этого сообщения недоступны.',
        'dock.jump': 'В конец чата',
    },
});

export function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

function getLocale() {
    const raw = String(getContext()?.getCurrentLocale?.() || document.documentElement.lang || 'en').toLowerCase();
    return raw.startsWith('ru') ? 'ru' : 'en';
}

export function t(key) {
    const lang = getLocale();
    return I18N[lang]?.[key] ?? I18N.en[key] ?? key;
}

export function applyI18n(root) {
    if (!root) return;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key && I18N.en[key]) el.textContent = t(key);
    });
}

export function getSettings() {
    const ctx = getContext();
    const store = ctx?.extensionSettings;
    if (!store) return { ...DEFAULT_SETTINGS };
    if (!store[SETTINGS_KEY] || typeof store[SETTINGS_KEY] !== 'object') {
        store[SETTINGS_KEY] = {};
    }
    const s = store[SETTINGS_KEY];
    const legacyAcc = store['ace-chat-controls'];
    const legacyOoc = store['ooc-inject'];

    if (typeof s.oocInject !== 'boolean') s.oocInject = DEFAULT_SETTINGS.oocInject;
    if (typeof s.chatControls !== 'boolean') {
        s.chatControls = typeof legacyAcc?.showMessageActions === 'boolean'
            ? legacyAcc.showMessageActions
            : DEFAULT_SETTINGS.chatControls;
    }
    if (typeof s.jumpToBottom !== 'boolean') {
        s.jumpToBottom = typeof legacyAcc?.showJumpBottom === 'boolean'
            ? legacyAcc.showJumpBottom
            : DEFAULT_SETTINGS.jumpToBottom;
    }
    if (typeof s.dockShy !== 'boolean') {
        s.dockShy = typeof legacyOoc?.shyButton === 'boolean'
            ? legacyOoc.shyButton
            : DEFAULT_SETTINGS.dockShy;
    }
    s.promptMaximize = s.promptMaximize !== false;
    s.promptActions = s.promptActions !== false;
    s.greetings = s.greetings !== false;
    s.compareCards = s.compareCards !== false;
    s.avatarCrop = s.avatarCrop !== false;
    s.cropOnUpload = s.cropOnUpload !== false;
    if (!CROP_PRESETS.some((p) => p.id === s.lastCropRatio)) {
        s.lastCropRatio = DEFAULT_SETTINGS.lastCropRatio;
    }
    return s;
}

export function saveSettings() {
    getContext()?.saveSettingsDebounced?.();
}

export function viewportRect(padding = 8) {
    const vv = window.visualViewport;
    const left = (vv?.offsetLeft || 0) + padding;
    const top = (vv?.offsetTop || 0) + padding;
    const width = Math.max(0, (vv?.width || window.innerWidth) - padding * 2);
    const height = Math.max(0, (vv?.height || window.innerHeight) - padding * 2);
    return { left, top, width, height, right: left + width, bottom: top + height };
}

export function readLocalJson(suffix) {
    try {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}:${suffix}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function writeLocalJson(suffix, value) {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}:${suffix}`, JSON.stringify(value));
    } catch { /* Device storage may be unavailable. */ }
}

export function removeLocalKey(suffix) {
    try {
        localStorage.removeItem(`${STORAGE_PREFIX}:${suffix}`);
    } catch { /* Device storage may be unavailable. */ }
}
