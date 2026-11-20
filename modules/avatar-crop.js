// High-quality PNG character avatar upload and in-place re-crop workflow.

import {
    CROP_PRESETS,
    SCOPE_TOKEN,
    getContext,
    getSettings,
    saveSettings,
    t,
    warn,
} from './core.js';

const AVATAR_INPUT_ID = 'add_avatar_button';
const CROP_BTN_ID = 'pt_crop_avatar_btn';
const CROP_OPT_ID = 'pt_crop_avatar_opt';
const CROP_PREVIEW_DIM = 1600;
const AVATAR_EXPORT_DIM = 2560;
const FETCH_TIMEOUT_MS = 30000;

function withDecodedImage(blob, fn) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            img.onload = img.onerror = null;
            img.src = '';
            URL.revokeObjectURL(url);
        };
        const fail = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };
        const timer = setTimeout(() => fail(new Error('Image decode timed out')), 20000);
        img.onerror = () => fail(new Error('Failed to decode image'));
        img.onload = () => {
            if (settled) return;
            settled = true;
            try {
                if (!img.naturalWidth || !img.naturalHeight) throw new Error('Empty image');
                resolve(fn(img));
            } catch (err) {
                reject(err);
            } finally {
                cleanup();
            }
        };
        try { img.src = url; } catch (err) { fail(err); }
    });
}

function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob((blob) => {
                canvas.width = canvas.height = 0;
                if (blob) resolve(blob);
                else reject(new Error('Canvas export failed'));
            }, 'image/png');
        } catch (err) {
            canvas.width = canvas.height = 0;
            reject(err);
        }
    });
}

function rasterizeImageBlob(blob, maxDim, region = null) {
    return withDecodedImage(blob, (img) => {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        let sx = 0;
        let sy = 0;
        let sw = nw;
        let sh = nh;
        if (region) {
            if (![region.x, region.y, region.width, region.height].every(Number.isFinite)
                || region.width <= 0 || region.height <= 0) {
                throw new Error('Invalid crop region');
            }
            sx = Math.max(0, Math.min(nw - 1, Math.round(region.x * nw)));
            sy = Math.max(0, Math.min(nh - 1, Math.round(region.y * nh)));
            sw = Math.max(1, Math.min(nw - sx, Math.round(region.width * nw)));
            sh = Math.max(1, Math.min(nh - sy, Math.round(region.height * nh)));
        }
        const scale = maxDim > 0 ? Math.min(1, maxDim / Math.max(sw, sh)) : 1;
        const canvas = document.createElement('canvas');
        canvas.width = scale === 1 ? sw : Math.max(1, Math.round(sw * scale));
        canvas.height = scale === 1 ? sh : Math.max(1, Math.round(sh * scale));
        try {
            const ctx2d = canvas.getContext('2d');
            if (!ctx2d) throw new Error('2D context unavailable');
            ctx2d.imageSmoothingEnabled = scale < 1;
            if (scale < 1) ctx2d.imageSmoothingQuality = 'high';
            ctx2d.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        } catch (err) {
            canvas.width = canvas.height = 0;
            throw err;
        }
        return canvasToPngBlob(canvas);
    });
}

function stylePopupDialog(dlg, extraClass = '') {
    if (!dlg) return;
    dlg.classList.add('pt-themed-popup');
    if (extraClass) dlg.classList.add(extraClass);
    dlg.dataset.ptScope = SCOPE_TOKEN;
    dlg.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.closest('button')) {
            e.stopPropagation();
        }
    });
}

