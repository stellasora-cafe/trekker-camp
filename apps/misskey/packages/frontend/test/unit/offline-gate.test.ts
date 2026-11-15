/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, markRaw, nextTick, ref } from 'vue';
import MkOfflineGate from '@/components/MkOfflineGate.vue';
import { maintenanceActive as offline, offline as disconnected } from '@/utility/offline.js';
import * as os from '@/os.js';
import { focusTrap } from '@/utility/focus-trap.js';
import { i18n } from '@/i18n.js';

vi.mock('@/utility/offline.js', () => ({ maintenanceActive: ref(false), offline: ref(false), isDesktopClient: () => document.documentElement.dataset.campDesktop === 'true' }));
vi.mock('@/os.js', () => ({ confirm: vi.fn() }));

let mounts = 0;
const content = markRaw(defineComponent({
	setup() {
		mounts++;
		return { draft: ref('saved draft') };
	},
	template: '<main><header data-camp-window-drag>Window header</header><input v-model="draft" aria-label="Draft"><button>Settings</button><div id="popup"><input aria-label="Popup field"></div></main>',
}));
const releases: (() => void)[] = [];

beforeEach(() => {
	(offline as { value: boolean }).value = false;
	(disconnected as { value: boolean }).value = false;
	mounts = 0;
	delete document.documentElement.dataset.campDesktop;
	delete document.documentElement.dataset.campWindowChrome;
});
afterEach(() => {
	cleanup();
	for (const release of releases.splice(0)) release();
	document.body.inert = false;
	delete document.documentElement.dataset.campDesktop;
	delete document.documentElement.dataset.campWindowChrome;
	vi.restoreAllMocks();
});

async function network(blocked: boolean) {
	(offline as { value: boolean }).value = blocked;
	await nextTick();
	await nextTick();
}

function mount() {
	const view = render(MkOfflineGate, {
		props: { component: content },
		global: { stubs: {
			MkOfflineNotice: { template: '<section><button>Reconnect</button></section>' },
			MkContextMenu: { template: '<div data-testid="desktop-context-menu"></div>' },
		} },
	});
	const dialog = view.container.querySelector('dialog')!;
	dialog.style.zIndex = '2147483647';
	return { ...view, dialog };
}

