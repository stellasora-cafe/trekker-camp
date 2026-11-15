/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { restoreClientSession } from '@/utility/restore-client-session.js';

const account = { id: 'local-user', token: 'cs_local-test', name: 'Local test user' };
const apiUrl = 'http://localhost:3000/api';

describe('restoring a cached client session', () => {
	test.each([401, 403])('drops only the expired current session for HTTP %i', async status => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
		const restored = await restoreClientSession(account, fetcher, apiUrl);
		expect(restored).toEqual({ account: null, discardedAccountId: account.id, upgraded: false });
		expect(fetcher).toHaveBeenCalledWith(apiUrl + '/i', expect.objectContaining({ headers: expect.objectContaining({ 'X-Camp-Client': 'web-v1' }) }));
	});

	test('keeps cached login on a network error or a server failure', async () => {
		const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response('{}', { status: 503 }));
		expect((await restoreClientSession(account, fetcher, apiUrl)).account).toBe(account);
		expect((await restoreClientSession(account, fetcher, apiUrl)).account).toBe(account);
	});

	test('exchanges a valid legacy session before application stores initialize', async () => {
		const old = { ...account, token: '1234567890123456' };
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: old.id, i: 'cs_upgraded-local-test' })));
		const restored = await restoreClientSession(old, fetcher, apiUrl);
		expect(restored.account?.token).toBe('cs_upgraded-local-test');
		expect(restored.upgraded).toBe(true);
		expect(old.token).toBe('1234567890123456');
		expect(fetcher.mock.calls[0][0]).toBe(apiUrl + '/i/upgrade-client-session');
		expect(fetcher.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ 'X-Camp-Device-Platform': expect.any(String), 'X-Camp-Device-Name': expect.any(String) }));
	});
});