async function cropAvatarBlob(sourceBlob) {
    const previewDataUrl = await withDecodedImage(sourceBlob, (img) => {
        const scale = Math.min(1, CROP_PREVIEW_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        try {
            const ctx2d = canvas.getContext('2d');
            if (!ctx2d) throw new Error('2D context unavailable');
            ctx2d.imageSmoothingEnabled = scale < 1;
            if (scale < 1) ctx2d.imageSmoothingQuality = 'high';
            ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
        } finally {
            canvas.width = canvas.height = 0;
        }
    });

    const ctx = getContext();
    if (!ctx?.Popup) throw new Error('Popup unavailable');

    const settings = getSettings();
    const defaultPreset = CROP_PRESETS.find((p) => p.id === settings.lastCropRatio) || CROP_PRESETS[2];

    const shell = document.createElement('div');
    shell.className = 'pt_crop_shell';
    const head = document.createElement('div');
    head.className = 'pt_crop_head';
    const titleEl = document.createElement('h3');
    titleEl.className = 'pt_crop_title';
    titleEl.textContent = t('crop.title');
    const hintEl = document.createElement('p');
    hintEl.className = 'pt_crop_hint';
    hintEl.textContent = t('crop.hint');
    head.append(titleEl, hintEl);

    const stage = document.createElement('div');
    stage.className = 'pt_crop_stage';

    const ratioBar = document.createElement('div');
    ratioBar.className = 'pt_crop_ratios';
    ratioBar.setAttribute('role', 'group');
    ratioBar.setAttribute('aria-label', t('crop.aspectLabel'));
    const ratioButtons = CROP_PRESETS.map((preset) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pt_crop_ratio interactable';
        btn.dataset.cropPreset = preset.id;
        const isDefault = preset.id === defaultPreset.id;
        btn.classList.toggle('is-active', isDefault);
        btn.setAttribute('aria-pressed', String(isDefault));
        btn.textContent = preset.labelKey ? t(preset.labelKey) : preset.label;
        ratioBar.appendChild(btn);
        return btn;
    });

    shell.append(head, stage, ratioBar);

    const popup = new ctx.Popup(shell, ctx.POPUP_TYPE?.CROP ?? 3, '', {
        cropImage: previewDataUrl,
        cropAspect: defaultPreset.ratio,
        okButton: t('crop.apply'),
        cancelButton: t('crop.cancel'),
    });
    stylePopupDialog(popup.dlg, 'pt-crop-popup');
    popup.dlg.setAttribute('aria-label', t('crop.title'));
    stage.appendChild(popup.cropWrap);

    const cropper = globalThis.jQuery?.(popup.cropImage)?.data('cropper');
    const origGetCroppedCanvas = cropper?.getCroppedCanvas;
    if (!cropper || !origGetCroppedCanvas) {
        popup.dlg?.remove();
        const popups = ctx.Popup.util?.popups;
        const idx = popups?.indexOf(popup) ?? -1;
        if (idx >= 0) popups.splice(idx, 1);
        throw new Error('Cropper unavailable');
    }

    const image = cropper.image;
    let sizingImage = null;
    let finished = false;
    let applying = false;
    let exportedBlob = null;
    let rejectFailure;
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    const fail = (err) => {
        if (finished) return;
        finished = true;
        popup.okButton?.setAttribute('aria-disabled', 'true');
        if (popup.dlg?.open) popup.dlg.close();
        popup.dlg?.remove();
        const popups = ctx.Popup.util?.popups;
        const idx = popups?.indexOf(popup) ?? -1;
        if (idx >= 0) popups.splice(idx, 1);
        rejectFailure(err instanceof Error ? err : new Error('Crop failed'));
    };

    const syncReady = () => {
        if (finished) return;
        const ready = !applying && Boolean(cropper?.ready);
        popup.okButton?.setAttribute('aria-disabled', String(!ready));
        for (const btn of ratioButtons) btn.disabled = !ready;
    };

    ratioBar.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-crop-preset]') : null;
        if (!btn || btn.disabled || !cropper?.ready) return;
        const preset = CROP_PRESETS.find((p) => p.id === btn.dataset.cropPreset);
        if (!preset) return;
        cropper.setAspectRatio(preset.ratio);
        settings.lastCropRatio = preset.id;
        saveSettings();
        for (const el of ratioButtons) {
            const on = el === btn;
            el.classList.toggle('is-active', on);
            el.setAttribute('aria-pressed', String(on));
        }
    });

    const stubCanvas = { toDataURL: () => 'data:image/png;base64,' };
    const origComplete = popup.complete;
    popup.complete = async (result) => {
        const affirmative = result >= (ctx.POPUP_RESULT?.AFFIRMATIVE ?? 1);
        if (finished || (affirmative && (applying || !cropper?.ready))) return undefined;
        try {
            if (affirmative) {
                applying = true;
                syncReady();
                const crop = cropper.getData();
                const { naturalWidth, naturalHeight } = cropper.getImageData();
                if (!naturalWidth || !naturalHeight) throw new Error('Invalid crop source');
                exportedBlob = await rasterizeImageBlob(sourceBlob, AVATAR_EXPORT_DIM, {
                    x: crop.x / naturalWidth,
                    y: crop.y / naturalHeight,
                    width: crop.width / naturalWidth,
                    height: crop.height / naturalHeight,
                });
                if (finished) return undefined;
                cropper.getCroppedCanvas = () => stubCanvas;
            }
            finished = true;
            return await origComplete.call(popup, result);
        } catch (err) {
            if (!finished) fail(err);
            return undefined;
        } finally {
            applying = false;
            syncReady();
        }
    };

    const onLoad = () => {
        sizingImage?.removeEventListener('error', fail);
        sizingImage = cropper?.sizingImage;
        sizingImage?.addEventListener('error', fail);
    };
    popup.onOpen = () => {
        if (!finished && cropper?.ready) cropper.resize();
    };
    popup.cropImage.addEventListener('ready', syncReady);
    popup.dlg.addEventListener('error', fail, true);
    image?.addEventListener('load', onLoad);
    syncReady();
    onLoad();

    try {
        const result = await Promise.race([popup.show(), failure]);
        if (result == null) return null;
        if (!exportedBlob) throw new Error('Missing cropped image');
        return exportedBlob;
    } finally {
        finished = true;
        popup.onOpen = null;
        popup.cropImage.removeEventListener('ready', syncReady);
        popup.dlg.removeEventListener('error', fail, true);
        image?.removeEventListener('load', onLoad);
        sizingImage?.removeEventListener('error', fail);
        if (cropper && origGetCroppedCanvas) cropper.getCroppedCanvas = origGetCroppedCanvas;
        cropper?.destroy();
    }
}

