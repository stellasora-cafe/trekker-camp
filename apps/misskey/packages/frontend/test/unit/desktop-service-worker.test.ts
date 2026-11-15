/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { initializeSw } from '@/utility/initialize-sw.js';

const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
afterEach(() => {
	delete document.documentElement.dataset.campDesktop;
	if (original) Object.defineProperty(navigator, 'serviceWorker', original);
	else Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('desktop local frontend and service workers', () => {
	test('removes old online navigation workers without clearing local storage', async () => {
		document.documentElement.dataset.campDesktop = 'true';
		const unregister = vi.fn().mockResolvedValue(true);
		const register = vi.fn();
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistrations: async () => [{ unregister }], register } });
		localStorage.setItem('offline-test-preference', 'saved');
		await initializeSw();
		expect(unregister).toHaveBeenCalledOnce();
		expect(register).not.toHaveBeenCalled();
		expect(localStorage.getItem('offline-test-preference')).toBe('saved');
		localStorage.removeItem('offline-test-preference');
	});

	test('web and PWA retain service worker registration and localization', async () => {
		const postMessage = vi.fn();
		const register = vi.fn();
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register, ready: Promise.resolve({ active: { postMessage } }) } });
		await initializeSw();
		expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', type: 'classic' });
		expect(postMessage).toHaveBeenCalledWith({ msg: 'initialize', lang: 'zh-CN' });
	});
});
