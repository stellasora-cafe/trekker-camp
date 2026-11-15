/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import '@/utility/desktop-update.js';

export function desktopWindowMode(): 'browser' | 'main' | 'tool' {
	if (window.document.documentElement.dataset.campDesktop !== 'true') return 'browser';
	return window.document.documentElement.dataset.campDesktopWindow === 'tool' ? 'tool' : 'main';
}

export function checkDesktopUpdates(): void {
	if (desktopWindowMode() === 'browser') return;
	window.location.href = 'camp-desktop://check-updates';
}

export function openDesktopAbout(): void {
	if (desktopWindowMode() === 'browser') return;
	window.location.href = 'camp-desktop://about-camp';
}

export function hasDesktopWindowChrome(): boolean {
	const data = window.document.documentElement.dataset;
	return data.campDesktop === 'true' && data.campWindowChrome === 'true';
}

export function getDesktopWindowState() {
	const data = window.document.documentElement.dataset;
	return {
		enabled: hasDesktopWindowChrome(),
		maximized: data.campWindowMaximized === 'true',
		fullscreen: data.campWindowFullscreen === 'true',
		active: data.campWindowActive !== 'false',
	};
}

export function desktopWindowCommand(action: 'minimize' | 'maximize' | 'close' | 'drag'): void {
	if (!hasDesktopWindowChrome() || !['minimize', 'maximize', 'close', 'drag'].includes(action)) return;
	window.location.assign(`camp-desktop://window-control?action=${action}`);
}

/** The page itself supplies the drag surface; its controls keep their input. */
export function handleDesktopWindowMouseDown(event: MouseEvent): void {
	const state = getDesktopWindowState();
	if (!state.enabled || state.fullscreen || event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
	const target = event.target instanceof Element ? event.target : null;
	const surface = target?.closest('[data-camp-window-drag]');
	if (!surface) return;
	if (!target || target.closest('button, a, input, textarea, select, option, label, summary, img, video, audio, canvas, iframe, [contenteditable], [tabindex]:not([tabindex="-1"]), [draggable="true"], [role="button"], [role="tab"], [role="menu"], [role="dialog"], [data-camp-no-drag], ._button, ._buttonPrimary, ._textButton, ._modalBg')) return;
	for (let element: Element | null = target; element && element !== surface; element = element.parentElement) {
		if (/^(pointer|move|grab|grabbing)$|resize$/.test(window.getComputedStyle(element).cursor)) return;
	}
	event.preventDefault();
	desktopWindowCommand(event.detail === 2 ? 'maximize' : 'drag');
}

/** The desktop host opens this target in a separate, content-only window. */
export function openDesktopTool(path: string): void {
	const target = new URL(path, window.location.origin);
	if (target.origin !== window.location.origin) return;
	window.open(target.href, 'camp-desktop-tool');
}
