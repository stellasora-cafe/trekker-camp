/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getWebDeviceHeaders } from '@/utility/get-user-environment.js';
import { isDesktopClient, offline, serverAvailable, serverUnavailable, observeMaintenanceResponse } from '@/utility/offline.js';

type CachedAccount = { id: string; token: string };

export async function restoreClientSession<T extends CachedAccount>(account: T | null, fetcher: typeof fetch, apiUrl: string): Promise<{
	account: T | null;
	discardedAccountId: string | null;
	upgraded: boolean;
}> {
	const retained = { account, discardedAccountId: null, upgraded: false };
	if (account == null) return retained;
	if (isDesktopClient() && offline.value) return retained;
	const legacy = account.token.length === 16;
	try {
		const response = await fetcher(`${apiUrl}/${legacy ? 'i/upgrade-client-session' : 'i'}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Camp-Client': 'web-v1', ...(legacy ? getWebDeviceHeaders() : {}) },
			body: JSON.stringify({ i: account.token }),
			signal: AbortSignal.timeout(4000),
		});
		if (observeMaintenanceResponse(response)) return retained;
		if (response.status === 401 || response.status === 403) {
			return { account: null, discardedAccountId: account.id, upgraded: false };
		}
		if (!response.ok) {
			if (response.status >= 500) serverUnavailable();
			return retained;
		}
		serverAvailable();
		const result = await response.json() as { id?: string; i?: string };
		if (legacy && result.id === account.id && result.i?.startsWith('cs_')) {
			return { account: { ...account, token: result.i }, discardedAccountId: null, upgraded: true };
		}
		return retained;
	} catch {
		serverUnavailable();
		return retained;
	}
}
