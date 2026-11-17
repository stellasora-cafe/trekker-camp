/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// FirefoxのプライベートモードなどではindexedDBが使用不可能なので、
// indexedDBが使えない環境ではlocalStorageを使う
import {
	get as iget,
	set as iset,
	del as idel,
	clear as iclear,
} from 'idb-keyval';
import { miLocalStorage } from '@/local-storage.js';
import { desktopCredentialCodec } from '@/utility/desktop-credential-storage.js';

const PREFIX = 'idbfallback::';

let idbAvailable = typeof window !== 'undefined' ? !!(window.indexedDB && typeof window.indexedDB.open === 'function') : true;

if (idbAvailable) {
	await iset('idb-test', 'test')
		.catch(err => {
			console.error('idb error', err);
			console.error('indexedDB is unavailable. It will use localStorage.');
			idbAvailable = false;
		});
} else {
	console.error('indexedDB is unavailable. It will use localStorage.');
}

export async function get(key: string) {
	if (idbAvailable) {
		const value = await iget(key);
		const codec = desktopCredentialCodec(key);
		if (!codec || value === undefined) return value;
		if (codec.isSealed(value)) return JSON.parse(codec.open(value));
		// Persist the protected copy before exposing a legacy login to callers.
		await iset(key, codec.seal(JSON.stringify(value)));
		return value;
	}
	return miLocalStorage.getItemAsJson(`${PREFIX}${key}`);
}

export async function set(key: string, val: any) {
	if (idbAvailable) {
		const codec = desktopCredentialCodec(key);
		return iset(key, codec ? codec.seal(JSON.stringify(val)) : val);
	}
	return miLocalStorage.setItemAsJson(`${PREFIX}${key}`, val);
}

export async function del(key: string) {
	if (idbAvailable) return idel(key);
	return miLocalStorage.removeItem(`${PREFIX}${key}`);
}

export async function clear() {
	if (idbAvailable) return iclear();
}
