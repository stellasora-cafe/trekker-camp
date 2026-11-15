/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { PreferencesManager } from '@/preferences/manager.js';
import type { StorageProvider } from '@/preferences/manager.js';
import { serverAvailable, serverUnavailable } from '@/utility/offline.js';

vi.mock('@/os.js', () => ({}));
vi.mock('@/utility/device-kind.js', () => ({ DEFAULT_DEVICE_KIND: 'desktop' }));

afterEach(() => {
	delete document.documentElement.dataset.campDesktop;
	serverAvailable();
});

describe('local settings without a server', () => {
	test('client settings remain editable and survive restarting with cloud unavailable', async () => {
		document.documentElement.dataset.campDesktop = 'true';
		serverUnavailable();
		let saved: string | null = null;
		const provider: StorageProvider = {
			load: () => saved ? JSON.parse(saved) : null,
			save: ({ profile }) => { saved = JSON.stringify(profile); },
			cloudGetBulk: vi.fn().mockRejectedValue(new TypeError('offline')),
			cloudGet: vi.fn().mockRejectedValue(new TypeError('offline')),
			cloudSet: vi.fn().mockRejectedValue(new TypeError('offline')),
		};
		const first = new PreferencesManager(provider, { id: 'alice' });
		await first.cloudReady;
		first.commit('animation', false);
		first.commit('useBlurEffect', false);
		first.commit('showTitlebar', true);
		const restarted = new PreferencesManager(provider, { id: 'alice' });
		await restarted.cloudReady;
		expect(restarted.s.animation).toBe(false);
		expect(restarted.s.useBlurEffect).toBe(false);
		expect(restarted.s.showTitlebar).toBe(true);
		expect(provider.cloudSet).not.toHaveBeenCalled();
	});
});