let cropBusy = false;
let pendingCreate = null;
let domBound = false;
let eventsBound = false;

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function getAvatarInput() {
    const el = document.getElementById(AVATAR_INPUT_ID);
    return el instanceof HTMLInputElement ? el : null;
}

function isCreateCharacterMode() {
    const action = document.getElementById('form_create')?.getAttribute('actiontype');
    if (action) return action === 'createcharacter';
    return getContext()?.menuType === 'create';
}

function getActiveCharacterAvatarKey() {
    if (isCreateCharacterMode()) return '';
    const pole = document.getElementById('avatar_url_pole');
    const fromForm = pole instanceof HTMLInputElement ? pole.value.trim() : '';
    if (fromForm && fromForm !== 'none') return fromForm;
    const ctx = getContext();
    const fromCtx = ctx?.characters?.[ctx?.characterId]?.avatar;
    return (typeof fromCtx === 'string' && fromCtx !== 'none') ? fromCtx : '';
}

function clearPendingCreate() {
    if (pendingCreate?.previewUrl) URL.revokeObjectURL(pendingCreate.previewUrl);
    pendingCreate = null;
}

function setInputSingleFile(input, file) {
    if (!input) return;
    if (!file) {
        input.value = '';
        return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
}

function applyPendingCreateAvatar(input, sourceFile, pngBlob) {
    const croppedFile = new File([pngBlob], 'avatar.png', { type: 'image/png' });
    const previewUrl = URL.createObjectURL(pngBlob);
    clearPendingCreate();
    pendingCreate = { sourceFile, croppedFile, previewUrl };
    setInputSingleFile(input, croppedFile);
    const ctx = getContext();
    if (ctx?.createCharacterData) ctx.createCharacterData.avatar = null;
    const preview = document.getElementById('avatar_load_preview');
    if (preview instanceof HTMLImageElement) preview.src = previewUrl;
    syncAvatarCropAvailability();
}

function restorePendingCreateUI() {
    if (!getSettings().avatarCrop || !pendingCreate || !isCreateCharacterMode()) return;
    setInputSingleFile(getAvatarInput(), pendingCreate.croppedFile);
    const preview = document.getElementById('avatar_load_preview');
    if (preview instanceof HTMLImageElement) preview.src = pendingCreate.previewUrl;
    syncAvatarCropAvailability();
}

function refreshCharacterAvatarImages(avatarKey, thumbBase) {
    const bust = Date.now();
    const expectedCharPath = `/characters/${avatarKey}`;
    document.querySelectorAll('img').forEach((img) => {
        const rawAttr = img.getAttribute('src');
        if (!rawAttr || rawAttr.startsWith('data:') || rawAttr.startsWith('blob:')) return;
        let parsed;
        try {
            parsed = new URL(rawAttr, location.origin);
        } catch {
            return;
        }
        if (parsed.origin !== location.origin) return;

        if (parsed.pathname === '/thumbnail'
            && parsed.searchParams.get('type') === 'avatar'
            && parsed.searchParams.get('file') === avatarKey) {
            parsed.searchParams.set('t', String(bust));
            img.setAttribute('src', `${parsed.pathname}${parsed.search}`);
            return;
        }

        let decodedPath = '';
        try { decodedPath = decodeURIComponent(parsed.pathname); } catch { decodedPath = parsed.pathname; }
        if (decodedPath === expectedCharPath) {
            parsed.searchParams.set('v', String(bust));
            const prefix = rawAttr.startsWith('/') ? parsed.pathname : parsed.pathname.slice(1);
            const updated = `${prefix}${parsed.search}`;
            img.setAttribute('src', updated);
            if (img.hasAttribute('data-izoomify-url')) {
                img.setAttribute('data-izoomify-url', updated);
            }
        }
    });

    if (getActiveCharacterAvatarKey() === avatarKey) {
        const preview = document.getElementById('avatar_load_preview');
        if (preview instanceof HTMLImageElement && thumbBase) {
            preview.setAttribute('src', `${thumbBase}&t=${bust}`);
        }
    }
}

async function uploadAndRefreshCharacterAvatar(avatarKey, pngBlob) {
    const ctx = getContext();
    if (!ctx || !avatarKey) throw new Error('Missing character context');

    const formData = new FormData();
    formData.append('avatar', pngBlob, 'avatar.png');
    formData.append('avatar_url', avatarKey);

    const res = await fetchWithTimeout('/api/characters/edit-avatar', {
        method: 'POST',
        headers: ctx.getRequestHeaders?.({ omitContentType: true }) ?? {},
        body: formData,
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);

    const thumbBase = ctx.getThumbnailUrl
        ? ctx.getThumbnailUrl('avatar', avatarKey, false)
        : `/thumbnail?type=avatar&file=${encodeURIComponent(avatarKey)}`;
    const charUrl = `/characters/${encodeURIComponent(avatarKey)}`;

    await Promise.allSettled([
        fetchWithTimeout(thumbBase, { method: 'GET', cache: 'reload' }),
        fetchWithTimeout(charUrl, { method: 'GET', cache: 'reload' }),
    ]);

    await ctx.getOneCharacter?.(avatarKey);
    refreshCharacterAvatarImages(avatarKey, thumbBase);
    syncAvatarCropAvailability();
}

async function onAvatarInputChange(e) {
    if (!getSettings().avatarCrop) return;
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.id !== AVATAR_INPUT_ID) return;

    const file = input.files?.[0];
    if (!file) return;

    e.stopImmediatePropagation();

    if (cropBusy) {
        setInputSingleFile(input, isCreateCharacterMode() ? pendingCreate?.croppedFile ?? null : null);
        return;
    }

    cropBusy = true;
    try {
        const pngBlob = getSettings().cropOnUpload
            ? await cropAvatarBlob(file)
            : await rasterizeImageBlob(file, AVATAR_EXPORT_DIM, null);

        if (!pngBlob) {
            setInputSingleFile(input, isCreateCharacterMode() ? pendingCreate?.croppedFile ?? null : null);
            return;
        }

        if (isCreateCharacterMode()) {
            applyPendingCreateAvatar(input, file, pngBlob);
            return;
        }

        const avatarKey = getActiveCharacterAvatarKey();
        input.value = '';
        await uploadAndRefreshCharacterAvatar(avatarKey, pngBlob);
    } catch (err) {
        setInputSingleFile(input, isCreateCharacterMode() ? pendingCreate?.croppedFile ?? null : null);
        warn('avatar-upload', err);
        globalThis.toastr?.error?.(t('crop.failed'));
    } finally {
        cropBusy = false;
    }
}

async function onCropExistingAvatar() {
    if (!getSettings().avatarCrop || cropBusy) return;

    if (isCreateCharacterMode()) {
        const input = getAvatarInput();
        const sourceFile = pendingCreate?.sourceFile ?? input?.files?.[0] ?? null;
        if (!sourceFile) {
            globalThis.toastr?.info?.(t('crop.noneAvailable'));
            return;
        }
        cropBusy = true;
        try {
            const pngBlob = await cropAvatarBlob(sourceFile);
            if (pngBlob) applyPendingCreateAvatar(input, sourceFile, pngBlob);
        } catch (err) {
            warn('avatar-recrop-create', err);
            globalThis.toastr?.error?.(t('crop.failed'));
        } finally {
            cropBusy = false;
        }
        return;
    }

    const avatarKey = getActiveCharacterAvatarKey();
    if (!avatarKey) {
        globalThis.toastr?.info?.(t('crop.noneAvailable'));
        return;
    }

    cropBusy = true;
    try {
        const res = await fetchWithTimeout(`/characters/${encodeURIComponent(avatarKey)}`, {
            method: 'GET',
            cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Avatar fetch failed (${res.status})`);
        const sourceBlob = await res.blob();
        const pngBlob = await cropAvatarBlob(sourceBlob);
        if (!pngBlob) return;
        await uploadAndRefreshCharacterAvatar(avatarKey, pngBlob);
    } catch (err) {
        warn('avatar-recrop', err);
        globalThis.toastr?.error?.(t('crop.failed'));
    } finally {
        cropBusy = false;
    }
}

function hasCroppableAvatar() {
    if (isCreateCharacterMode()) {
        return Boolean(pendingCreate?.sourceFile || getAvatarInput()?.files?.[0]);
    }
    return Boolean(getActiveCharacterAvatarKey());
}

function syncAvatarCropAvailability() {
    const available = getSettings().avatarCrop && hasCroppableAvatar();
    const btn = document.getElementById(CROP_BTN_ID);
    if (btn) {
        btn.setAttribute('aria-disabled', String(!available));
        btn.title = t('crop.btnTitle');
        btn.setAttribute('aria-label', t('crop.btnTitle'));
    }
    const opt = document.getElementById(CROP_OPT_ID);
    if (opt instanceof HTMLOptionElement) {
        opt.disabled = !available;
        opt.textContent = t('crop.menuAction');
    }
}

export function syncAvatarCropUI() {
    const enabled = getSettings().avatarCrop;
    const existingBtn = document.getElementById(CROP_BTN_ID);
    const existingOpt = document.getElementById(CROP_OPT_ID);

    if (!enabled) {
        existingBtn?.remove();
        existingOpt?.remove();
        clearPendingCreate();
        return true;
    }

    const buttonBar = document.querySelector('#avatar_controls .form_create_bottom_buttons_block');
    const dropdown = document.getElementById('char-management-dropdown');
    if (!buttonBar && !dropdown) return false;

    if (buttonBar && !existingBtn) {
        const btn = document.createElement('div');
        btn.id = CROP_BTN_ID;
        btn.className = 'menu_button fa-solid fa-crop-simple interactable';
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.addEventListener('click', onCropExistingAvatar);
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCropExistingAvatar();
            }
        });
        const anchor = document.getElementById('export_button');
        if (anchor && anchor.parentElement === buttonBar) buttonBar.insertBefore(btn, anchor);
        else buttonBar.appendChild(btn);
    }

    if (dropdown instanceof HTMLSelectElement && !existingOpt) {
        const opt = document.createElement('option');
        opt.id = CROP_OPT_ID;
        opt.value = CROP_OPT_ID;
        const firstAction = dropdown.options[1] ?? null;
        dropdown.insertBefore(opt, firstAction);
    }

    syncAvatarCropAvailability();
    return true;
}

function onCharManagementDropdown(targetId) {
    if (targetId === CROP_OPT_ID) onCropExistingAvatar();
}

function onCreateTabClick(e) {
    const target = e.target instanceof Element ? e.target.closest('#rm_button_create') : null;
    if (!target) return;
    queueMicrotask(() => {
        restorePendingCreateUI();
        syncAvatarCropAvailability();
    });
}

function onCharacterContextChange() {
    if (!isCreateCharacterMode()) clearPendingCreate();
    syncAvatarCropUI();
}

export function bindAvatarCrop() {
    if (!domBound) {
        document.addEventListener('change', onAvatarInputChange, true);
        document.addEventListener('click', onCreateTabClick, false);
        domBound = true;
    }
    if (!eventsBound) {
        const ctx = getContext();
        const ev = ctx?.eventSource;
        const types = ctx?.eventTypes || ctx?.event_types;
        if (ev?.on && types) {
            if (types.CHARACTER_MANAGEMENT_DROPDOWN) ev.on(types.CHARACTER_MANAGEMENT_DROPDOWN, onCharManagementDropdown);
            if (types.CHARACTER_EDITOR_OPENED) ev.on(types.CHARACTER_EDITOR_OPENED, onCharacterContextChange);
            if (types.CHARACTER_EDITED) ev.on(types.CHARACTER_EDITED, onCharacterContextChange);
            if (types.CHAT_CHANGED) ev.on(types.CHAT_CHANGED, onCharacterContextChange);
            eventsBound = true;
        }
    }
    return eventsBound;
}

export function cleanupAvatarCrop() {
    if (domBound) {
        document.removeEventListener('change', onAvatarInputChange, true);
        document.removeEventListener('click', onCreateTabClick, false);
        domBound = false;
    }
    if (eventsBound) {
        const ctx = getContext();
        const ev = ctx?.eventSource;
        const types = ctx?.eventTypes || ctx?.event_types;
        if (ev?.removeListener && types) {
            if (types.CHARACTER_MANAGEMENT_DROPDOWN) ev.removeListener(types.CHARACTER_MANAGEMENT_DROPDOWN, onCharManagementDropdown);
            if (types.CHARACTER_EDITOR_OPENED) ev.removeListener(types.CHARACTER_EDITOR_OPENED, onCharacterContextChange);
            if (types.CHARACTER_EDITED) ev.removeListener(types.CHARACTER_EDITED, onCharacterContextChange);
            if (types.CHAT_CHANGED) ev.removeListener(types.CHAT_CHANGED, onCharacterContextChange);
        }
        eventsBound = false;
    }
    clearPendingCreate();
    document.getElementById(CROP_BTN_ID)?.remove();
    document.getElementById(CROP_OPT_ID)?.remove();
}
