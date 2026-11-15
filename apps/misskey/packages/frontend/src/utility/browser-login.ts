/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readonly, ref } from 'vue';
import { login } from '@/accounts.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { desktopWindowMode } from '@/utility/desktop-window.js';

type LoginState = 'idle' | 'starting' | 'waiting' | 'signingIn' | 'denied' | 'expired' | 'failed';
type Authorization = { requestId: string; secret: string; authorizeUrl: string; expiresAt: string };
type AuthorizationResult = { status: 'pending' | 'approved' | 'denied' | 'expired'; i?: string; id?: string };
type Attempt = {
	controller: AbortController;
	authorization?: Authorization;
	poll?: number;
	deadline?: number;
};

/** An authorization secret lives only in this window until completion or cancellation. */
export function createBrowserLogin() {
	const state = ref<LoginState>('idle');
	let attempt: Attempt | undefined;
	let disposed = false;

	function clear() {
		if (!attempt) return;
		attempt.controller.abort();
		window.clearTimeout(attempt.poll);
		window.clearTimeout(attempt.deadline);
		attempt.authorization = undefined;
		attempt = undefined;
	}

	function finish(current: Attempt, next: LoginState) {
		if (attempt !== current) return;
		clear();
		state.value = next;
	}

	function cancel() {
		clear();
		state.value = 'idle';
	}

	function reopen() {
		const current = attempt;
		if (!current?.authorization || state.value !== 'waiting') return;
		if (Date.parse(current.authorization.expiresAt) <= Date.now()) {
			finish(current, 'expired');
			return;
		}
		// The native host consumes this named target. Its null return is expected.
		window.open(current.authorization.authorizeUrl, 'camp-desktop-browser-auth');
	}

	async function poll(current: Attempt) {
		if (attempt !== current || !current.authorization) return;
		try {
			const { requestId, secret } = current.authorization;
			const result = await misskeyApi<AuthorizationResult>('client-auth/check', { requestId, secret }, null, current.controller.signal);
			if (attempt !== current) return;
			if (Date.parse(current.authorization!.expiresAt) <= Date.now()) {
				finish(current, 'expired');
			} else if (result.status === 'pending') {
				current.poll = window.setTimeout(() => { void poll(current); }, 1500);
			} else if (result.status === 'approved') {
				if (!result.i?.startsWith('cs_') || !result.id) throw new Error('Invalid client session');
				window.clearTimeout(current.deadline);
				current.authorization = undefined;
				state.value = 'signingIn';
				await login(result.i);
				if (attempt === current) clear();
			} else if (result.status === 'denied' || result.status === 'expired') {
				finish(current, result.status);
			} else {
				finish(current, 'failed');
			}
		} catch {
			finish(current, 'failed');
		}
	}

	async function start() {
		if (disposed || attempt || desktopWindowMode() === 'browser') return;
		const current: Attempt = { controller: new AbortController() };
		attempt = current;
		state.value = 'starting';
		try {
			const authorization = await misskeyApi<Authorization>('client-auth/start', {
				name: i18n.ts._clientSessions.desktop,
				platform: navigator.platform.slice(0, 64),
			}, null, current.controller.signal);
			if (attempt !== current) return;
			const target = new URL(authorization.authorizeUrl);
			const remaining = Date.parse(authorization.expiresAt) - Date.now();
			if (
				!/^[0-9a-f-]{36}$/.test(authorization.requestId) || !/^[A-Za-z0-9_-]{43}$/.test(authorization.secret) ||
				target.origin !== window.location.origin || target.pathname !== '/client-auth/' + authorization.requestId ||
				target.username || target.password || target.search || target.hash || !Number.isFinite(remaining)
			) throw new Error('Invalid browser authorization');
			if (remaining <= 0) {
				finish(current, 'expired');
				return;
			}
			current.authorization = authorization;
			current.deadline = window.setTimeout(() => { finish(current, 'expired'); }, remaining);
			state.value = 'waiting';
			reopen();
			current.poll = window.setTimeout(() => { void poll(current); }, 1500);
		} catch {
			finish(current, 'failed');
		}
	}

	function dispose() {
		disposed = true;
		cancel();
	}

	return { state: readonly(state), start, reopen, cancel, dispose };
}
