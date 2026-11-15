/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const data = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
	get: async (key: string) => data.get(key),
	set: async (key: string, value: unknown) => { data.set(key, value); },
	del: async (key: string) => { data.delete(key); },
	clear: async () => { data.clear(); },
}));

const host = window as Window & { __campCredentialStorage?: unknown };
beforeEach(() => {
	vi.resetModules();
	data.clear();
	vi.stubGlobal('indexedDB', { open: () => null });
});
afterEach(() => { delete host.__campCredentialStorage; vi.unstubAllGlobals(); });

function attachHostCodec() {
	host.__campCredentialStorage = {
		seal: (value: string) => `sealed:${btoa(value)}`,
		open: (value: string) => atob(value.slice(7)),
		isSealed: (value: unknown) => typeof value === 'string' && value.startsWith('sealed:'),
	};
}

test('desktop migrates existing account tokens and protects future writes', async () => {
	attachHostCodec();
	const state = { accountTokens: { alice: 'alice-secret' }, accountInfos: {} };
	data.set('pizzax::base', state);
	const storage = await import('@/utility/idb-proxy.js');
	expect(await storage.get('pizzax::base')).toEqual(state);
	expect(data.get('pizzax::base')).toBeTypeOf('string');
	expect(data.get('pizzax::base')).not.toContain('alice-secret');
	await storage.set('pizzax::base', { accountTokens: { bob: 'bob-secret' } });
	expect(await storage.get('pizzax::base')).toEqual({ accountTokens: { bob: 'bob-secret' } });
	expect(data.get('pizzax::base')).not.toContain('bob-secret');
	await storage.del('pizzax::base');
	expect(await storage.get('pizzax::base')).toBeUndefined();
});

test('web and PWA keep their existing account storage', async () => {
	const storage = await import('@/utility/idb-proxy.js');
	const state = { accountTokens: { alice: 'web-token' } };
	await storage.set('pizzax::base', state);
	expect(data.get('pizzax::base')).toEqual(state);
	expect(await storage.get('pizzax::base')).toEqual(state);
});

test('host protection failures never fall back to plaintext', async () => {
	host.__campCredentialStorage = { seal: () => { throw new Error('locked'); } };
	const storage = await import('@/utility/idb-proxy.js');
	await expect(storage.set('pizzax::base', { accountTokens: { alice: 'secret' } })).rejects.toThrow('locked');
	expect(data.has('pizzax::base')).toBe(false);
});
