/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';
import { popups, waiting } from '@/os.js';
import { focusTrap } from '@/utility/focus-trap.js';

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn() }));
vi.mock('@/utility/show-moved-dialog.js', () => ({ showMovedDialog: vi.fn() }));
vi.mock('@/components/MkPostFormDialog.vue', () => ({ default: {} }));
vi.mock('@/components/MkWaitingDialog.vue', () => ({ default: {} }));
vi.mock('@/components/MkPageWindow.vue', () => ({ default: {} }));
vi.mock('@/components/MkToast.vue', () => ({ default: {} }));
vi.mock('@/components/MkDialog.vue', () => ({ default: {} }));
vi.mock('@/components/MkPopupMenu.vue', () => ({ default: {} }));
vi.mock('@/components/MkContextMenu.vue', () => ({ default: {} }));

let root: HTMLElement;
let caption: HTMLElement;
let content: HTMLElement;
let overlays: HTMLElement;
const releases: (() => void)[] = [];

beforeEach(() => {
	document.documentElement.dataset.campDesktop = 'true';
	document.documentElement.dataset.campWindowChrome = 'true';
	root = document.createElement('div');
	caption = document.createElement('header');
	caption.setAttribute('data-camp-window-titlebar', '');
	content = document.createElement('main');
	overlays = document.createElement('div');
	root.append(caption, content, overlays);
	document.body.append(root);
});

afterEach(() => {
	for (const release of releases.splice(0)) release();
	root.remove();
	popups.value = [];
	document.body.inert = false;
	delete document.documentElement.dataset.campDesktop;
	delete document.documentElement.dataset.campWindowChrome;
});

function modal(zIndex: number) {
	const element = document.createElement('div');
	element.style.zIndex = String(zIndex);
	overlays.append(element);
	const trap = focusTrap(element);
	releases.push(trap.release);
	return { element, release: trap.release };
}

describe('desktop waiting focus ownership', () => {
	test.each([true, false])('restores current modal state when the preceding confirmation closes first: %s', async closeConfirmation => {
		const confirm = modal(1000000);
		expect(content.inert).toBe(true);
		const done = waiting();
		const operation = popups.value.at(-1)!;
		// MkWaitingDialog mounts a high-priority MkModal and releases its focus
		// trap before emitting closed after the exit animation.
		const progress = modal(3000000);
		expect(content.inert).toBe(true);
		expect(confirm.element.inert).toBe(true);
		expect(caption.inert).toBe(false);
		expect(root.inert).toBe(false);
		expect(document.body.inert).toBe(false);
		if (closeConfirmation) confirm.release();
		done();
		progress.release();
		operation.events.closed();
		await nextTick();
		expect(content.inert).toBe(!closeConfirmation);
		expect(overlays.inert).toBe(false);
		expect(caption.inert).toBe(false);
		if (!closeConfirmation) {
			expect(confirm.element.inert).toBe(false);
			confirm.release();
			expect(content.inert).toBe(false);
		}
		expect(popups.value).toHaveLength(0);
	});

	test('ordinary web keeps its existing body input blocking behavior', async () => {
		delete document.documentElement.dataset.campDesktop;
		delete document.documentElement.dataset.campWindowChrome;
		const done = waiting();
		const operation = popups.value.at(-1)!;
		expect(document.body.inert).toBe(true);
		done();
		operation.events.closed();
		await nextTick();
		expect(document.body.inert).toBe(false);
		expect(popups.value).toHaveLength(0);
	});
});