describe('desktop offline gate', () => {
	test('local offline keeps content visible and allows refresh with an empty composer', async () => {
		document.documentElement.dataset.campDesktop = 'true';
		(disconnected as { value: boolean }).value = true;
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const view = mount();
		const editor = document.createElement('textarea');
		view.container.append(editor);
		await nextTick();
		expect(view.dialog.open).toBe(false);
		expect(view.getByText('Settings').closest('[data-camp-desktop-content]')?.getAttribute('aria-hidden')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.reload }));
		expect(assign).toHaveBeenCalledWith('camp-desktop://frontend-apply');
		assign.mockClear();
		editor.value = 'unsaved draft';
		vi.mocked(os.confirm).mockResolvedValueOnce({ canceled: true });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.reload }));
		expect(os.confirm).toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
	});
	test.each([false, true])('keeps dragging and double-click maximize working through reconnects (offline start: %s)', async initiallyOffline => {
		document.documentElement.dataset.campDesktop = 'true';
		document.documentElement.dataset.campWindowChrome = 'true';
		(offline as { value: boolean }).value = initiallyOffline;
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const view = mount();
		for (const blocked of [initiallyOffline, true, false, true, false]) {
			await network(blocked);
			const header = blocked ? view.dialog.querySelector('[data-camp-window-drag]')! : view.getByText('Window header');
			await fireEvent.mouseDown(header, { button: 0, detail: 1, clientY: 40 });
			await fireEvent.mouseDown(header, { button: 0, detail: 2, clientY: 40 });
			expect(assign.mock.calls.map(([url]) => url)).toEqual([
				'camp-desktop://window-control?action=drag',
				'camp-desktop://window-control?action=maximize',
			]);
			assign.mockClear();
		}
		view.unmount();
		const detachedHeader = document.createElement('header');
		detachedHeader.setAttribute('data-camp-window-drag', '');
		document.body.append(detachedHeader);
		await fireEvent.mouseDown(detachedHeader, { button: 0, detail: 1, clientY: 40 });
		expect(assign).not.toHaveBeenCalled();
		detachedHeader.remove();
	});

	test('keeps desktop text menus inside the maintenance top layer', async () => {
		document.documentElement.dataset.campDesktop = 'true';
		document.documentElement.dataset.campWindowChrome = 'true';
		const view = mount();
		await network(true);
		const button = view.getByRole('button', { name: 'Reconnect' });
		expect(view.dialog.querySelector('[data-camp-window-drag]')?.classList.contains('_campWindowHeader')).toBe(true);
		button.addEventListener('contextmenu', event => event.stopPropagation());
		const range = document.createRange();
		range.selectNodeContents(button);
		document.getSelection()!.addRange(range);
		await fireEvent.contextMenu(button);
		expect(view.queryByTestId('desktop-context-menu')).toBeNull();
		window.dispatchEvent(new Event('camp-native-context-menu'));
		const menu = await view.findByTestId('desktop-context-menu');
		expect(view.dialog.contains(menu)).toBe(true);
		await network(false);
		expect(view.queryByTestId('desktop-context-menu')).toBeNull();
		document.getSelection()!.removeAllRanges();
	});

	test('blocks cached content and settings, preserving drafts and focus on reconnection', async () => {
		const view = mount();
		await nextTick();
		const input = view.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement;
		await fireEvent.update(input, 'unfinished post');
		input.focus();
		await network(true);
		expect(view.dialog.open).toBe(true);
		expect(view.queryByRole('button', { name: 'Settings' })).toBeNull();
		expect(view.queryByRole('textbox', { name: 'Draft' })).toBeNull();
		expect(view.container.querySelector('[data-camp-desktop-content]')?.hasAttribute('inert')).toBe(true);
		expect(view.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
		await network(false);
		expect(view.dialog.open).toBe(false);
		expect(view.getByRole('textbox', { name: 'Draft' })).toBe(input);
		expect(input.value).toBe('unfinished post');
		expect(document.activeElement).toBe(input);
		expect(mounts).toBe(1);
		expect((view.container as HTMLElement).inert).toBe(false);
	});

	test('holds focus above existing and late popups, then restores their interaction', async () => {
		const view = mount();
		await nextTick();
		const popup = view.container.querySelector<HTMLElement>('#popup')!;
		popup.style.zIndex = '1000';
		const original = focusTrap(popup);
		releases.push(original.release);
		const input = view.getByRole('textbox', { name: 'Popup field' });
		input.focus();
		await network(true);
		expect(view.dialog.inert).toBe(false);
		const late = document.createElement('div');
		late.style.zIndex = '2000';
		view.container.querySelector('main')!.append(late);
		const lateTrap = focusTrap(late);
		expect(view.dialog.inert).toBe(false);
		expect((view.container as HTMLElement).inert).toBe(false);
		lateTrap.release();
		late.remove();
		expect(view.dialog.inert).toBe(false);
		await network(false);
		expect(popup.inert).toBe(false);
		expect(view.container.querySelector('[data-camp-desktop-content]')?.hasAttribute('inert')).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	test('prevents Escape and document shortcuts from dismissing maintenance', async () => {
		const view = mount();
		await network(true);
		const cancel = new Event('cancel', { cancelable: true });
		view.dialog.dispatchEvent(cancel);
		expect(cancel.defaultPrevented).toBe(true);
		const shortcut = vi.fn();
		document.addEventListener('keydown', shortcut);
		await fireEvent.keyDown(view.getByRole('button', { name: 'Reconnect' }), { key: 'Escape' });
		document.removeEventListener('keydown', shortcut);
		expect(shortcut).not.toHaveBeenCalled();
		expect(view.dialog.open).toBe(true);
	});

	test('opens on an offline cold start and survives repeated connection changes', async () => {
		(offline as { value: boolean }).value = true;
		const view = mount();
		await nextTick();
		expect(view.dialog.open).toBe(true);
		for (let i = 0; i < 3; i++) {
			await network(false);
			await network(true);
		}
		await network(false);
		expect(view.dialog.open).toBe(false);
		expect(view.getByRole('button', { name: 'Settings' })).toBeTruthy();
		expect(mounts).toBe(1);
		expect(document.body.inert).toBe(false);
	});

	test('moves window controls inside the modal maintenance page and restores them on reconnect', async () => {
		document.documentElement.dataset.campDesktop = 'true';
		document.documentElement.dataset.campWindowChrome = 'true';
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		const view = mount();
		await nextTick();
		expect(view.getByRole('button', { name: i18n.ts._desktop.closeWindow }).closest('dialog')).toBeNull();
		await network(true);
		const close = view.getByRole('button', { name: i18n.ts._desktop.closeWindow });
		expect(close.closest('dialog')).toBe(view.dialog);
		expect(close.closest('[inert]')).toBeNull();
		await fireEvent.click(close);
		expect(assign).toHaveBeenCalledExactlyOnceWith('camp-desktop://window-control?action=close');
		await network(false);
		expect(view.getByRole('button', { name: i18n.ts._desktop.closeWindow }).closest('dialog')).toBeNull();
		expect(view.getByRole('button', { name: 'Settings' })).toBeTruthy();
	});
});
