/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { prepareDesktopPackageRestart, registerDesktopRestartEditor } from '@/utility/desktop-update.js';
import { checkDesktopUpdates } from '@/utility/desktop-window.js';

const dispose: (() => void)[] = [];
beforeEach(() => {
	document.documentElement.dataset.campDesktop = 'true';
	document.body.innerHTML = '<main id="misskey_app"><section id="composer"><textarea>draft</textarea></section></main>';
});
afterEach(() => {
	for (const unregister of dispose.splice(0)) unregister();
	delete document.documentElement.dataset.campDesktop;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

test('desktop manual check uses the native command, ordinary web and PWA do nothing', () => {
	const location = { href: '' };
	vi.stubGlobal('window', { document, location });
	checkDesktopUpdates();
	expect(location.href).toBe('camp-desktop://check-updates');
	delete document.documentElement.dataset.campDesktop;
	location.href = '';
	checkDesktopUpdates();
	expect(location.href).toBe('');
});

test('saves each recoverable editor before approving restart', async () => {
	const first = vi.fn(() => true);
	dispose.push(registerDesktopRestartEditor({ root: document.getElementById('composer')!, key: () => 'first', save: first }));
	const second = document.createElement('section');
	second.innerHTML = '<textarea>second draft</textarea>';
	document.getElementById('misskey_app')!.append(second);
	const save = vi.fn(() => true);
	dispose.push(registerDesktopRestartEditor({ root: second, key: () => 'second', save }));
	expect(await prepareDesktopPackageRestart()).toBe(true);
	expect(first).toHaveBeenCalledOnce();
	expect(save).toHaveBeenCalledOnce();
});

test('blocks unsaved unknown editors, uploads and local save errors', async () => {
	expect(await prepareDesktopPackageRestart()).toBe(false);
	const save = vi.fn(() => false);
	dispose.push(registerDesktopRestartEditor({ root: document.getElementById('composer')!, key: () => 'first', save }));
	expect(await prepareDesktopPackageRestart()).toBe(false);
	save.mockImplementation(() => { throw new Error('storage full'); });
	expect(await prepareDesktopPackageRestart()).toBe(false);
	save.mockReturnValue(true);
	document.getElementById('misskey_app')!.insertAdjacentHTML('beforeend', '<textarea>other editor</textarea>');
	expect(await prepareDesktopPackageRestart()).toBe(false);
});

test('does not overwrite two drafts using the same destination or retain unmounted editors', async () => {
	const root = document.getElementById('composer')!;
	const save = vi.fn(() => true);
	dispose.push(registerDesktopRestartEditor({ root, key: () => 'same', save }));
	const unregister = registerDesktopRestartEditor({ root, key: () => 'same', save });
	dispose.push(unregister);
	expect(await prepareDesktopPackageRestart()).toBe(false);
	expect(save).not.toHaveBeenCalled();
	unregister();
	expect(await prepareDesktopPackageRestart()).toBe(true);
});

test('empty page allows restart, login dialog and uninitialized page keep it open', async () => {
	document.getElementById('composer')!.innerHTML = '<textarea></textarea>';
	expect(await prepareDesktopPackageRestart()).toBe(true);
	document.body.insertAdjacentHTML('beforeend', '<section role="dialog"><input value="account"></section>');
	expect(await prepareDesktopPackageRestart()).toBe(false);
	document.body.innerHTML = '';
	expect(await prepareDesktopPackageRestart()).toBe(false);
});

test('maintenance does not block closing while drafts are saved and other dialogs stay protected', async () => {
	const save = vi.fn(() => true);
	dispose.push(registerDesktopRestartEditor({ root: document.getElementById('composer')!, key: () => 'draft', save }));
	document.body.insertAdjacentHTML('beforeend', '<dialog open data-camp-maintenance-view>maintenance</dialog>');
	expect(await prepareDesktopPackageRestart()).toBe(true);
	expect(save).toHaveBeenCalledOnce();
	document.body.insertAdjacentHTML('beforeend', '<dialog open>unsaved dialog</dialog>');
	expect(await prepareDesktopPackageRestart()).toBe(false);
	document.body.lastElementChild!.remove();
	save.mockReturnValue(false);
	expect(await prepareDesktopPackageRestart()).toBe(false);
});
