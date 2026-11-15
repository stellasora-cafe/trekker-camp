/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, reactive } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { miLocalStorage } from '@/local-storage.js';
import { instanceName, version } from '@@/js/config.js';
import { isDesktopClient } from '@/utility/offline.js';

// TODO: 他のタブと永続化されたstateを同期

//#region loader
const providedMetaEl = window.document.getElementById('misskey_meta');

let cachedMeta = miLocalStorage.getItem('instance') ? JSON.parse(miLocalStorage.getItem('instance')!) : null;
let cachedAt = miLocalStorage.getItem('instanceCachedAt') ? parseInt(miLocalStorage.getItem('instanceCachedAt')!) : 0;
const providedMeta = providedMetaEl && providedMetaEl.textContent ? JSON.parse(providedMetaEl.textContent) : null;
const providedAt = providedMetaEl && providedMetaEl.dataset.generatedAt ? parseInt(providedMetaEl.dataset.generatedAt) : 0;
if (providedAt > cachedAt) {
	miLocalStorage.setItem('instance', JSON.stringify(providedMeta));
	miLocalStorage.setItem('instanceCachedAt', providedAt.toString());
	cachedMeta = providedMeta;
	cachedAt = providedAt;
}
//#endregion

// TODO: instanceをリアクティブにするかは再考の余地あり

export const instance: Misskey.entities.MetaDetailed = reactive({
	name: instanceName, description: null, version, iconUrl: '/favicon.ico',
	clientOptions: {}, ads: [], serverRules: [], languages: ['zh-CN'],
	features: {}, policies: { ltlAvailable: false, gtlAvailable: false, canSearchNotes: false, canSearchUsers: false },
	maxNoteTextLength: 3000, maxFileSize: 16 * 1024 * 1024, sentryForFrontend: null,
	...cachedMeta, federation: 'none',
});

export async function fetchInstance(force = false): Promise<Misskey.entities.MetaDetailed> {
	if (!force) {
		const cachedAt = miLocalStorage.getItem('instanceCachedAt') ? parseInt(miLocalStorage.getItem('instanceCachedAt')!) : 0;

		if (Date.now() - cachedAt < 1000 * 60 * 60) {
			return instance;
		}
	}

	let meta: Misskey.entities.MetaDetailed;
	try {
		meta = await misskeyApi('meta', { detail: true });
	} catch (error) {
		if (isDesktopClient()) return instance;
		throw error;
	}

	for (const [k, v] of Object.entries({ ...meta, federation: 'none' })) {
		(instance[k as keyof typeof meta] as any) = v;
	}

	miLocalStorage.setItem('instance', JSON.stringify(instance));
	miLocalStorage.setItem('instanceCachedAt', Date.now().toString());

	return instance;
}
