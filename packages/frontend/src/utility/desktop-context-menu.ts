/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';
import { hasDesktopWindowChrome } from '@/utility/desktop-window.js';

export type DesktopContextMenu = { items: MenuItem[]; ev: PointerEvent; restore: () => void; };

function failed() {
	void import('@/os.js').then(os => os.toast(i18n.ts._desktop.contextActionFailed));
}

function paste(restore: () => void, target: HTMLElement) {
	const requestId = crypto.randomUUID();
	const timeout = window.setTimeout(() => { cleanup(); failed(); }, 10000);

	function cleanup() {
		window.clearTimeout(timeout);
		window.removeEventListener('camp-context-result', result);
	}

	function result(event: Event) {
		const detail = (event as CustomEvent<{ requestId: string; text?: string; error?: boolean; }>).detail;
		if (detail?.requestId !== requestId) return;
		cleanup();
		if (detail.error || typeof detail.text !== 'string') { failed(); return; }
		if (!target.isConnected) return;
		restore();
		if (detail.text && !window.document.execCommand('insertText', false, detail.text)) failed();
	}

	window.addEventListener('camp-context-result', result);
	window.location.assign(`camp-desktop://context-action?action=paste&requestId=${requestId}`);
}

async function imageBlob(image: HTMLImageElement | HTMLCanvasElement): Promise<Blob> {
	let canvas: HTMLCanvasElement;
	if (image instanceof HTMLCanvasElement) {
		canvas = image;
	} else {
		const response = await window.fetch(image.currentSrc || image.src);
		if (!response.ok) throw new Error('Image unavailable');
		const bitmap = await createImageBitmap(await response.blob());
		canvas = window.document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
		bitmap.close();
	}
	return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image unavailable')), 'image/png'));
}

function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = window.document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function save(url: string) {
	void window.fetch(url).then(async response => {
		if (!response.ok) throw new Error('Download unavailable');
		const filename = new URL(url, window.location.href).pathname.split('/').pop() || 'download';
		saveBlob(await response.blob(), filename);
	}).catch(failed);
}

/** Only fills in browser defaults; page-specific menus keep their own actions. */
export function desktopContextMenu(ev: PointerEvent): DesktopContextMenu | null {
	if (!hasDesktopWindowChrome() || ev.defaultPrevented) return null;
	ev.preventDefault();
	const target = ev.target instanceof Element ? ev.target : null;
	if (!target || target.closest('[data-camp-window-titlebar]')) return null;
	const items: MenuItem[] = [];
	const input = target.closest('input, textarea');
	const field = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null;
	const richText = target.closest<HTMLElement>('[contenteditable]');
	const editable = field ?? (richText?.contentEditable === 'false' ? null : richText);
	const writable = editable && (!field || (!field.readOnly && !field.disabled));
	const selection = window.getSelection();
	const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) => selection!.getRangeAt(index).cloneRange());
	const start = field?.selectionStart ?? null;
	const end = field?.selectionEnd ?? null;
	const selectedText = field ? (start != null && end != null ? field.value.slice(start, end) : '') : selection?.toString() ?? '';
	const password = field instanceof HTMLInputElement && field.type === 'password';
	const previous = window.document.activeElement;
	const focus = () => {
		if (editable?.isConnected) editable.focus({ preventScroll: true });
		else if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
	};
	const restore = () => {
		focus();
		if (field?.isConnected && start != null && end != null) field.setSelectionRange(start, end);
		else if (selection && ranges.length > 0) {
			selection.removeAllRanges();
			for (const range of ranges) selection.addRange(range);
		}
	};
	const action = (text: string, icon: string, callback: () => void) => items.push({ text, icon: `ti ti-${icon}`, action: callback });
	const edit = (command: string) => { restore(); window.document.execCommand(command); };
	const copy = (text: string) => { void navigator.clipboard.writeText(text).catch(failed); };
	if (selectedText && !password) action(i18n.ts.copy, 'copy', () => copy(selectedText));
	if (writable) {
		if (selectedText && !password) action(i18n.ts._desktop.cut, 'cut', () => edit('cut'));
		action(i18n.ts.paste, 'clipboard', () => paste(restore, editable));
		action(i18n.ts._desktop.undo, 'arrow-back-up', () => edit('undo'));
		action(i18n.ts._desktop.redo, 'arrow-forward-up', () => edit('redo'));
	}
	if (editable && !field?.disabled) action(i18n.ts._desktop.selectAll, 'select-all', () => edit('selectAll'));
	const link = target.closest<HTMLAnchorElement>('a[href]');
	if (link && /^(https?:|mailto:)/.test(link.protocol)) {
		if (items.length) items.push({ type: 'divider' });
		action(i18n.ts._desktop.openLink, 'external-link', () => { window.open(link.href, '_blank', 'noopener,noreferrer'); });
		action(i18n.ts.copyLink, 'link', () => copy(link.href));
	}
	const image = target.closest('img, canvas');
	if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
		if (items.length) items.push({ type: 'divider' });
		action(i18n.ts._desktop.copyImage, 'photo', () => {
			try {
				void navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob(image) })]).catch(failed);
			} catch { failed(); }
		});
		action(i18n.ts._desktop.saveImage, 'download', () => {
			if (image instanceof HTMLImageElement) save(image.currentSrc || image.src);
			else void imageBlob(image).then(blob => saveBlob(blob, 'camp-image.png')).catch(failed);
		});
		if (image instanceof HTMLImageElement) {
			action(i18n.ts._desktop.openImage, 'external-link', () => { window.open(image.currentSrc || image.src, '_blank', 'noopener,noreferrer'); });
			action(i18n.ts._desktop.copyImageLink, 'link', () => copy(image.currentSrc || image.src));
		}
	}
	const media = target.closest('video, audio');
	if (media instanceof HTMLMediaElement) {
		if (items.length) items.push({ type: 'divider' });
		action(media.paused ? i18n.ts._desktop.play : i18n.ts._desktop.pause, media.paused ? 'player-play' : 'player-pause', () => {
			if (media.paused) void media.play().catch(failed);
			else media.pause();
		});
		action(media.muted ? i18n.ts._desktop.unmute : i18n.ts._desktop.mute, media.muted ? 'volume' : 'volume-off', () => { media.muted = !media.muted; });
		if (media.currentSrc || media.src) {
			action(i18n.ts.download, 'download', () => save(media.currentSrc || media.src));
			action(i18n.ts.copyLink, 'link', () => copy(media.currentSrc || media.src));
		}
	}
	return items.length > 0 ? { items, ev, restore: focus } : null;
}
