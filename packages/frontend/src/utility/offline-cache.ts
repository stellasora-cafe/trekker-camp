/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as storage from '@/utility/idb-proxy.js';

const readEndpoints = new Set([
	'meta', 'emojis', 'emoji', 'stats', 'announcements', 'announcements/show',
	'notes/timeline', 'notes/local-timeline', 'notes/hybrid-timeline', 'notes/global-timeline',
	'notes/user-list-timeline', 'notes/mentions', 'notes/featured', 'notes/search', 'notes/show',
	'notes/children', 'notes/conversation', 'notes/replies', 'notes/renotes', 'notes/reactions',
	'users/show', 'users/notes', 'users/followers', 'users/following', 'users/search',
	'users/lists/list', 'users/lists/show', 'antennas/list', 'antennas/show', 'antennas/notes',
	'channels/timeline', 'channels/show', 'channels/featured', 'channels/followed', 'channels/owned',
	'channels/my-favorites', 'clips/list', 'clips/show', 'clips/notes', 'clips/my-favorites',
	'gallery/featured', 'gallery/popular', 'gallery/posts', 'gallery/posts/show',
	'pages/show', 'pages/featured', 'flash/show', 'flash/featured', 'flash/my', 'flash/my-likes',
	'i/favorites', 'i/gallery/posts', 'i/gallery/likes', 'i/pages', 'i/page-likes',
	'drive/files', 'drive/files/show', 'drive/folders', 'drive/folders/show',
]);

type CacheIndex = { key: string; bytes: number }[];
type CacheRecord = { savedAt: number; body: unknown };
type Storage = Pick<typeof storage, 'get' | 'set' | 'del'>;
const maxEntries = 160;
const maxBytes = 16 * 1024 * 1024;
const maxRecordBytes = 1024 * 1024;

function normalized(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalized);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, item]) => !/^(?:i|token|accessToken|refreshToken|password|secret|privateKey)$/i.test(key) && item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
	return value;
}

function stripCredentials(_key: string, value: unknown): unknown {
	return /^(?:i|token|accessToken|refreshToken|password|secret|privateKey)$/i.test(_key) ? undefined : value;
}

export class OfflineContentCache {
	private pending: Promise<unknown> = Promise.resolve();
	constructor(private readonly store: Storage = storage) {}

	private scope(origin: string, accountId: string | null): string {
		return `camp-offline-v1:${JSON.stringify([origin, accountId])}`;
	}

	private key(endpoint: string, params: unknown): string {
		return JSON.stringify([endpoint, normalized(params)]);
	}

	public accepts(endpoint: string): boolean {
		return readEndpoints.has(endpoint);
	}

	public async read(origin: string, accountId: string | null, endpoint: string, params: unknown): Promise<CacheRecord | undefined> {
		if (!this.accepts(endpoint)) return;
		await this.pending;
		try {
			return await this.store.get(this.scope(origin, accountId) + ':' + this.key(endpoint, params)) ?? undefined;
		} catch { return undefined; }
	}

	public write(origin: string, accountId: string | null, endpoint: string, params: unknown, body: unknown): Promise<void> {
		if (!this.accepts(endpoint)) return Promise.resolve();
		const json = JSON.stringify(body, stripCredentials);
		if (!json || json.length * 2 > maxRecordBytes) return Promise.resolve();
		const scope = this.scope(origin, accountId);
		const key = scope + ':' + this.key(endpoint, params);
		const job = async () => {
			const index: CacheIndex = ((await this.store.get(scope)) ?? []).filter((entry: CacheIndex[number]) => entry.key !== key);
			await this.store.set(key, { savedAt: Date.now(), body: JSON.parse(json) });
			index.push({ key, bytes: json.length * 2 });
			let bytes = index.reduce((total, entry) => total + entry.bytes, 0);
			while (index.length > maxEntries || bytes > maxBytes) {
				const oldest = index.shift()!;
				bytes -= oldest.bytes;
				await this.store.del(oldest.key);
			}
			await this.store.set(scope, index);
		};
		const result = this.pending.then(job).catch(() => {});
		this.pending = result;
		if (Array.isArray(body) && (endpoint.startsWith('notes/') || endpoint.endsWith('/notes') || endpoint.endsWith('/timeline'))) {
			for (const note of body) {
				if (typeof note?.id === 'string' && note.user && 'text' in note) {
					void this.write(origin, accountId, 'notes/show', { noteId: note.id }, note);
				}
			}
		}
		return this.pending.then(() => {});
	}

	public clear(origin: string, accountId: string | null): Promise<void> {
		const scope = this.scope(origin, accountId);
		const job = async () => {
			const index: CacheIndex = (await this.store.get(scope)) ?? [];
			await Promise.all(index.map(entry => this.store.del(entry.key)));
			await this.store.del(scope);
		};
		const result = this.pending.then(job).catch(() => {});
		this.pending = result;
		return result;
	}
}

export const offlineContentCache = new OfflineContentCache();
