/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';
import * as Misskey from 'misskey-js';
import { miLocalStorage } from '@/local-storage.js';
import { apiUrl } from '@@/js/config.js';
import { restoreClientSession } from '@/utility/restore-client-session.js';
import { offlineContentCache } from '@/utility/offline-cache.js';

// TODO: 他のタブと永続化されたstateを同期

type AccountWithToken = Misskey.entities.MeDetailed & { token: string };

const accountData = miLocalStorage.getItem('account');
const restoredSession = await restoreClientSession<AccountWithToken>(accountData ? JSON.parse(accountData) : null, (...args) => window.fetch(...args), apiUrl);
export const discardedSessionAccountId = restoredSession.discardedAccountId;
export const upgradedClientSession = restoredSession.upgraded;
if (discardedSessionAccountId != null) {
	miLocalStorage.removeItem('account');
	await offlineContentCache.clear(window.location.origin, discardedSessionAccountId);
} else if (restoredSession.upgraded) miLocalStorage.setItem('account', JSON.stringify(restoredSession.account));

// TODO: 外部からはreadonlyに
export const $i = restoredSession.account ? reactive(restoredSession.account) : null;

export const iAmModerator = $i != null && ($i.isAdmin === true || $i.isModerator === true);
export const iAmAdmin = $i != null && $i.isAdmin;

export function ensureSignin() {
	if ($i == null) throw new Error('signin required');
	return $i;
}

export let notesCount = $i == null ? 0 : $i.notesCount;
export function incNotesCount() {
	notesCount++;
}

if (_DEV_) {
	(window as any).$i = $i;
}
