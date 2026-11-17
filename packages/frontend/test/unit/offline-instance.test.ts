/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const local = vi.hoisted(() => new Map<string, string>());
const api = vi.hoisted(() => vi.fn());
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: api }));

beforeEach(() => {
	vi.resetModules();
	local.clear();
	api.mockReset();
	document.documentElement.dataset.campDesktop = 'true';
});
afterEach(() => { delete document.documentElement.dataset.campDesktop; });

describe('desktop instance metadata offline', () => {
	test('first offline launch has usable visitor metadata without server HTML', async () => {
		api.mockRejectedValue(new TypeError('offline'));
		const { instance, fetchInstance } = await import('@/instance.js');
		expect(instance.clientOptions).toEqual({});
		expect(instance.serverRules).toEqual([]);
		expect(instance.ads).toEqual([]);
		expect(instance.policies.ltlAvailable).toBe(false);
		expect(await fetchInstance()).toBe(instance);
		expect(local.get('instanceCachedAt')).toBeUndefined();
	});

	test('keeps last known metadata through an outage and refreshes when reachable', async () => {
		local.set('instance', JSON.stringify({ name: 'Cached camp', description: 'Saved description', clientOptions: {} }));
		local.set('instanceCachedAt', '1');
		api.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ name: 'Current camp', description: 'Updated', version: '2' });
		const { instance, fetchInstance } = await import('@/instance.js');
		await fetchInstance(true);
		expect(instance.name).toBe('Cached camp');
		await fetchInstance(true);
		expect(instance.name).toBe('Current camp');
		expect(JSON.parse(local.get('instance')!).description).toBe('Updated');
	});
});
