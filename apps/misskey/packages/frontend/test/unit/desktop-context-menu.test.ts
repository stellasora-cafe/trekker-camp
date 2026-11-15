/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/vue';
import { desktopContextMenu } from '@/utility/desktop-context-menu.js';
import type { DesktopContextMenu } from '@/utility/desktop-context-menu.js';
import type { MenuButton } from '@/types/menu.js';
import { i18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/os.js', () => ({ toast: mocks.toast }));

let root: HTMLElement;

beforeEach(() => {
	document.documentElement.dataset.campDesktop = 'true';
	document.documentElement.dataset.campWindowChrome = 'true';
	root = document.createElement('main');
	document.body.append(root);
});

afterEach(() => {
	root.remove();
	document.getSelection()?.removeAllRanges();
	delete document.documentElement.dataset.campDesktop;
	delete document.documentElement.dataset.campWindowChrome;
	vi.restoreAllMocks();
	Reflect.deleteProperty(document, 'execCommand');
});

function context(target: Element, prevented = false) {
	const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true });
	if (prevented) event.preventDefault();
	target.dispatchEvent(event);
	return { event, menu: desktopContextMenu(event) };
}

function action(menu: DesktopContextMenu | null, name: string) {
	const item = menu?.items.find(item => 'text' in item && item.text === name) as MenuButton;
	expect(item).toBeTruthy();
	item.action(new PointerEvent('click'));
}

describe('desktop context menus', () => {
	test('ordinary websites retain browser menus and existing page menus keep control', () => {
		delete document.documentElement.dataset.campWindowChrome;
		expect(context(root).event.defaultPrevented).toBe(false);
		document.documentElement.dataset.campWindowChrome = 'true';
		expect(context(root, true).menu).toBeNull();
		expect(context(root).event.defaultPrevented).toBe(true);
		root.setAttribute('data-camp-window-titlebar', '');
		expect(context(root).menu).toBeNull();
	});

	test('restores the original text selection for editing and only accepts the matching paste response', () => {
		const input = document.createElement('textarea');
		input.value = 'camp traveller';
		root.append(input);
		input.focus();
		input.setSelectionRange(5, 14);
		const exec = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const { menu } = context(input);
		input.setSelectionRange(0, 0);
		action(menu, i18n.ts._desktop.cut);
		expect(input.selectionStart).toBe(5);
		expect(input.selectionEnd).toBe(14);
		expect(exec).toHaveBeenCalledWith('cut');
		action(menu, i18n.ts.paste);
		const uri = new URL(String(assign.mock.calls[0][0]));
		expect(uri.host).toBe('context-action');
		expect(uri.searchParams.get('action')).toBe('paste');
		window.dispatchEvent(new CustomEvent('camp-context-result', { detail: { requestId: 'unrelated', text: 'ignored' } }));
		expect(exec).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new CustomEvent('camp-context-result', { detail: { requestId: uri.searchParams.get('requestId'), text: '星塔旅人' } }));
		expect(exec).toHaveBeenLastCalledWith('insertText', false, '星塔旅人');
		input.setSelectionRange(0, input.value.length);
		menu!.restore();
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
	});

	test('readonly fields allow copying without cut/paste and password fields do not expose selected text', () => {
		const input = document.createElement('input');
		input.value = 'selected text';
		input.readOnly = true;
		root.append(input);
		input.setSelectionRange(0, 8);
		const names = () => context(input).menu?.items.filter(item => 'text' in item).map(item => item.text);
		expect(names()).toContain(i18n.ts.copy);
		expect(names()).not.toContain(i18n.ts.paste);
		expect(names()).not.toContain(i18n.ts._desktop.cut);
		input.type = 'password';
		expect(names()).not.toContain(i18n.ts.copy);
	});

	test('links and images retain their distinct copy, open, and save actions', async () => {
		const link = document.createElement('a');
		link.href = 'https://camp.example/note';
		const image = document.createElement('img');
		image.src = 'https://camp.example/photo.png';
		link.append(image);
		root.append(link);
		const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		vi.spyOn(window, 'fetch').mockResolvedValue(new Response(new Blob(['image data'], { type: 'image/png' })));
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://camp.example/download');
		const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			expect(this.href).toBe('blob:https://camp.example/download');
			expect(this.download).toBe('photo.png');
		});
		const { menu } = context(image);
		action(menu, i18n.ts.copyLink);
		expect(writeText).toHaveBeenCalledWith(link.href);
		action(menu, i18n.ts._desktop.copyImageLink);
		expect(writeText).toHaveBeenCalledWith(image.src);
		action(menu, i18n.ts._desktop.openImage);
		expect(open).toHaveBeenCalledWith(image.src, '_blank', 'noopener,noreferrer');
		action(menu, i18n.ts._desktop.saveImage);
		await waitFor(() => expect(download).toHaveBeenCalledOnce());
		expect(menu?.items.some(item => 'text' in item && item.text === i18n.ts._desktop.copyImage)).toBe(true);
	});

	test('media controls change the selected media and preserve its URL', () => {
		const media = document.createElement('video');
		media.src = 'https://camp.example/clip.mp4';
		root.append(media);
		const play = vi.spyOn(media, 'play').mockResolvedValue();
		const { menu } = context(media);
		action(menu, i18n.ts._desktop.play);
		expect(play).toHaveBeenCalledOnce();
		action(menu, i18n.ts._desktop.mute);
		expect(media.muted).toBe(true);
	});
});
