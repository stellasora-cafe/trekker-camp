/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createBrowserLogin } from '@/utility/browser-login.js';

const mocks = vi.hoisted(() => ({ api: vi.fn(), login: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/accounts.js', () => ({ login: mocks.login }));

const requestId = '9fe36e54-f70e-4168-8077-39f0dd4057f4';
const secret = 's'.repeat(43);
const flows: ReturnType<typeof createBrowserLogin>[] = [];

function authorization() {
	return {
		requestId, secret,
		authorizeUrl: window.location.origin + '/client-auth/' + requestId,
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	};
}

function flow() {
	const value = createBrowserLogin();
	flows.push(value);
	return value;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-14T14:00:00Z'));
	vi.clearAllMocks();
	document.documentElement.dataset.campDesktop = 'true';
	mocks.login.mockResolvedValue(undefined);
	mocks.api.mockImplementation((endpoint: string) => Promise.resolve(endpoint === 'client-auth/start' ? authorization() : { status: 'pending' }));
	vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
	for (const current of flows.splice(0)) current.dispose();
	delete document.documentElement.dataset.campDesktop;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('desktop browser login', () => {
	test('opens only the public authorization URL, reopens the same request, then delegates an approved client session to login', async () => {
		const current = flow();
		await current.start();
		expect(current.state.value).toBe('waiting');
		expect(window.open).toHaveBeenCalledExactlyOnceWith(authorization().authorizeUrl, 'camp-desktop-browser-auth');
		expect(JSON.stringify(vi.mocked(window.open).mock.calls)).not.toContain(secret);
		expect(mocks.api).toHaveBeenCalledWith('client-auth/start', expect.objectContaining({ name: expect.any(String) }), null, expect.any(AbortSignal));
		current.reopen();
		expect(window.open).toHaveBeenCalledTimes(2);
		expect(mocks.api).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1500);
		expect(mocks.api).toHaveBeenLastCalledWith('client-auth/check', { requestId, secret }, null, expect.any(AbortSignal));
		mocks.api.mockResolvedValueOnce({ status: 'approved', i: 'cs_approved-session', id: 'camp-user' });
		await vi.advanceTimersByTimeAsync(1500);
		expect(mocks.login).toHaveBeenCalledExactlyOnceWith('cs_approved-session');
		expect(current.state.value).toBe('signingIn');
		const calls = mocks.api.mock.calls.length;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.api).toHaveBeenCalledTimes(calls);
	});

	test('ignores duplicate start clicks and a cancelled start response after a replacement request', async () => {
		const pending = deferred<ReturnType<typeof authorization>>();
		mocks.api.mockReturnValueOnce(pending.promise);
		const current = flow();
		const first = current.start();
		await current.start();
		expect(mocks.api).toHaveBeenCalledTimes(1);
		const signal = mocks.api.mock.calls[0][3] as AbortSignal;
		current.cancel();
		expect(signal.aborted).toBe(true);
		await current.start();
		pending.resolve(authorization());
		await first;
		expect(window.open).toHaveBeenCalledTimes(1);
		expect(current.state.value).toBe('waiting');
	});

	test('never overlaps checks and ignores an approval received after disposal', async () => {
		const pending = deferred<{ status: string; i?: string; id?: string }>();
		const current = flow();
		await current.start();
		mocks.api.mockReturnValueOnce(pending.promise);
		await vi.advanceTimersByTimeAsync(15_000);
		expect(mocks.api).toHaveBeenCalledTimes(2);
		const signal = mocks.api.mock.calls[1][3] as AbortSignal;
		current.dispose();
		expect(signal.aborted).toBe(true);
		pending.resolve({ status: 'approved', i: 'cs_late', id: 'camp-user' });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.login).not.toHaveBeenCalled();
		expect(mocks.api).toHaveBeenCalledTimes(2);
		await current.start();
		expect(mocks.api).toHaveBeenCalledTimes(2);
	});

	test('expires and aborts an outstanding check even if the server never responds', async () => {
		const pending = deferred<{ status: string; i?: string; id?: string }>();
		const current = flow();
		await current.start();
		mocks.api.mockReturnValueOnce(pending.promise);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(current.state.value).toBe('expired');
		expect((mocks.api.mock.calls[1][3] as AbortSignal).aborted).toBe(true);
		pending.resolve({ status: 'approved', i: 'cs_expired', id: 'camp-user' });
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.login).not.toHaveBeenCalled();
	});

	test.each(['denied', 'expired'])('stops polling when authorization is %s', async status => {
		const current = flow();
		await current.start();
		mocks.api.mockResolvedValueOnce({ status });
		await vi.advanceTimersByTimeAsync(1500);
		expect(current.state.value).toBe(status);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.api).toHaveBeenCalledTimes(2);
		expect(mocks.login).not.toHaveBeenCalled();
	});

	test.each([
		{ status: 'approved', i: 'web-token', id: 'camp-user' },
		{ status: 'approved', i: 'cs_missing-user' },
		{ status: 'unknown' },
	])('rejects incomplete or invalid authorization responses: %j', async result => {
		const current = flow();
		await current.start();
		mocks.api.mockResolvedValueOnce(result);
		await vi.advanceTimersByTimeAsync(1500);
		expect(current.state.value).toBe('failed');
		expect(mocks.login).not.toHaveBeenCalled();
	});

	test.each([
		'https://other.example/client-auth/' + requestId,
		'/client-auth/' + requestId,
		'http://localhost:3000/client-auth/' + requestId + '?secret=' + secret,
	])('does not launch an invalid browser target: %s', async authorizeUrl => {
		mocks.api.mockResolvedValueOnce({ ...authorization(), authorizeUrl });
		const current = flow();
		await current.start();
		expect(current.state.value).toBe('failed');
		expect(window.open).not.toHaveBeenCalled();
		expect(mocks.api).toHaveBeenCalledTimes(1);
	});

	test('network and account-loading failures leave a retryable state', async () => {
		const current = flow();
		mocks.api.mockRejectedValueOnce(new TypeError('offline'));
		await current.start();
		expect(current.state.value).toBe('failed');
		await current.start();
		mocks.api.mockResolvedValueOnce({ status: 'approved', i: 'cs_approved', id: 'camp-user' });
		mocks.login.mockRejectedValueOnce(new TypeError('offline'));
		await vi.advanceTimersByTimeAsync(1500);
		expect(current.state.value).toBe('failed');
	});

	test('ordinary web pages cannot launch the native browser authorization flow', async () => {
		delete document.documentElement.dataset.campDesktop;
		await flow().start();
		expect(mocks.api).not.toHaveBeenCalled();
		expect(window.open).not.toHaveBeenCalled();
	});
});
