/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { OfflineContentCache } from '@/utility/offline-cache.js';

vi.mock('@/utility/idb-proxy.js', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

function memoryStorage() {
	const data = new Map<string, unknown>();
	return {
		data,
		get: async (key: string) => data.get(key),
		set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
		del: async (key: string) => { data.delete(key); },
	};
}

describe('desktop offline content cache', () => {
	test('survives reinitialization and isolates origin, account and anonymous data', async () => {
		const storage = memoryStorage();
		const cache = new OfflineContentCache(storage);
		await cache.write('https://camp.test', 'alice', 'notes/show', { noteId: 'one', i: 'secret' }, { id: 'one', text: 'cached' });
		const restarted = new OfflineContentCache(storage);
		expect((await restarted.read('https://camp.test', 'alice', 'notes/show', { noteId: 'one', i: 'changed' }))?.body).toEqual({ id: 'one', text: 'cached' });
		expect(await restarted.read('https://other.test', 'alice', 'notes/show', { noteId: 'one' })).toBeUndefined();
		expect(await restarted.read('https://camp.test', 'bob', 'notes/show', { noteId: 'one' })).toBeUndefined();
		expect(await restarted.read('https://camp.test', null, 'notes/show', { noteId: 'one' })).toBeUndefined();
		expect(JSON.stringify([...storage.data])).not.toContain('secret');
	});

	test('only caches explicit read endpoints and strips nested credential fields', async () => {
		const storage = memoryStorage();
		const cache = new OfflineContentCache(storage);
		await cache.write('https://camp.test', 'alice', 'notes/create', { text: 'draft' }, { id: 'published' });
		await cache.write('https://camp.test', 'alice', 'signin', { password: 'password-secret' }, { token: 'login-secret' });
		expect(storage.data.size).toBe(0);
		await cache.write('https://camp.test', 'alice', 'notes/show', { noteId: 'one', password: 'password-secret' }, { id: 'one', user: { id: 'alice', token: 'login-secret' } });
		expect(JSON.stringify([...storage.data])).not.toMatch(/password-secret|login-secret/);
	});

	test('cached timeline notes can be opened in detail without another online visit', async () => {
		const cache = new OfflineContentCache(memoryStorage());
		const note = { id: 'one', text: 'available offline', user: { id: 'alice' } };
		await cache.write('https://camp.test', 'alice', 'notes/local-timeline', { limit: 15 }, [note]);
		expect((await cache.read('https://camp.test', 'alice', 'notes/show', { noteId: 'one' }))?.body).toEqual(note);
	});

	test('enforces a bounded cache and clears only the revoked account', async () => {
		const cache = new OfflineContentCache(memoryStorage());
		for (let n = 0; n < 165; n++) await cache.write('https://camp.test', 'alice', 'notes/show', { noteId: String(n) }, { id: String(n) });
		await cache.write('https://camp.test', 'bob', 'notes/show', { noteId: 'bob' }, { id: 'bob' });
		expect(await cache.read('https://camp.test', 'alice', 'notes/show', { noteId: '0' })).toBeUndefined();
		expect((await cache.read('https://camp.test', 'alice', 'notes/show', { noteId: '164' }))?.body).toEqual({ id: '164' });
		await cache.clear('https://camp.test', 'alice');
		expect(await cache.read('https://camp.test', 'alice', 'notes/show', { noteId: '164' })).toBeUndefined();
		expect((await cache.read('https://camp.test', 'bob', 'notes/show', { noteId: 'bob' }))?.body).toEqual({ id: 'bob' });
	});
});
