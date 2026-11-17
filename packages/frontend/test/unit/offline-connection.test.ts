/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@@/js/config.js', () => ({ apiUrl: 'https://camp.example/api' }));

const fetcher = vi.fn<typeof fetch>();
const channels: ControlledBroadcastChannel[] = [];
let online = true;
let visibility: DocumentVisibilityState = 'visible';

class ControlledBroadcastChannel {
	readonly postMessage = vi.fn<(message: unknown) => void>();
	onmessage: ((event: MessageEvent) => void) | null = null;

	constructor(readonly name: string) {
		channels.push(this);
	}

	receive(data: unknown) {
		this.onmessage?.(new MessageEvent('message', { data }));
	}
}

function metadata() {
	return new Response(JSON.stringify({ version: '2026.11.0' }));
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

function connectionChanges() {
	const states: (string | undefined)[] = [];
	window.addEventListener('camp-connection-change', () => {
		states.push(document.documentElement.dataset.campConnection);
	});
	return states;
}

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.spyOn(window, 'addEventListener');
	vi.spyOn(window, 'fetch').mockImplementation(fetcher);
	vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
	vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
	vi.spyOn(globalThis, 'BroadcastChannel').mockImplementation(ControlledBroadcastChannel as unknown as typeof BroadcastChannel);
	channels.length = 0;
	fetcher.mockReset();
	online = true;
	visibility = 'visible';
	document.documentElement.dataset.campDesktop = 'true';
	delete document.documentElement.dataset.campConnection;
	delete document.documentElement.dataset.campMaintenance;
});

afterEach(() => {
	for (const [type, listener, options] of vi.mocked(window.addEventListener).mock.calls) {
		window.removeEventListener(type, listener, options);
	}
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	channels.length = 0;
	delete document.documentElement.dataset.campDesktop;
	delete document.documentElement.dataset.campConnection;
});

