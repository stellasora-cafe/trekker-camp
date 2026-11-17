/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { misskeyApi, pendingApiRequestsCount } from '@/utility/misskey-api.js';
import { offline, serverAvailable, serverUnavailable, reconnectServer } from '@/utility/offline.js';
import { offlineContentCache } from '@/utility/offline-cache.js';

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/utility/idb-proxy.js', () => ({
	get: async (key: string) => memory.get(key),
	set: async (key: string, value: unknown) => { memory.set(key, structuredClone(value)); },
	del: async (key: string) => { memory.delete(key); },
}));
vi.mock('@/i.js', () => ({ $i: { id: 'alice', token: 'cs_alice' } }));

const fetcher = vi.fn<typeof fetch>();

beforeEach(() => {
	document.documentElement.dataset.campDesktop = 'true';
	serverAvailable();
	memory.clear();
	fetcher.mockReset();
	vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
	delete document.documentElement.dataset.campDesktop;
	serverAvailable();
});

async function seed() {
	fetcher.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'one', text: 'saved', user: { id: 'alice' } }])));
	await misskeyApi('notes/local-timeline', { limit: 15 });
	await offlineContentCache.read(location.origin, 'alice', 'notes/local-timeline', { limit: 15 });
}

describe('offline API behavior', () => {
	test('network failure reuses cached timeline and detail while writes fail immediately', async () => {
		await seed();
		fetcher.mockRejectedValueOnce(new TypeError('network lost'));
		expect(await misskeyApi('notes/local-timeline', { limit: 15 })).toMatchObject([{ id: 'one' }]);
		expect(offline.value).toBe(true);
		expect(await misskeyApi('notes/show', { noteId: 'one' })).toMatchObject({ id: 'one' });
		await expect(misskeyApi('notes/create', { text: 'never queued' })).rejects.toThrow();
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(pendingApiRequestsCount.value).toBe(0);
	});

	test.each([401, 403])('HTTP %i purges private cache without masking authorization failure', async status => {
		await seed();
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'AUTHENTICATION_FAILED' } }), { status }));
		await expect(misskeyApi('notes/local-timeline', { limit: 15 })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
		serverUnavailable();
		await expect(misskeyApi('notes/show', { noteId: 'one' })).rejects.toThrow();
	});

	test('maintenance HTML falls back to cache without JSON parsing errors', async () => {
		await seed();
		fetcher.mockResolvedValueOnce(new Response('<html>maintenance</html>', { status: 503 }));
		expect(await misskeyApi('notes/local-timeline', { limit: 15 })).toMatchObject([{ id: 'one' }]);
		expect(offline.value).toBe(true);
	});

	test('explicit plugin credentials cannot read another account cache', async () => {
		await seed();
		serverUnavailable();
		await expect(misskeyApi('notes/local-timeline', { limit: 15 }, 'plugin-secret')).rejects.toThrow();
		await expect(misskeyApi('notes/local-timeline', { limit: 15 }, null)).rejects.toThrow();
	});

	test('ordinary web requests preserve errors and do not use desktop caches', async () => {
		await seed();
		delete document.documentElement.dataset.campDesktop;
		fetcher.mockRejectedValueOnce(new TypeError('offline'));
		await expect(misskeyApi('notes/local-timeline', { limit: 15 })).rejects.toThrow('offline');
		expect(offline.value).toBe(false);
	});

	test('caller cancellation never switches the app offline', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(misskeyApi('notes/local-timeline', {}, undefined, controller.signal)).rejects.toThrow();
		expect(offline.value).toBe(false);
		expect(fetcher).not.toHaveBeenCalled();
	});

	test('successful server retry exits offline mode', async () => {
		serverUnavailable();
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ version: '1' })));
		expect(await reconnectServer()).toBe(true);
		expect(offline.value).toBe(false);
	});
});
