/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import MkSignin from '@/components/MkSignin.vue';
import { i18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({
	api: vi.fn(), login: vi.fn(), authenticate: vi.fn(), cancel: vi.fn(), supports: vi.fn(), alert: vi.fn(),
}));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/accounts.js', () => ({ login: mocks.login }));
vi.mock('@/os.js', () => ({ alert: mocks.alert }));
vi.mock('@/utility/show-suspended-dialog.js', () => ({ showSuspendedDialog: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({
	browserSupportsWebAuthn: mocks.supports,
	startAuthentication: mocks.authenticate,
	WebAuthnAbortService: { cancelCeremony: mocks.cancel },
}));
vi.mock('@/components/MkSignin.input.vue', () => ({ default: {
	emits: ['usernameSubmitted'],
	template: '<button @click="$emit(\'usernameSubmitted\', \'campdev\')">username</button>',
} }));
vi.mock('@/components/MkSignin.password.vue', () => ({ default: {
	emits: ['passwordSubmitted'],
	methods: { resetCaptcha: vi.fn() },
	template: '<button @click="$emit(\'passwordSubmitted\', { password: \'test-password\', captcha: {} })">password</button>',
} }));
vi.mock('@/components/MkButton.vue', () => ({ default: {
	props: ['disabled', 'type'],
	template: '<button :disabled="disabled" :type="type || \'button\'"><slot /></button>',
} }));
vi.mock('@/components/MkInput.vue', () => ({ default: {
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<label><slot name="label" /><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="caption" /></label>',
} }));

beforeEach(() => {
	delete document.documentElement.dataset.campDesktop;
	vi.resetAllMocks();
	mocks.supports.mockReturnValue(true);
	mocks.login.mockResolvedValue(undefined);
	mocks.alert.mockResolvedValue(undefined);
	let challenge = 0;
	mocks.api.mockImplementation((endpoint: string, request: Record<string, unknown>) => {
		if (endpoint === 'users/show') return Promise.resolve({ id: 'user-id', username: 'campdev' });
		if (request.password == null) return Promise.resolve({ finished: false, next: 'password' });
		if (request.credential || request.token) return Promise.resolve({ finished: true, id: 'user-id', i: 'test-session' });
		return Promise.resolve({ finished: false, next: 'passkey', authRequest: { challenge: `challenge-${++challenge}`, rpId: 'localhost' } });
	});
});

afterEach(() => {
	cleanup();
	delete document.documentElement.dataset.campDesktop;
});

test('manual application update is visible only in desktop sign in', () => {
	const browser = render(MkSignin, { global: { stubs: { MkLoading: true } } });
	expect(browser.queryByRole('button', { name: i18n.ts._desktop.checkUpdates })).toBeNull();
	browser.unmount();
	document.documentElement.dataset.campDesktop = 'true';
	const desktop = render(MkSignin, { global: { stubs: { MkLoading: true } } });
	expect(desktop.getByRole('button', { name: i18n.ts._desktop.checkUpdates })).toBeTruthy();
});

async function startSignin() {
	const view = render(MkSignin, { props: { autoSet: true }, global: { stubs: { MkLoading: true } } });
	await fireEvent.click(view.getByRole('button', { name: 'username' }));
	await fireEvent.click(await view.findByRole('button', { name: 'password' }));
	await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledOnce());
	return view;
}

describe('sign in with a registered passkey as the second factor', () => {
	test('submits the assertion with the password and persists the completed session', async () => {
		mocks.authenticate.mockResolvedValue({ id: 'registered-passkey' });
		await startSignin();
		await waitFor(() => expect(mocks.login).toHaveBeenCalledExactlyOnceWith('test-session'));
		expect(mocks.api).toHaveBeenLastCalledWith('signin-flow', {
			username: 'campdev', password: 'test-password', credential: { id: 'registered-passkey' },
		}, undefined, expect.any(AbortSignal));
	});

	test('cancelling the device prompt leaves retry available and fetches a fresh challenge', async () => {
		mocks.authenticate.mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'))
			.mockResolvedValueOnce({ id: 'registered-passkey' });
		const view = await startSignin();
		expect(view.queryByRole('status')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		await waitFor(() => expect(mocks.authenticate).toHaveBeenCalledTimes(2));
		expect(mocks.authenticate.mock.calls.map(([request]) => request.optionsJSON.challenge)).toEqual(['challenge-1', 'challenge-2']);
		await waitFor(() => expect(mocks.login).toHaveBeenCalledOnce());
	});

	test('switches to TOTP during a device prompt, ignores its late result, and returns to a fresh passkey prompt', async () => {
		let completeFirst!: (value: unknown) => void;
		mocks.authenticate.mockImplementationOnce(() => new Promise(resolve => { completeFirst = resolve; }))
			.mockResolvedValueOnce({ id: 'new-assertion' });
		const view = await startSignin();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.useTotp }));
		expect(mocks.cancel).toHaveBeenCalledOnce();
		const passkeyButton = await view.findByRole('button', { name: i18n.ts.signinWithPasskey });
		completeFirst({ id: 'late-assertion' });
		await Promise.resolve();
		expect(mocks.login).not.toHaveBeenCalled();
		await fireEvent.click(passkeyButton);
		await waitFor(() => expect(mocks.login).toHaveBeenCalledOnce());
		expect(mocks.authenticate.mock.calls[1][0].optionsJSON.challenge).toBe('challenge-2');
		expect(mocks.api).toHaveBeenLastCalledWith('signin-flow', expect.objectContaining({ credential: { id: 'new-assertion' } }), undefined, expect.any(AbortSignal));
	});

	test('aborts an active device prompt when the sign in window closes', async () => {
		mocks.authenticate.mockImplementation(() => new Promise(() => {}));
		const view = await startSignin();
		view.unmount();
		expect(mocks.cancel).toHaveBeenCalledOnce();
	});

	test('aborts a pending sign in request and ignores its successful response after unmount', async () => {
		let completeSignin!: (value: unknown) => void;
		mocks.api.mockResolvedValueOnce({ id: 'user-id', username: 'campdev' })
			.mockImplementationOnce(() => new Promise(resolve => { completeSignin = resolve; }));
		const view = render(MkSignin, { props: { autoSet: true }, global: { stubs: { MkLoading: true } } });
		await fireEvent.click(view.getByRole('button', { name: 'username' }));
		await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
		const signal = mocks.api.mock.calls[1][3] as AbortSignal;
		expect(signal.aborted).toBe(false);
		view.unmount();
		expect(signal.aborted).toBe(true);
		completeSignin({ finished: true, id: 'user-id', i: 'late-session' });
		await Promise.resolve();
		await Promise.resolve();
		expect(mocks.login).not.toHaveBeenCalled();
		expect(view.emitted('login')).toBeUndefined();
		expect(mocks.alert).not.toHaveBeenCalled();
	});

	test('does not begin sign in when the user lookup completes after unmount', async () => {
		let completeLookup!: (value: unknown) => void;
		mocks.api.mockImplementationOnce(() => new Promise(resolve => { completeLookup = resolve; }));
		const view = render(MkSignin, { props: { autoSet: true }, global: { stubs: { MkLoading: true } } });
		await fireEvent.click(view.getByRole('button', { name: 'username' }));
		const signal = mocks.api.mock.calls[0][3] as AbortSignal;
		view.unmount();
		expect(signal.aborted).toBe(true);
		completeLookup({ id: 'user-id', username: 'campdev' });
		await Promise.resolve();
		await Promise.resolve();
		expect(mocks.api).toHaveBeenCalledOnce();
		expect(mocks.login).not.toHaveBeenCalled();
		expect(view.emitted('login')).toBeUndefined();
	});

	test('keeps retry available after the server consumes and rejects an assertion', async () => {
		mocks.authenticate.mockResolvedValue({ id: 'registered-passkey' });
		const api = mocks.api.getMockImplementation()!;
		let rejectAssertion = true;
		mocks.api.mockImplementation((endpoint: string, request: Record<string, unknown>) => {
			if (request.credential && rejectAssertion) {
				rejectAssertion = false;
				return Promise.reject({ id: '93b86c4b-72f9-40eb-9815-798928603d1e' });
			}
			return api(endpoint, request);
		});
		const view = await startSignin();
		await waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		await waitFor(() => expect(mocks.login).toHaveBeenCalledOnce());
		expect(mocks.authenticate.mock.calls[1][0].optionsJSON.challenge).toBe('challenge-2');
	});

	test('shows a recoverable status for a device error', async () => {
		mocks.authenticate.mockRejectedValue(new DOMException('Authenticator failed', 'UnknownError'));
		const view = await startSignin();
		expect((await view.findByRole('status')).textContent).toBe(i18n.ts.passkeyVerificationFailed);
		expect(view.getByRole('button', { name: i18n.ts.retry }).hasAttribute('disabled')).toBe(false);
	});

	test('uses TOTP when the browser has no WebAuthn support', async () => {
		mocks.supports.mockReturnValue(false);
		const view = render(MkSignin, { global: { stubs: { MkLoading: true } } });
		await fireEvent.click(view.getByRole('button', { name: 'username' }));
		await fireEvent.click(await view.findByRole('button', { name: 'password' }));
		await view.findByRole('button', { name: i18n.ts.continue });
		expect(view.queryByRole('button', { name: i18n.ts.signinWithPasskey })).toBeNull();
		expect(mocks.authenticate).not.toHaveBeenCalled();
	});
});
