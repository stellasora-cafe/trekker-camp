/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import MkDesktopTitlebar from '@/components/MkDesktopTitlebar.vue';
import { i18n } from '@/i18n.js';
import { desktopWindowCommand, getDesktopWindowState } from '@/utility/desktop-window.js';
import { focusTrap } from '@/utility/focus-trap.js';
import { desktopControlsInset } from '@/composables/use-desktop-controls-inset.js';

beforeEach(() => {
	document.documentElement.dataset.campDesktop = 'true';
	document.documentElement.dataset.campWindowChrome = 'true';
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const key of ['campDesktop', 'campWindowChrome', 'campWindowMaximized', 'campWindowFullscreen', 'campWindowActive']) delete document.documentElement.dataset[key];
});

describe('desktop window controls', () => {
	test('sends only the three window actions and distinguishes caption drags from button clicks', async () => {
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const view = render(MkDesktopTitlebar);
		expect(view.queryByText(i18n.ts._desktop.appName)).toBeNull();
		expect(view.container.querySelector('img')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts._desktop.minimize }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts._desktop.maximize }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts._desktop.closeWindow }));
		expect(assign.mock.calls.map(([url]) => url)).toEqual([
			'camp-desktop://window-control?action=minimize',
			'camp-desktop://window-control?action=maximize',
			'camp-desktop://window-control?action=close',
		]);
		assign.mockClear();
		const emptyHeader = document.createElement('div');
		emptyHeader.tabIndex = -1;
		view.container.append(emptyHeader);
		await fireEvent.mouseDown(view.getByRole('button', { name: i18n.ts._desktop.minimize }), { button: 0, detail: 1 });
		await fireEvent.mouseDown(emptyHeader, { button: 2, detail: 1, clientY: 16 });
		await fireEvent.mouseDown(emptyHeader, { button: 0, detail: 1, clientY: 16 });
		await fireEvent.mouseDown(emptyHeader, { button: 0, detail: 1, clientY: 48 });
		expect(assign).not.toHaveBeenCalled();
		emptyHeader.setAttribute('data-camp-window-drag', '');
		await fireEvent.mouseDown(emptyHeader, { button: 0, detail: 1, clientY: 40 });
		await fireEvent.mouseDown(emptyHeader, { button: 0, detail: 2, clientY: 49 });
		expect(assign.mock.calls.map(([url]) => url)).toEqual([
			'camp-desktop://window-control?action=drag',
			'camp-desktop://window-control?action=maximize',
		]);
		desktopWindowCommand('delete' as 'close');
		expect(assign).toHaveBeenCalledTimes(2);
	});

	test.each(['button', 'a', 'input', 'img', '[role="tab"]', '[data-camp-no-drag]', '[tabindex="0"]', '[draggable="true"]'])('keeps top-edge interactions on %s out of window dragging', async selector => {
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const view = render(MkDesktopTitlebar);
		const target = document.createElement(selector.startsWith('[') ? 'div' : selector);
		if (selector.startsWith('[')) {
			const [key, value] = selector.slice(1, -1).split('=');
			target.setAttribute(key, value?.replaceAll('"', '') ?? '');
		}
		const header = document.createElement('header');
		header.setAttribute('data-camp-window-drag', '');
		header.append(target);
		view.container.append(header);
		await fireEvent.mouseDown(target, { button: 0, detail: 1, clientY: 16 });
		expect(assign).not.toHaveBeenCalled();
	});

	test('reserves only headers intersecting the top-right controls, including horizontally scrolled columns', () => {
		expect(desktopControlsInset({ top: 0, bottom: 50, right: 1000, width: 700 }, 1000)).toBe(132);
		expect(desktopControlsInset({ top: 0, bottom: 50, right: 650, width: 450 }, 1000)).toBe(0);
		expect(desktopControlsInset({ top: 50, bottom: 100, right: 1000, width: 700 }, 1000)).toBe(0);
		expect(desktopControlsInset({ top: 40, bottom: 90, right: 1000, width: 700 }, 1000)).toBe(132);
		expect(desktopControlsInset({ top: 10, bottom: 42, right: 1100, width: 350 }, 1000, 46)).toBe(232);
		expect(desktopControlsInset({ top: 10, bottom: 42, right: 1370, width: 350 }, 1300, 46)).toBe(202);
		expect(desktopControlsInset({ top: 10, bottom: 42, right: 1450, width: 350 }, 1000)).toBe(0);
		expect(desktopControlsInset({ top: 10, bottom: 42, right: -10, width: 350 }, 1000)).toBe(0);
		for (const width of [350, 396, 442]) {
			expect(desktopControlsInset({ top: 10, bottom: 42, right: 1100, width }, 1000, 46)).toBe(232);
		}
		expect(desktopControlsInset({ top: 10, bottom: 42, right: 1100, width: 200 }, 1000, 46) + 46).toBe(200);
		document.documentElement.dataset.campWindowFullscreen = 'true';
		expect(desktopControlsInset({ top: 0, bottom: 50, right: 1000, width: 700 }, 1000)).toBe(0);
	});

	test('tracks maximize, fullscreen and active changes from the host, removing its listener when closed', async () => {
		const view = render(MkDesktopTitlebar);
		document.documentElement.dataset.campWindowMaximized = 'true';
		document.documentElement.dataset.campWindowActive = 'false';
		window.dispatchEvent(new Event('camp-window-state-change'));
		await nextTick();
		expect(view.getByRole('button', { name: i18n.ts._desktop.restore })).toBeTruthy();
		expect(getDesktopWindowState()).toMatchObject({ maximized: true, active: false });
		document.documentElement.dataset.campWindowFullscreen = 'true';
		window.dispatchEvent(new Event('camp-window-state-change'));
		await nextTick();
		expect(view.queryAllByRole('button')).toHaveLength(0);
		const remove = vi.spyOn(window, 'removeEventListener');
		view.unmount();
		expect(remove).toHaveBeenCalledWith('camp-window-state-change', expect.any(Function));
	});

	test.each(['campDesktop', 'campWindowChrome'])('ordinary web and other desktop hosts have no caption or host commands when %s is absent', async key => {
		delete document.documentElement.dataset[key];
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const view = render(MkDesktopTitlebar);
		expect(view.queryAllByRole('button')).toHaveLength(0);
		desktopWindowCommand('close');
		expect(assign).not.toHaveBeenCalled();
	});

	test('a page modal traps page input while leaving window controls available', async () => {
		const view = render(MkDesktopTitlebar);
		const page = document.createElement('main');
		const modal = document.createElement('div');
		page.append(modal);
		view.container.append(page);
		const trap = focusTrap(modal);
		expect(view.container.querySelector<HTMLElement>('[data-camp-window-titlebar]')?.inert).toBe(false);
		expect(view.getByRole('button', { name: i18n.ts._desktop.closeWindow })).toBeTruthy();
		trap.release();
		page.remove();
	});
});
