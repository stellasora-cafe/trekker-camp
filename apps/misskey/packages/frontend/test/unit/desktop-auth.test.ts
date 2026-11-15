/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import DesktopAuth from '@/pages/desktop-auth.vue';
import { ROUTE_DEF } from '@/router.definition.js';
import { i18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({ api: vi.fn(), login: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/accounts.js', () => ({ login: mocks.login }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/os.js', () => ({ alert: vi.fn() }));
vi.mock('@/utility/show-suspended-dialog.js', () => ({ showSuspendedDialog: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: () => true }));
vi.mock('@/i.js', () => ({ $i: null, iAmModerator: false }));
vi.mock('@/pages/timeline.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/_loading_.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/_error_.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkSignupDialog.form.vue', () => ({ default: {
	props: { autoSet: Boolean },
	template: '<form data-testid="signup-form" :data-auto-set="autoSet" />',
} }));
vi.mock('@/components/MkSignupDialog.rules.vue', () => ({ default: {
	emits: ['done', 'cancel'],
	template: '<div><button @click="$emit(\'done\')">accept rules</button><button @click="$emit(\'cancel\')">cancel rules</button></div>',
} }));
vi.mock('@/components/MkSignin.input.vue', () => ({ default: {
	props: ['initialUsername'],
	emits: ['usernameSubmitted'],
	template: '<button @click="$emit(\'usernameSubmitted\', initialUsername || \'campdev\')">continue {{ initialUsername }}</button>',
} }));
vi.mock('@/components/MkSignin.password.vue', () => ({ default: {
	props: ['needCaptcha'],
	emits: ['passwordSubmitted'],
	methods: { resetCaptcha: vi.fn() },
	template: '<button :data-captcha="needCaptcha" @click="$emit(\'passwordSubmitted\', { password: \'test-password\', captcha: { turnstileResponse: \'test-proof\' } })">password</button>',
} }));
vi.mock('@/components/MkSignin.totp.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkSignin.passkey.vue', () => ({ default: {
	props: ['credentialRequest'],
	emits: ['done'],
	template: '<button @click="$emit(\'done\', { id: credentialRequest.challenge })">passkey</button>',
} }));

const global = { stubs: { MkLoading: true } };

beforeEach(() => {
	vi.clearAllMocks();
	delete document.documentElement.dataset.campDesktop;
	mocks.login.mockResolvedValue(undefined);
	mocks.api.mockImplementation((endpoint: string) => Promise.resolve(endpoint === 'users/show'
		? { id: 'user-id', username: 'campdev' }
		: { finished: true, id: 'user-id', i: 'test-session' }));
});

afterEach(() => {
	cleanup();
	delete document.documentElement.dataset.campDesktop;
	vi.restoreAllMocks();
});

describe('desktop authentication window', () => {
	test('route accepts only mode and a username hint without requiring an existing session', () => {
		const route = ROUTE_DEF.find(route => route.path === '/desktop-auth');
		expect(route).toMatchObject({ query: { mode: 'mode', username: 'username' } });
		expect(route?.loginRequired).not.toBe(true);
	});

	test.each([undefined, 'signin', 'unknown'])('sign in mode %s persists the completed session through the normal login flow', async mode => {
		const view = render(DesktopAuth, { props: { mode, username: 'campdev' }, global });
		expect(view.getByRole('heading', { name: i18n.ts.login })).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: 'continue campdev' }));
		await waitFor(() => expect(mocks.login).toHaveBeenCalledExactlyOnceWith('test-session'));
	});

	test('captcha challenge continues through the existing sign in component', async () => {
		mocks.api.mockResolvedValueOnce({ id: 'user-id', username: 'campdev' })
			.mockResolvedValueOnce({ finished: false, next: 'captcha' })
			.mockResolvedValueOnce({ finished: true, id: 'user-id', i: 'captcha-session' });
		const view = render(DesktopAuth, { global });
		await fireEvent.click(view.getByRole('button', { name: 'continue' }));
		const password = await view.findByRole('button', { name: 'password' });
		expect(password.getAttribute('data-captcha')).toBe('true');
		await fireEvent.click(password);
		await waitFor(() => expect(mocks.login).toHaveBeenCalledExactlyOnceWith('captcha-session'));
		expect(mocks.api).toHaveBeenLastCalledWith('signin-flow', expect.objectContaining({
			username: 'campdev', password: 'test-password', 'turnstile-response': 'test-proof',
		}), undefined, expect.any(AbortSignal));
	});

	test('passkey challenge completes using the same persistent login flow', async () => {
		mocks.api.mockResolvedValueOnce({ id: 'user-id', username: 'campdev' })
			.mockResolvedValueOnce({ finished: false, next: 'passkey', authRequest: { challenge: 'test-credential' } })
			.mockResolvedValueOnce({ finished: true, id: 'user-id', i: 'passkey-session' });
		const view = render(DesktopAuth, { global });
		await fireEvent.click(view.getByRole('button', { name: 'continue' }));
		await fireEvent.click(await view.findByRole('button', { name: 'passkey' }));
		await waitFor(() => expect(mocks.login).toHaveBeenCalledExactlyOnceWith('passkey-session'));
		expect(mocks.api).toHaveBeenLastCalledWith('signin-flow', expect.objectContaining({ credential: { id: 'test-credential' } }), undefined, expect.any(AbortSignal));
	});

	test('registration requires rule acceptance and enables automatic login on the shared signup form', async () => {
		const view = render(DesktopAuth, { props: { mode: 'signup' }, global });
		expect(view.queryByTestId('signup-form')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'accept rules' }));
		expect(view.getByTestId('signup-form').getAttribute('data-auto-set')).toBe('true');
		await view.rerender({ mode: 'signin' });
		await view.rerender({ mode: 'signup' });
		expect(view.queryByTestId('signup-form')).toBeNull();
	});

	test('cancelling registration closes the independent window', async () => {
		const close = vi.spyOn(window, 'close').mockImplementation(() => {});
		const view = render(DesktopAuth, { props: { mode: 'signup' }, global });
		await fireEvent.click(view.getByRole('button', { name: 'cancel rules' }));
		expect(close).toHaveBeenCalledOnce();
	});

	test('browser login entry is desktop-only and cancellation restores the sign in form', async () => {
		const browser = render(DesktopAuth, { global });
		expect(browser.queryByRole('button', { name: i18n.ts._desktop.browserLogin })).toBeNull();
		browser.unmount();
		document.documentElement.dataset.campDesktop = 'true';
		const requestId = '9fe36e54-f70e-4168-8077-39f0dd4057f4';
		mocks.api.mockResolvedValueOnce({
			requestId, secret: 's'.repeat(43),
			authorizeUrl: window.location.origin + '/client-auth/' + requestId,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		});
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const view = render(DesktopAuth, { global });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts._desktop.browserLogin }));
		expect(await view.findByText(i18n.ts._desktop.browserLoginWaiting)).toBeTruthy();
		expect(view.queryByRole('button', { name: 'continue' })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts._desktop.browserLoginReopen }));
		expect(open).toHaveBeenCalledTimes(2);
		const signal = mocks.api.mock.calls[0][3] as AbortSignal;
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.cancel }));
		expect(signal.aborted).toBe(true);
		expect(view.getByRole('button', { name: 'continue' })).toBeTruthy();
	});

	test('unmounting the authorization page aborts its outstanding browser login request', async () => {
		document.documentElement.dataset.campDesktop = 'true';
		mocks.api.mockReturnValueOnce(new Promise(() => {}));
		const view = render(DesktopAuth, { global });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts._desktop.browserLogin }));
		const signal = mocks.api.mock.calls[0][3] as AbortSignal;
		view.unmount();
		expect(signal.aborted).toBe(true);
	});
});
