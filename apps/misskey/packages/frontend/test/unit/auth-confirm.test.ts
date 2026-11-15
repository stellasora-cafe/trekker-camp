/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { host } from '@@/js/config.js';
import MkAuthConfirm from '@/components/MkAuthConfirm.vue';
import { i18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({
	api: vi.fn(), accounts: vi.fn(), loggedIn: true,
	user: { id: 'current', username: 'current', name: 'Current account', token: 'current-session' },
}));
vi.mock('@/i.js', () => ({ get $i() { return mocks.loggedIn ? mocks.user : null; } }));
vi.mock('@/accounts.js', () => ({
	getAccounts: mocks.accounts,
	getAccountWithSigninDialog: vi.fn(), getAccountWithSignupDialog: vi.fn(),
}));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn(), success: vi.fn() }));
vi.mock('@/utility/media-proxy.js', () => ({ getProxiedImageUrl: (value: string) => value }));
vi.mock('@/components/MkButton.vue', () => ({ default: {
	props: ['disabled'],
	template: '<button :disabled="disabled"><slot /></button>',
} }));

const global = { stubs: {
	MkLoading: true, MkAvatar: true,
	MkUserName: { props: ['user'], template: '<span>{{ user.name }}</span>' },
	MkAcct: { props: ['user'], template: '<span>@{{ user.username }}</span>' },
} };

beforeEach(() => {
	vi.resetAllMocks();
	mocks.loggedIn = true;
	mocks.accounts.mockResolvedValue([]);
	mocks.api.mockImplementation((_endpoint: string, request: { userId: string }) => Promise.resolve({
		id: request.userId, username: request.userId, name: request.userId,
	}));
});

afterEach(cleanup);

describe('authorization account selection', () => {
	test('loads only saved accounts on this host with a token and skips an unavailable account independently', async () => {
		mocks.accounts.mockResolvedValue([
			{ ...mocks.user, host },
			{ id: 'other-host', host: 'other.example', token: 'other-session' },
			{ id: 'no-token', host, token: null },
			{ id: 'deleted', host, token: 'deleted-session' },
			{ id: 'available', host, token: 'available-session' },
		]);
		mocks.api.mockRejectedValueOnce({ code: 'NO_SUCH_USER' });
		const view = render(MkAuthConfirm, { global });
		await view.findByRole('radio', { name: /available/ });
		expect(view.getAllByRole('radio')).toHaveLength(2);
		expect(mocks.api).toHaveBeenCalledTimes(2);
		expect(mocks.api).toHaveBeenCalledWith('users/show', { userId: 'deleted' }, 'deleted-session');
		expect(mocks.api).toHaveBeenCalledWith('users/show', { userId: 'available' }, 'available-session');
		expect(view.queryByRole('status')).toBeNull();
		expect(view.container.querySelector('[inert]')).toBeNull();
		expect(view.emitted('accept')).toBeUndefined();
		await fireEvent.click(view.getByRole('radio', { name: /Current account/ }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.continue }));
		expect(view.emitted('accept')).toBeUndefined();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.accept }));
		expect(view.emitted('accept')).toEqual([['current-session']]);
	});

	test('keeps the current account usable while an additional account is still loading', async () => {
		mocks.accounts.mockResolvedValue([{ id: 'slow', host, token: 'slow-session' }]);
		mocks.api.mockReturnValue(new Promise(() => {}));
		const view = render(MkAuthConfirm, { global });
		await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
		expect(view.container.querySelector('[inert]')).toBeNull();
		await fireEvent.click(view.getByRole('radio', { name: /Current account/ }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.continue }));
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.reject }));
		expect(view.emitted('deny')).toEqual([['current-session']]);
		expect(view.emitted('accept')).toBeUndefined();
	});

	test('offers a retry for network failures without blocking the current account', async () => {
		mocks.accounts.mockResolvedValue([{ id: 'recovered', host, token: 'recovered-session' }]);
		mocks.api.mockRejectedValueOnce(new TypeError('Network unavailable'));
		const view = render(MkAuthConfirm, { global });
		await view.findByText(i18n.ts.failedToFetchAccountInformation);
		expect(view.getByRole('radio', { name: /Current account/ })).toBeTruthy();
		const retry = view.getByRole('button', { name: i18n.ts.retry });
		await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
		await fireEvent.click(retry);
		await view.findByRole('radio', { name: /recovered/ });
		expect(view.queryByRole('status')).toBeNull();
		expect(view.getAllByRole('radio')).toHaveLength(2);
	});

	test('recovers from a failed saved-account lookup', async () => {
		mocks.accounts.mockRejectedValueOnce(new Error('Storage unavailable'));
		const view = render(MkAuthConfirm, { global });
		await view.findByText(i18n.ts.failedToFetchAccountInformation);
		expect(view.container.querySelector('[inert]')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		await waitFor(() => expect(view.queryByRole('status')).toBeNull());
		expect(mocks.accounts).toHaveBeenCalledTimes(2);
	});

	test.each(['AUTHENTICATION_FAILED', 'USER_IS_DELETED', 'YOUR_ACCOUNT_SUSPENDED', 'INVALID_PARAM'])('skips an unusable saved account: %s', async code => {
		mocks.accounts.mockResolvedValue([{ id: 'old-fixture', host, token: 'old-session' }]);
		mocks.api.mockRejectedValueOnce({ code });
		const view = render(MkAuthConfirm, { global });
		await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
		expect(view.getAllByRole('radio')).toHaveLength(1);
		expect(view.queryByRole('status')).toBeNull();
		expect(view.container.querySelector('[inert]')).toBeNull();
	});

	test('requires explicit account selection and consent before using a saved account token', async () => {
		mocks.loggedIn = false;
		mocks.accounts.mockResolvedValue([{ id: 'saved', host, token: 'saved-session' }]);
		const view = render(MkAuthConfirm, { global });
		await fireEvent.click(await view.findByRole('radio', { name: /saved/ }));
		expect(view.emitted('accept')).toBeUndefined();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.continue }));
		expect(view.emitted('accept')).toBeUndefined();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.accept }));
		expect(view.emitted('accept')).toEqual([['saved-session']]);
	});
});
