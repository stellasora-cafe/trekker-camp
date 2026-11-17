/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import { cloudBackup } from '@/preferences/utility.js';
import { store } from '@/store.js';
import { waiting } from '@/os.js';
import { unisonReload } from '@/utility/unison-reload.js';
import { clear } from '@/utility/idb-proxy.js';
import { $i } from '@/i.js';
import { encodePushSubscriptionKey } from '@/utility/encode-push-subscription-key.js';
import { misskeyApi } from '@/utility/misskey-api.js';

let signingOut: Promise<void> | null = null;

export function signout(options: { revoked?: boolean } = {}) {
	return signingOut ??= performSignout(options);
}

async function performSignout(options: { revoked?: boolean }) {
	if (!$i) return;

	waiting();

	if (!options.revoked && store.s.enablePreferencesAutoCloudBackup) {
		await cloudBackup();
	}
	if (!options.revoked && $i.token.startsWith('cs_')) {
		try {
			const sessions = await misskeyApi('i/client-sessions');
			const current = sessions.find(session => session.isCurrent);
			if (current) await misskeyApi('i/revoke-client-session', { sessionId: current.id });
		} catch { /* Local signout is still available while offline. */ }
	}

	localStorage.clear();

	const idbAbortController = new AbortController();
	const timeout = window.setTimeout(() => idbAbortController.abort(), 5000);

	const idbPromises = ['MisskeyClient'].map((name, i, arr) => new Promise<void>((res, rej) => {
		const delidb = indexedDB.deleteDatabase(name);
		delidb.onsuccess = () => res();
		delidb.onerror = e => rej(e);
		delidb.onblocked = () => idbAbortController.signal.aborted && rej(new Error('Operation aborted'));
	}));

	try {
		await Promise.race([
			Promise.all([
				...idbPromises,
				// idb keyval-storeはidb-keyvalライブラリによる別管理
				clear(),
			]),
			new Promise((_, rej) => idbAbortController.signal.addEventListener('abort', () => rej(new Error('Operation timed out')))),
		]);
	} catch {
		// nothing
	} finally {
		window.clearTimeout(timeout);
	}

	//#region Remove service worker registration
	try {
		if (navigator.serviceWorker.controller) {
			const registration = await navigator.serviceWorker.ready;
			const push = await registration.pushManager.getSubscription();
			if (push) {
				// Service Workerごと登録解除するので、この購読に紐づく全アカウントの登録を解除する
				await window.fetch(`${apiUrl}/sw/unregister`, {
					method: 'POST',
					body: JSON.stringify({
						endpoint: push.endpoint,
						auth: encodePushSubscriptionKey(push.getKey('auth')),
						publickey: encodePushSubscriptionKey(push.getKey('p256dh')),
					}),
					headers: {
						'Content-Type': 'application/json',
					'X-Camp-Client': 'web-v1',
					},
				});
			}
		}

		await navigator.serviceWorker.getRegistrations()
			.then(registrations => {
				return Promise.all(registrations.map(registration => registration.unregister()));
			});
	} catch {
		// nothing
	}
	//#endregion

	unisonReload('/');
}
