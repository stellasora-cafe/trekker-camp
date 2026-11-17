/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import ClientAuth from '@/pages/client-auth.vue';
import { i18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({
	loggedIn: true, api: vi.fn(), login: vi.fn(), accounts: vi.fn(), streamOn: vi.fn(), streamOff: vi.fn(),
	user: { id: 'camp-user', username: 'campdev', name: 'Camp developer', token: 'web-session' },
}));
vi.mock('@/i.js', () => ({ get $i() { return mocks.loggedIn ? mocks.user : null; } }));
vi.mock('@/instance.js', () => ({ instance: { name: '旅人营地', iconUrl: '/favicon.ico' } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/accounts.js', () => ({
	login: mocks.login, getAccounts: mocks.accounts,
	getAccountWithSigninDialog: vi.fn(), getAccountWithSignupDialog: vi.fn(),
}));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ on: mocks.streamOn, off: mocks.streamOff }) }));
vi.mock('@/os.js', () => ({ alert: vi.fn(), popupMenu: vi.fn() }));
vi.mock('@/utility/media-proxy.js', () => ({ getProxiedImageUrl: (value: string) => value }));
vi.mock('@/utility/show-suspended-dialog.js', () => ({ showSuspendedDialog: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: () => true }));
vi.mock('@/components/MkButton.vue', () => ({ default: {
	props: ['disabled', 'type'],
	template: '<button :disabled="disabled" :type="type || \'button\'"><slot /></button>',
} }));
vi.mock('@/components/MkSignin.input.vue', () => ({ default: {
	emits: ['usernameSubmitted'],
	template: '<button @click="$emit(\'usernameSubmitted\', \'campdev\')">sign in</button>',
} }));
vi.mock('@/components/MkSignin.password.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkSignin.totp.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkSignin.passkey.vue', () => ({ default: { template: '<div />' } }));

const requestId = '9fe36e54-f70e-4168-8077-39f0dd4057f4';
const expiresAt = '2026-11-15T04:00:00.000Z';
const request = { name: '旅人营地桌面客户端', platform: 'Windows', expiresAt };
const global = { stubs: {
	MkLoading: true,
	MkAvatar: true,
	MkUserName: { props: ['user'], template: '<span>{{ user.name }}</span>' },
	MkAcct: { props: ['user'], template: '<span>@{{ user.username }}</span>' },
	MkTime: { props: ['time'], template: '<time>{{ time }}</time>' },
} };

beforeEach(() => {
	vi.resetAllMocks();
	mocks.loggedIn = true;
	mocks.accounts.mockResolvedValue([{ ...mocks.user, host: 'localhost' }]);
	mocks.login.mockResolvedValue(undefined);
	mocks.api.mockImplementation((endpoint: string) => Promise.resolve(endpoint === 'client-auth/show' ? request : undefined));
});

afterEach(cleanup);

async function consent() {
	const view = render(ClientAuth, { props: { requestId }, global });
	await fireEvent.click(await view.findByRole('radio'));
	await fireEvent.click(view.getByRole('button', { name: i18n.ts.continue }));
	await view.findByRole('button', { name: i18n.ts.accept });
	return view;
}

describe('browser client authorization card', () => {
	test('guest sees the camp brand and the real sign in flow before authorizing', async () => {
		mocks.loggedIn = false;
		mocks.api.mockImplementation((endpoint: string) => Promise.resolve(endpoint === 'users/show' ? mocks.user : { finished: true, id: mocks.user.id, i: 'signed-in-session' }));
		const view = render(ClientAuth, { props: { requestId }, global });
		expect(view.getByRole('main')).toBeTruthy();
		expect(view.getByRole('heading', { name: i18n.ts._clientSessions.browserAuthorize })).toBeTruthy();
		expect(view.getByText('旅人营地')).toBeTruthy();
		expect(view.getByText(i18n.ts._clientSessions.authorizationSignIn)).toBeTruthy();
		expect(mocks.api).not.toHaveBeenCalled();
		await fireEvent.click(view.getByRole('button', { name: 'sign in' }));
		await waitFor(() => expect(mocks.login).toHaveBeenCalledExactlyOnceWith('signed-in-session'));
	});

	test('shows device details, keeps account selection, and confirms returning to the client after approval', async () => {
		const view = await consent();
		expect(view.getByText(request.name)).toBeTruthy();
		expect(view.getByText('Windows')).toBeTruthy();
		expect(view.getByText(expiresAt)).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.switchAccount }));
		await view.findByRole('radio');
		await fireEvent.click(view.getByRole('radio'));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.continue }));
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.accept }));
		expect(await view.findByText(i18n.ts._clientSessions.authorizationComplete)).toBeTruthy();
		expect(mocks.api).toHaveBeenLastCalledWith('client-auth/approve', { requestId, decision: 'allow' }, 'web-session', expect.any(AbortSignal));
		expect(view.queryByRole('button', { name: i18n.ts.accept })).toBeNull();
	});

	test('denial uses the selected account and explains how to restart from the client', async () => {
		const view = await consent();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.reject }));
		expect(await view.findByText(i18n.ts._clientSessions.authorizationDenied)).toBeTruthy();
		expect(mocks.api).toHaveBeenLastCalledWith('client-auth/approve', { requestId, decision: 'deny' }, 'web-session', expect.any(AbortSignal));
	});

	test('expired requests clearly return the user to the client without leaving actionable consent controls', async () => {
		mocks.api.mockRejectedValueOnce({ code: 'CLIENT_AUTHORIZATION_EXPIRED' });
		const view = render(ClientAuth, { props: { requestId }, global });
		expect(await view.findByText(i18n.ts._clientSessions.requestExpired)).toBeTruthy();
		expect(view.queryByRole('radio')).toBeNull();
		expect(view.queryByRole('button', { name: i18n.ts.accept })).toBeNull();
	});

	test('a request-loading failure has a working retry', async () => {
		mocks.api.mockRejectedValueOnce(new TypeError('offline'));
		const view = render(ClientAuth, { props: { requestId }, global });
		expect(await view.findByText(i18n.ts._clientSessions.authorizationFailed)).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		await view.findByRole('radio');
		expect(mocks.api.mock.calls.filter(([endpoint]) => endpoint === 'client-auth/show')).toHaveLength(2);
	});

	test('approval failure can be retried and handles a request already processed by the server', async () => {
		const view = await consent();
		mocks.api.mockRejectedValueOnce(new TypeError('connection lost'));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.accept }));
		await view.findByText(i18n.ts._clientSessions.authorizationFailed);
		mocks.api.mockRejectedValueOnce({ code: 'CLIENT_AUTHORIZATION_EXPIRED' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		expect(await view.findByText(i18n.ts._clientSessions.requestExpired)).toBeTruthy();
	});

	test('closing the page aborts loading and removes its reconnection listener', () => {
		mocks.api.mockReturnValueOnce(new Promise(() => {}));
		const view = render(ClientAuth, { props: { requestId }, global });
		const signal = mocks.api.mock.calls[0][3] as AbortSignal;
		const reconnect = mocks.streamOn.mock.calls[0][1];
		view.unmount();
		expect(signal.aborted).toBe(true);
		expect(mocks.streamOff).toHaveBeenCalledExactlyOnceWith('_reconnected_', reconnect);
	});
});
