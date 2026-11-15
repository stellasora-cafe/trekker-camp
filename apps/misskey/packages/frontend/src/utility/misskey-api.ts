/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { ref } from 'vue';
import { apiUrl } from '@@/js/config.js';
import { $i } from '@/i.js';
import { getWebDeviceHeaders } from '@/utility/get-user-environment.js';
import { offline, isDesktopClient, serverAvailable, serverUnavailable, observeMaintenanceResponse } from '@/utility/offline.js';
import { offlineContentCache } from '@/utility/offline-cache.js';
export const pendingApiRequestsCount = ref(0);

async function requestApi(endpoint: string, data: Record<string, unknown>, method: 'GET' | 'POST', signal?: AbortSignal): Promise<unknown> {
	const desktop = isDesktopClient();
	const accountId = data.i == null ? null : $i && data.i === $i.token ? $i.id : undefined;
	const cacheable = desktop && accountId !== undefined && offlineContentCache.accepts(endpoint);
	const cachedOrFail = async (error: unknown): Promise<unknown> => {
		if (cacheable) {
			const cached = await offlineContentCache.read(window.location.origin, accountId, endpoint, data);
			if (cached) return cached.body;
		}
		throw error;
	};
	if (signal?.aborted) throw signal.reason;
	if (desktop && offline.value) return cachedOrFail(new TypeError('Network unavailable'));
	const requestSignal = desktop ? AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) : signal;
	const query = method === 'GET' ? `?${new URLSearchParams(data as Record<string, string>)}` : '';
	let response: Response;
	try {
		response = await window.fetch(`${apiUrl}/${endpoint}${query}`, {
			method,
			body: method === 'POST' ? JSON.stringify(data) : undefined,
			credentials: 'omit',
			cache: method === 'POST' ? 'no-cache' : 'default',
			headers: {
				...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
				'X-Camp-Client': 'web-v1',
				...(['signin-flow', 'signin', 'signup', 'i/upgrade-client-session'].includes(endpoint) ? getWebDeviceHeaders() : {}),
			},
			signal: requestSignal,
		});
	} catch (error) {
		if (signal?.aborted) throw error;
		serverUnavailable();
		return cachedOrFail(error);
	}
	if (observeMaintenanceResponse(response) || (desktop && response.status >= 500)) {
		serverUnavailable();
		return cachedOrFail(new Error(`HTTP ${response.status}`));
	}
	if (desktop && accountId !== undefined && (response.status === 401 || response.status === 403)) {
		await offlineContentCache.clear(window.location.origin, accountId);
	}
	const body = response.status === 204 ? undefined : await response.json();
	if (response.status !== 200 && response.status !== 204) throw body.error;
	serverAvailable();
	if (cacheable && body !== undefined) void offlineContentCache.write(window.location.origin, accountId, endpoint, data, body);
	return body;
}

// Implements Misskey.api.ApiClient.request
export function misskeyApi<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data: P & { i?: string | null; } = {} as any,
	token?: string | null | undefined,
	signal?: AbortSignal,
): Promise<_ResT> {
	if (endpoint.includes('://')) throw new Error('invalid endpoint');
	const body = { ...data } as Record<string, unknown>;
	if ($i) body.i = $i.token;
	if (token !== undefined) body.i = token;
	pendingApiRequestsCount.value++;
	return requestApi(endpoint, body, 'POST', signal).finally(() => { pendingApiRequestsCount.value--; }) as Promise<_ResT>;
}

// Implements Misskey.api.ApiClient.request
export function misskeyApiGet<
	ResT = void,
	E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints,
	P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'],
	_ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT,
>(
	endpoint: E,
	data: P = {} as any,
): Promise<_ResT> {
	if (endpoint.includes('://')) throw new Error('invalid endpoint');
	pendingApiRequestsCount.value++;
	return requestApi(endpoint, data as Record<string, unknown>, 'GET').finally(() => { pendingApiRequestsCount.value--; }) as Promise<_ResT>;
}
