/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiUser } from '@/models/User.js';
import { loadConfig } from '@/config.js';
import { api, createAppToken, initTestDb, relativeFetch, role, signup } from '../utils.js';

function request(method: string, path: string, token?: string, body?: Record<string, unknown>, protocol = 'agent-v1') {
	return relativeFetch('api/agent/v1/' + path, {
		method,
		headers: {
			'X-Camp-Client': protocol,
			...(token && { Authorization: 'Bearer ' + token }),
			...(body && { 'Content-Type': 'application/json' }),
		},
		body: body && JSON.stringify(body),
	});
}

describe('Camp developer API v1', () => {
	let alice: Awaited<ReturnType<typeof signup>>;
	let writer: string;
	let reader: string;
	let readOnly: string;
	let admin: { token: string };

	beforeAll(async () => {
		admin = (await api('admin/accounts/create', { username: 'agentadmin', password: 'test', setupPassword: loadConfig().setupPassword })).body;
		alice = await signup({ username: 'devalice' });
		const bob = await signup({ username: 'devbob' });
		writer = (await api('platform/create-key', { name: 'writer', allowWrites: true }, alice)).body.key;
		reader = (await api('platform/create-key', { name: 'interactions', allowWrites: true }, bob)).body.key;
		readOnly = (await api('platform/create-key', { name: 'reader' }, bob)).body.key;
	});

	test('dedicated credentials and scoped writes', async () => {
		const thirdParty = await createAppToken(alice, ['read:account']);
		expect((await request('GET', 'me', thirdParty)).status).toBe(401);
		expect((await api('i', {}, { token: writer })).status).toBe(401);
		expect((await api('platform/create-key', { name: 'denied' }, { token: thirdParty })).status).toBeGreaterThanOrEqual(400);
		expect((await request('GET', 'me')).status).toBe(401);
		expect((await request('GET', 'me', alice.token)).status).toBe(401);
		expect((await request('GET', 'me', writer, undefined, 'web-v1')).status).toBe(403);
		expect(await (await request('GET', 'me', writer)).json()).toMatchObject({ id: alice.id });
		expect((await request('POST', 'posts', readOnly, { text: 'denied' })).status).toBe(403);
		expect((await request('GET', 'posts/search?query=camp&limit=invalid', writer)).status).toBe(400);
		const search = await request('GET', 'posts/search?query=camp&limit=1', reader);
		expect(await search.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
		expect((await request('GET', 'users/' + alice.id + '?username=another', reader)).status).toBe(400);
	});

	test('post lifecycle, timeline pagination and interactions', async () => {
		const user = 'users/' + alice.id;
		expect(await (await request('GET', user, reader)).json()).toMatchObject({ id: alice.id });
		expect((await request('POST', user + '/follow', reader)).ok).toBe(true);
		const created = await request('POST', 'posts', writer, { text: 'camp developer post' });
		expect(created.status).toBe(200);
		const { createdNote } = await created.json() as { createdNote: { id: string } };
		const path = 'posts/' + createdNote.id;
		expect(await (await request('GET', path, reader)).json()).toMatchObject({ id: createdNote.id, text: 'camp developer post' });
		expect(await (await request('GET', user + '/posts?limit=1', reader)).json()).toMatchObject([{ id: createdNote.id }]);
		expect(await (await request('GET', user + '/posts?untilId=' + createdNote.id, reader)).json()).toEqual([]);
		expect((await request('GET', 'timelines/home?limit=1', writer)).status).toBe(200);
		expect((await request('POST', path + '/bookmark', reader)).ok).toBe(true);
		expect((await request('DELETE', path + '/bookmark', reader)).ok).toBe(true);
		expect((await request('POST', path + '/reactions', reader, { reaction: '👍' })).ok).toBe(true);
		expect((await request('DELETE', path + '/reactions/me', reader)).ok).toBe(true);
		expect((await request('DELETE', user + '/follow', reader)).ok).toBe(true);
		expect((await request('DELETE', path, writer)).status).toBe(204);
		expect((await request('GET', path, reader)).ok).toBe(false);
	});

	test('uploads an image with an Agent key and publishes it in a post', async () => {
		const owner = await signup({ username: 'agentmedia' });
		const key = (await api('platform/create-key', { name: 'media', allowWrites: true }, owner)).body.key;
		const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDqkAAAAASUVORK5CYII=', 'base64');
		const upload = (token: string, blob: Blob) => {
			const body = new FormData();
			body.append('file', blob, 'camp.png');
			return relativeFetch('api/agent/v1/media', {
				method: 'POST', headers: { 'X-Camp-Client': 'agent-v1', Authorization: 'Bearer ' + token }, body,
			});
		};
		expect((await upload(readOnly, new Blob([png]))).status).toBe(403);
		expect(await (await upload(key, new Blob(['text'], { type: 'image/png' }))).json()).toMatchObject({ error: { code: 'INVALID_MEDIA' } });
		const extra = new FormData();
		extra.append('file', new Blob([png]), 'first.png');
		extra.append('file', new Blob([png]), 'second.png');
		const duplicate = await relativeFetch('api/agent/v1/media', {
			method: 'POST', headers: { 'X-Camp-Client': 'agent-v1', Authorization: 'Bearer ' + key }, body: extra,
		});
		expect(duplicate.status).toBe(400);
		expect((await api('admin/update-meta', { enableIpLogging: true }, admin)).status).toBe(204);
		const response = await upload(key, new Blob([png], { type: 'image/png' }));
		expect(response.status).toBe(200);
		const file = await response.json() as { id: string };
		expect(file).toMatchObject({ type: 'image/png', name: 'camp.png' });
		const ownDrive = await api('drive/files', { folderId: null }, owner);
		expect(ownDrive.status).toBe(200);
		expect(ownDrive.body).toContainEqual(expect.objectContaining({ id: file.id, name: 'camp.png' }));
		const otherDrive = await api('drive/files', { folderId: null }, alice);
		expect(otherDrive.status).toBe(200);
		expect(otherDrive.body).not.toContainEqual(expect.objectContaining({ id: file.id }));
		const db = await initTestDb(true);
		try {
			const stored = await db.getRepository(MiDriveFile).findOneByOrFail({ id: file.id });
			expect(stored.requestHeaders).toEqual({});
		} finally {
			await db.destroy();
			await api('admin/update-meta', { enableIpLogging: false }, admin);
		}
		const post = await request('POST', 'posts', key, { text: 'Picture from camp', fileIds: [file.id] });
		expect(post.status).toBe(200);
		const { createdNote } = await post.json() as { createdNote: { id: string } };
		expect(await (await request('GET', 'posts/' + createdNote.id, key)).json()).toMatchObject({ files: [{ id: file.id }], text: 'Picture from camp' });
	});

	test('restricted post text stays hidden from other readers', async () => {
		const owner = await signup({ username: 'agentprivate' });
		const privateKey = (await api('platform/create-key', { name: 'private', allowWrites: true }, owner)).body.key;
		const created = await request('POST', 'posts', privateKey, { text: 'private message', visibility: 'specified', visibleUserIds: [owner.id] });
		const { createdNote } = await created.json() as { createdNote: { id: string } };
		const path = 'posts/' + createdNote.id;
		expect(await (await request('GET', path, privateKey)).json()).toMatchObject({ text: 'private message' });
		expect(await (await request('GET', path, reader)).json()).toMatchObject({ isHidden: true, text: null });
	});

	test('new accounts can manage keys and suspension immediately disables existing keys', async () => {
		const user = await signup({ username: 'agentowner' });
		const key = (await api('platform/create-key', { name: 'assistant' }, user)).body;
		const listed = (await api('i/apps', { agentOnly: true }, user)).body;
		expect(listed).toMatchObject([{ id: key.id, name: 'assistant' }]);
		expect(JSON.stringify(listed)).not.toContain(key.key);
		expect((await api('i/apps', {}, user)).body).toEqual([]);
		const db = await initTestDb(true);
		try {
			await db.getRepository(MiUser).update(user.id, { isSuspended: true });
			expect((await request('GET', 'users/' + alice.id, key.key)).status).toBe(401);
			await db.getRepository(MiUser).update(user.id, { isSuspended: false });
			expect((await request('GET', 'me', key.key)).status).toBe(200);
			expect((await api('i/revoke-token', { tokenId: key.id }, user)).status).toBe(204);
			expect((await request('GET', 'me', key.key)).status).toBe(401);
		} finally {
			await db.destroy();
		}
	});

	test('all agent keys of the same account share the minute quota', async () => {
		const user = await signup({ username: 'agentquota' });
		const first = (await api('platform/create-key', { name: 'first' }, user)).body.key;
		const second = (await api('platform/create-key', { name: 'second' }, user)).body.key;
		for (let i = 0; i < 60; i++) {
			expect((await request('GET', 'users/' + user.id, i % 2 ? first : second)).status).toBe(200);
		}
		const limited = await request('GET', 'me', first);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
		expect((await request('GET', 'me', reader)).status).toBe(200);
	});

	test('concurrent Agent keys share one posting slot for posts, replies, quotes and reposts', async () => {
		const user = await signup({ username: 'agentpostlimit' });
		const first = (await api('platform/create-key', { name: 'one', allowWrites: true }, user)).body.key;
		const second = (await api('platform/create-key', { name: 'two', allowWrites: true }, user)).body.key;
		const results = await Promise.all([first, second].map(key => request('POST', 'posts', key, { text: 'hello' })));
		expect(results.map(result => result.status).sort()).toEqual([200, 429]);
		const { createdNote } = await results.find(result => result.ok)!.json() as { createdNote: { id: string } };
		for (const body of [{ text: 'reply', replyId: createdNote.id }, { renoteId: createdNote.id }, { text: 'quote', renoteId: createdNote.id }]) {
			const response = await request('POST', 'posts', second, body);
			expect(response.status).toBe(429);
			const seconds = Number(response.headers.get('Retry-After'));
			expect(seconds).toBeGreaterThan(290);
			expect(seconds).toBeLessThanOrEqual(300);
		}
		expect((await request('GET', 'posts/' + createdNote.id, second)).status).toBe(200);
		expect((await api('notes/create', { text: 'posted from the website' }, user)).status).toBe(200);
	});

	test('base and assigned role changes apply to the current posting interval', async () => {
		const user = await signup({ username: 'agentpolicies' });
		const key = (await api('platform/create-key', { name: 'policy', allowWrites: true }, user)).body.key;
		const submit = () => request('POST', 'posts', key, { text: 'role policy' });
		const interval = async (seconds: number) => {
			await expect.poll(async () => (await api('i', {}, user)).body.policies.agentPostIntervalSec).toBe(seconds);
			const response = await submit();
			expect(response.status).toBe(429);
			const remaining = Number(response.headers.get('Retry-After'));
			expect(remaining).toBeGreaterThan(seconds - 10);
			expect(remaining).toBeLessThanOrEqual(seconds);
		};
		expect((await api('admin/roles/update-default-policies', { policies: { agentPostIntervalSec: 0 } }, admin)).status).toBe(400);
		expect((await api('admin/roles/update-default-policies', { policies: { agentPostIntervalSec: 90 } }, admin)).status).toBe(204);
		expect((await submit()).status).toBe(200);
		await interval(90);
		const custom = await role(admin, {}, { agentPostIntervalSec: { useDefault: false, priority: 1, value: 30 } });
		expect((await api('admin/roles/assign', { roleId: custom.id, userId: user.id }, admin)).status).toBe(204);
		await interval(30);
		const update = (value: number) => api('admin/roles/update', {
			roleId: custom.id, policies: { agentPostIntervalSec: { useDefault: false, priority: 1, value } },
		}, admin);
		expect((await update(-5)).status).toBe(400);
		expect((await update(180)).status).toBe(204);
		await interval(180);
		const second = await role(admin, {}, { agentPostIntervalSec: { useDefault: false, priority: 1, value: 60 } });
		expect((await api('admin/roles/assign', { roleId: second.id, userId: user.id }, admin)).status).toBe(204);
		await interval(60);
		expect((await api('admin/roles/update', {
			roleId: custom.id, policies: { agentPostIntervalSec: { useDefault: false, priority: 2, value: 180 } },
		}, admin)).status).toBe(204);
		await interval(180);
		expect((await api('admin/roles/unassign', { roleId: second.id, userId: user.id }, admin)).status).toBe(204);
		expect((await api('admin/roles/unassign', { roleId: custom.id, userId: user.id }, admin)).status).toBe(204);
		await interval(90);
	});

	test('dashboard reports authenticated traffic for the owning account only', async () => {
		const user = await signup({ username: 'agentdashboard' });
		const key = (await api('platform/create-key', { name: 'dashboard', allowWrites: true }, user)).body.key;
		const snapshot = async () => (await api('platform/usage', {}, user)).body;
		const initial = await snapshot();
		expect(initial).toHaveLength(7);
		expect(initial.every(day => day.requests === 0)).toBe(true);
		expect((await request('GET', 'me', reader)).status).toBe(200);
		expect((await request('GET', 'me', key)).status).toBe(200);
		expect((await request('POST', 'posts', key, { text: 'usage' })).status).toBe(200);
		expect((await request('POST', 'posts', key, { text: 'limited' })).status).toBe(429);
		await expect.poll(async () => (await snapshot()).at(-1)).toMatchObject({ requests: 3, posts: 1, limited: 1 });
	});
});