describe('desktop connection recovery', () => {
	test('local disconnect preserves the page, while a maintenance redirect activates the gate', async () => {
		const { serverUnavailable, maintenanceActive, observeMaintenanceResponse, serverAvailable } = await import('@/utility/offline.js');
		serverUnavailable();
		expect(maintenanceActive.value).toBe(false);
		const response = new Response('<html>maintenance</html>');
		Object.defineProperty(response, 'url', { value: 'https://camp.stellasora.cafe/__camp-maintenance/v1.html#/' });
		expect(observeMaintenanceResponse(response)).toBe(true);
		expect(maintenanceActive.value).toBe(true);
		serverAvailable();
		expect(maintenanceActive.value).toBe(false);
	});

	test('root URL maintenance survives successful API responses and ends after the host recovers', async () => {
		fetcher.mockResolvedValue(metadata());
		const { startOfflineRecovery, maintenanceActive, serverAvailable } = await import('@/utility/offline.js');
		startOfflineRecovery();
		await vi.advanceTimersByTimeAsync(0);
		document.documentElement.dataset.campMaintenance = 'true';
		window.dispatchEvent(new Event('camp-server-maintenance'));
		serverAvailable();
		expect(maintenanceActive.value).toBe(true);
		document.documentElement.dataset.campMaintenance = 'false';
		window.dispatchEvent(new Event('camp-server-maintenance'));
		await vi.advanceTimersByTimeAsync(0);
		expect(maintenanceActive.value).toBe(false);
	});
	test('first startup probes the server once and publishes the confirmed connection state', async () => {
		const pending = deferred<Response>();
		fetcher.mockReturnValueOnce(pending.promise);
		const { startOfflineRecovery, reconnectingServer, offline } = await import('@/utility/offline.js');
		const states = connectionChanges();
		startOfflineRecovery();
		startOfflineRecovery();
		expect(channels).toHaveLength(1);
		expect(channels[0].name).toBe('camp-desktop-connection');
		expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://camp.example/api/meta', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Camp-Client': 'web-v1' },
			body: JSON.stringify({ detail: false, i: null }),
			signal: expect.any(AbortSignal),
		});
		expect(reconnectingServer.value).toBe(true);
		expect(states).toEqual([]);
		pending.resolve(metadata());
		await vi.advanceTimersByTimeAsync(0);
		expect(reconnectingServer.value).toBe(false);
		expect(offline.value).toBe(false);
		expect(states).toEqual(['online']);
		expect(channels[0].postMessage).toHaveBeenCalledExactlyOnceWith('online');
		await vi.advanceTimersByTimeAsync(30_000);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test('first startup detects an unreachable server even when the operating system reports online', async () => {
		fetcher.mockRejectedValueOnce(new TypeError('network lost'));
		const { startOfflineRecovery, offline, reconnectingServer } = await import('@/utility/offline.js');
		const states = connectionChanges();
		startOfflineRecovery();
		await vi.advanceTimersByTimeAsync(0);
		expect(offline.value).toBe(true);
		expect(reconnectingServer.value).toBe(false);
		expect(states).toEqual(['offline']);
		expect(channels[0].postMessage).toHaveBeenCalledExactlyOnceWith('offline');
	});

	test('an initially offline native window announces its state before its recovery probe finishes', async () => {
		document.documentElement.dataset.campConnection = 'offline';
		const pending = deferred<Response>();
		fetcher.mockReturnValueOnce(pending.promise);
		const { startOfflineRecovery, offline } = await import('@/utility/offline.js');
		const states = connectionChanges();
		startOfflineRecovery();
		startOfflineRecovery();
		expect(channels).toHaveLength(1);
		expect(channels[0].postMessage).toHaveBeenCalledExactlyOnceWith('offline');
		expect(states).toEqual([]);
		expect(offline.value).toBe(true);
		pending.resolve(metadata());
		await vi.advanceTimersByTimeAsync(0);
		expect(offline.value).toBe(false);
		expect(channels[0].postMessage.mock.calls).toEqual([['offline'], ['online']]);
	});

	test('connection messages from another window update the local gate without an echo or extra requests', async () => {
		fetcher.mockResolvedValueOnce(metadata());
		const { startOfflineRecovery, offline } = await import('@/utility/offline.js');
		startOfflineRecovery();
		await vi.advanceTimersByTimeAsync(0);
		const states = connectionChanges();
		const channel = channels[0];
		channel.postMessage.mockClear();
		channel.receive('offline');
		expect(offline.value).toBe(true);
		expect(document.documentElement.dataset.campConnection).toBe('offline');
		channel.receive('offline');
		expect(states).toEqual(['offline']);
		channel.receive('online');
		expect(offline.value).toBe(false);
		expect(document.documentElement.dataset.campConnection).toBe('online');
		expect(states).toEqual(['offline', 'online']);
		expect(channel.postMessage).not.toHaveBeenCalled();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test('another window cannot reopen the gate while the operating system is offline', async () => {
		fetcher.mockResolvedValueOnce(metadata());
		const { startOfflineRecovery, offline } = await import('@/utility/offline.js');
		startOfflineRecovery();
		await vi.advanceTimersByTimeAsync(0);
		const states = connectionChanges();
		const channel = channels[0];
		channel.postMessage.mockClear();
		online = false;
		channel.receive('online');
		expect(offline.value).toBe(true);
		expect(states).toEqual(['offline']);
		online = true;
		channel.receive('online');
		expect(offline.value).toBe(false);
		expect(states).toEqual(['offline', 'online']);
		expect(channel.postMessage).not.toHaveBeenCalled();
	});

	test('unknown cross-window messages leave both online and offline states unchanged', async () => {
		fetcher.mockResolvedValueOnce(metadata());
		const { startOfflineRecovery, offline } = await import('@/utility/offline.js');
		startOfflineRecovery();
		await vi.advanceTimersByTimeAsync(0);
		const states = connectionChanges();
		const channel = channels[0];
		channel.postMessage.mockClear();
		const invalidMessages = [null, undefined, true, 0, {}, { state: 'online' }, ['offline'], 'OFFLINE', 'connected'];
		for (const message of invalidMessages) channel.receive(message);
		expect(offline.value).toBe(false);
		expect(states).toEqual([]);
		channel.receive('offline');
		for (const message of invalidMessages) channel.receive(message);
		expect(offline.value).toBe(true);
		expect(states).toEqual(['offline']);
		expect(channel.postMessage).not.toHaveBeenCalled();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test('offline startup does not fetch and serverAvailable cannot remove the operating system offline gate', async () => {
		online = false;
		const { startOfflineRecovery, offline, serverAvailable } = await import('@/utility/offline.js');
		const states = connectionChanges();
		expect(offline.value).toBe(true);
		startOfflineRecovery();
		serverAvailable();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(fetcher).not.toHaveBeenCalled();
		expect(offline.value).toBe(true);
		expect(states).toEqual(['offline']);
	});

	test('a successful request received after an offline event leaves the gate closed', async () => {
		const pending = deferred<Response>();
		fetcher.mockReturnValueOnce(pending.promise);
		const { startOfflineRecovery, offline } = await import('@/utility/offline.js');
		const states = connectionChanges();
		startOfflineRecovery();
		online = false;
		window.dispatchEvent(new Event('offline'));
		pending.resolve(metadata());
		await vi.advanceTimersByTimeAsync(0);
		expect(offline.value).toBe(true);
		expect(states).toEqual(['offline']);
	});

	test('an online event keeps the host offline until a fresh successful probe finishes', async () => {
		online = false;
		const pending = deferred<Response>();
		fetcher.mockReturnValueOnce(pending.promise);
		const { startOfflineRecovery, offline, reconnectingServer, reconnectServer } = await import('@/utility/offline.js');
		const states = connectionChanges();
		startOfflineRecovery();
		online = true;
		window.dispatchEvent(new Event('online'));
		window.dispatchEvent(new Event('online'));
		expect(await reconnectServer()).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(offline.value).toBe(true);
		expect(reconnectingServer.value).toBe(true);
		expect(states).toEqual(['offline']);
		pending.resolve(metadata());
		await vi.advanceTimersByTimeAsync(0);
		expect(offline.value).toBe(false);
		expect(reconnectingServer.value).toBe(false);
		expect(states).toEqual(['offline', 'online']);
	});

	test.each([
		{ description: 'HTTP maintenance response', body: '{"version":"2026.11.0"}', status: 503 },
		{ description: 'maintenance HTML with HTTP 200', body: '<html>maintenance</html>', status: 200 },
		{ description: 'missing version', body: '{}', status: 200 },
		{ description: 'invalid version type', body: '{"version":42}', status: 200 },
		{ description: 'null metadata', body: 'null', status: 200 },
	])('$description never unlocks the offline interface', async ({ body, status }) => {
		document.documentElement.dataset.campConnection = 'offline';
		const { reconnectServer, offline, reconnectingServer } = await import('@/utility/offline.js');
		const states = connectionChanges();
		expect(offline.value).toBe(true);
		fetcher.mockResolvedValueOnce(new Response(body, { status }));
		expect(await reconnectServer()).toBe(false);
		expect(offline.value).toBe(true);
		expect(reconnectingServer.value).toBe(false);
		expect(document.documentElement.dataset.campConnection).toBe('offline');
		expect(states).toEqual([]);
		fetcher.mockResolvedValueOnce(metadata());
		expect(await reconnectServer()).toBe(true);
		expect(offline.value).toBe(false);
		expect(states).toEqual(['online']);
	});

	test('background recovery waits for a visible window and an available operating system connection', async () => {
		fetcher.mockRejectedValueOnce(new TypeError('network lost'));
		const { startOfflineRecovery, offline } = await import('@/utility/offline.js');
		const states = connectionChanges();
		startOfflineRecovery();
		await vi.advanceTimersByTimeAsync(0);
		visibility = 'hidden';
		await vi.advanceTimersByTimeAsync(15_000);
		expect(fetcher).toHaveBeenCalledTimes(1);
		visibility = 'visible';
		online = false;
		await vi.advanceTimersByTimeAsync(15_000);
		expect(fetcher).toHaveBeenCalledTimes(1);
		online = true;
		fetcher.mockResolvedValueOnce(metadata());
		await vi.advanceTimersByTimeAsync(15_000);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(offline.value).toBe(false);
		expect(states).toEqual(['offline', 'online']);
	});

	test('ordinary web pages never install desktop recovery or publish desktop connection changes', async () => {
		delete document.documentElement.dataset.campDesktop;
		document.documentElement.dataset.campConnection = 'offline';
		online = false;
		const { startOfflineRecovery, serverUnavailable, serverAvailable, offline } = await import('@/utility/offline.js');
		const states = connectionChanges();
		startOfflineRecovery();
		serverUnavailable();
		serverAvailable();
		window.dispatchEvent(new Event('offline'));
		online = true;
		window.dispatchEvent(new Event('online'));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(fetcher).not.toHaveBeenCalled();
		expect(offline.value).toBe(false);
		expect(states).toEqual([]);
		expect(channels).toEqual([]);
		expect(document.documentElement.dataset.campConnection).toBe('offline');
		expect(vi.mocked(window.addEventListener).mock.calls.filter(([type]) => type === 'offline' || type === 'online')).toEqual([]);
	});
});
