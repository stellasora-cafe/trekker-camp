/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import WebSocket from 'ws';
import type { DataSource } from 'typeorm';
import { MiClientSession } from '@/models/ClientSession.js';
import { MiUser } from '@/models/User.js';
import { loadConfig } from '@/config.js';
import { api, createAppToken, initTestDb, relativeFetch, signup } from '../utils.js';

type Authorization = { requestId: string; secret: string; authorizeUrl: string; expiresAt: string };
type Session = { id: string; kind: string; name: string; isCurrent: boolean; tokenHash?: string };

async function request(path: string, body: Record<string, unknown> = {}, protocol?: string, token?: string) {
	const response = await relativeFetch(`api/${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(protocol ? { 'X-Camp-Client': protocol } : {}),
			...(protocol === 'desktop-v1' ? { 'X-Camp-Desktop-Version': '0.1.0', 'X-Camp-Host-Api': '2' } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
	return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
}

describe('Camp client sessions', () => {
	let db: DataSource;
	let administrator: Awaited<ReturnType<typeof signup>>;
	let alice: Awaited<ReturnType<typeof signup>>;
	let bob: Awaited<ReturnType<typeof signup>>;
	let desktopToken: string;
	let masterToken: string;
	let thirdPartyToken: string;

	beforeAll(async () => {
		expect((await request('admin/accounts/create', { username: 'clientadmin', password: 'test', setupPassword: loadConfig().setupPassword })).status).toBe(403);
		const setup = await request('admin/accounts/create', { username: 'clientadmin', password: 'test', setupPassword: loadConfig().setupPassword }, 'web-v1');
		expect(setup.status).toBe(200);
		administrator = setup.body;
		alice = await signup({ username: 'clientalice' });
		bob = await signup({ username: 'clientbob' });
		db = await initTestDb(true);
		masterToken = (await db.getRepository(MiUser).findOneByOrFail({ id: alice.id })).token!;
		const signedIn = await request('client/signin-flow', { username: alice.username, password: 'test' }, 'desktop-v1');
		expect(signedIn.status).toBe(200);
		expect(signedIn.body.finished).toBe(true);
		desktopToken = signedIn.body.i;
		thirdPartyToken = await createAppToken(alice, ['read:account']);
	});

	afterAll(async () => { await db?.destroy(); });

	test('initial setup and administrator-created accounts return independent sessions', async () => {
		expect(administrator.token).toMatch(/^cs_[A-Za-z0-9_-]{43}$/);
		const created = await request('admin/accounts/create', { username: 'clientcreated', password: 'test' }, 'web-v1', administrator.token);
		expect(created.status).toBe(200);
		expect(created.body.token).toMatch(/^cs_[A-Za-z0-9_-]{43}$/);
		expect((await request('i', {}, 'web-v1', created.body.token)).body.id).toBe(created.body.id);
		expect((await request('admin/accounts/create', { username: 'forbiddencreate', password: 'test' }, 'web-v1', alice.token)).status).toBe(400);
	});

	test('web registration and desktop password login issue separate hashed credentials', async () => {
		expect(alice.token).toMatch(/^cs_[A-Za-z0-9_-]{43}$/);
		expect(desktopToken).toMatch(/^cs_[A-Za-z0-9_-]{43}$/);
		expect(desktopToken).not.toBe(alice.token);
		expect(desktopToken).not.toBe(masterToken);
		const session = await db.getRepository(MiClientSession).findOneByOrFail({ tokenHash: createHash('sha256').update(desktopToken).digest('hex') });
		expect(session.kind).toBe('desktop');
		expect(session.userId).toBe(alice.id);
		expect(JSON.stringify(session)).not.toContain(desktopToken);
		expect((await request('client/i', {}, 'desktop-v1', desktopToken)).body.id).toBe(alice.id);
		expect((await request('i', {}, 'web-v1', alice.token)).body.id).toBe(alice.id);
	});

	test('queued account deletion remains visible until physical deletion revokes sessions', async () => {
		const deleting = await signup({ username: 'clientdeleting' });
		await db.getRepository(MiUser).update(deleting.id, { isDeleted: true });
		const account = await request('i', {}, 'web-v1', deleting.token);
		expect(account.status).toBe(200);
		expect(account.body.isDeleted).toBe(true);
		await db.getRepository(MiUser).delete(deleting.id);
		expect(await db.getRepository(MiClientSession).countBy({ userId: deleting.id })).toBe(0);
		expect((await request('i', {}, 'web-v1', deleting.token)).status).toBe(401);
	});

	test('password login preserves the existing step flow and rejects wrong passwords', async () => {
		const step = await request('client/signin-flow', { username: alice.username }, 'desktop-v1');
		expect(step.body).toEqual({ finished: false, next: 'captcha' });
		expect((await request('client/signin-flow', { username: alice.username, password: 'incorrect' }, 'desktop-v1')).status).toBe(403);
		expect((await request('client/signin-flow', { username: alice.username, password: 'test' })).status).toBe(403);
		expect((await request('signin-flow', { username: alice.username, password: 'test' }, 'third-party-v1')).status).toBe(403);
	});

	test('client, web, and third-party credentials are bound to their API contracts', async () => {
		for (const token of [masterToken, alice.token, thirdPartyToken]) {
			expect((await request('client/i', {}, 'desktop-v1', token)).status).toBe(401);
		}
		for (const protocol of [undefined, 'web-v1', 'third-party-v1']) {
			expect((await request('client/i', {}, protocol, desktopToken)).status).toBe(403);
		}
		expect((await request('i', {}, 'web-v1', desktopToken)).status).toBe(401);
		expect((await request('i', {}, 'desktop-v1', desktopToken)).status).toBe(403);
		expect((await request('client-auth/start', {}, 'desktop-v1')).status).toBe(403);
		expect((await request('i', {}, undefined, thirdPartyToken)).status).toBe(401);
		expect((await request('i', {}, 'web-v1', thirdPartyToken)).status).toBe(401);
		expect((await request('i', {}, 'third-party-v1', masterToken)).status).toBe(401);
		expect((await request('i', {}, 'third-party-v1', alice.token)).status).toBe(401);
		expect((await request('i', {}, 'third-party-v1', thirdPartyToken)).status).toBe(200);
		expect((await request('i/client-sessions', {}, 'third-party-v1', thirdPartyToken)).status).toBe(400);
	});

	test('ordinary Misskey authorization requests require the Camp protocol header', async () => {
		const params = { name: 'test', description: 'test client', permission: ['read:account'] };
		expect((await request('app/create', params)).status).toBe(403);
		expect((await request('app/create', params, 'third-party-v1')).status).toBe(200);
		expect((await request(`miauth/${randomUUID()}/check`)).status).toBe(403);
		const oauth = await relativeFetch('oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
		expect(oauth.status).toBe(403);
	});

	test('legacy web credentials can upgrade without creating a third-party authorization', async () => {
		const upgraded = await request('i/upgrade-client-session', {}, 'web-v1', masterToken);
		expect(upgraded.status).toBe(200);
		expect(upgraded.body.i).toMatch(/^cs_/);
		expect(upgraded.body.id).toBe(alice.id);
		const repeated = await request('i/upgrade-client-session', {}, 'web-v1', upgraded.body.i);
		expect(repeated.body.i).toBe(upgraded.body.i);
		expect((await request('client/i/upgrade-client-session', {}, 'desktop-v1', desktopToken)).status).toBe(403);
	});

	test('browser authorization keeps the poll secret out of the URL and claims approval once', async () => {
		const started = await request('client/client-auth/start', { name: '测试客户端', platform: 'Windows' }, 'desktop-v1');
		expect(started.status).toBe(200);
		const authorization = started.body as Authorization;
		expect(new URL(authorization.authorizeUrl).pathname).toBe(`/client-auth/${authorization.requestId}`);
		expect(authorization.authorizeUrl).not.toContain(authorization.secret);
		expect((await request('client-auth/show', { requestId: authorization.requestId }, 'web-v1', alice.token)).body.name).toBe('测试客户端');
		expect((await request('client/client-auth/check', authorization, 'desktop-v1')).body.status).toBe('pending');
		const wrongSecret = { ...authorization, secret: 'a'.repeat(43) };
		expect((await request('client/client-auth/check', wrongSecret, 'desktop-v1')).body.status).toBe('expired');
		expect((await request('client/client-auth/approve', { requestId: authorization.requestId, decision: 'allow' }, 'desktop-v1', desktopToken)).status).toBe(403);
		expect((await request('client-auth/approve', { requestId: authorization.requestId, decision: 'allow' }, 'web-v1', alice.token)).status).toBe(204);
		const claims = await Promise.all([request('client/client-auth/check', authorization, 'desktop-v1'), request('client/client-auth/check', authorization, 'desktop-v1')]);
		expect(claims.map(result => result.body.status).sort()).toEqual(['approved', 'expired']);
		const approved = claims.find(result => result.body.status === 'approved')!.body;
		expect(approved.i).toMatch(/^cs_/);
		expect((await request('client/i', {}, 'desktop-v1', approved.i)).body.id).toBe(alice.id);
	});

	test('denied and expired browser requests cannot issue sessions', async () => {
		const { body: authorization } = await request('client/client-auth/start', {}, 'desktop-v1');
		expect((await request('client-auth/approve', { requestId: authorization.requestId, decision: 'deny' }, 'web-v1', alice.token)).status).toBe(204);
		expect((await request('client/client-auth/check', authorization, 'desktop-v1')).body).toEqual({ status: 'denied' });
		expect((await request('client/client-auth/check', authorization, 'desktop-v1')).body).toEqual({ status: 'expired' });
		expect((await request('client/client-auth/check', { requestId: randomUUID(), secret: 'a'.repeat(43) }, 'desktop-v1')).body).toEqual({ status: 'expired' });
	});

	test('device list identifies the current session and never exposes credential hashes', async () => {
		const listed = await request('client/i/client-sessions', {}, 'desktop-v1', desktopToken);
		expect(listed.status).toBe(200);
		const sessions = listed.body as Session[];
		expect(sessions.filter(session => session.isCurrent)).toHaveLength(1);
		expect(sessions.find(session => session.isCurrent)?.kind).toBe('desktop');
		expect(sessions.some(session => session.kind === 'web')).toBe(true);
		expect(sessions.every(session => session.tokenHash === undefined)).toBe(true);
		const current = sessions.find(session => session.isCurrent)!;
		expect((await request('i/revoke-client-session', { sessionId: current.id }, 'web-v1', bob.token)).status).toBe(204);
		expect((await request('client/i', {}, 'desktop-v1', desktopToken)).status).toBe(200);
	});

	test('revoking a device closes its stream and rejects future HTTP and WebSocket access', async () => {
		const login = await request('client/signin-flow', { username: alice.username, password: 'test' }, 'desktop-v1');
		const token = login.body.i as string;
		const listed = await request('client/i/client-sessions', {}, 'desktop-v1', token);
		const current = (listed.body as Session[]).find(session => session.isCurrent)!;
		const response = await relativeFetch('api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
		const address = new URL(response.url);
		address.protocol = 'ws:';
		address.pathname = '/client-streaming';
		address.searchParams.set('i', token);
		const socket = new WebSocket(address, { headers: { 'X-Camp-Client': 'desktop-v1', 'X-Camp-Desktop-Version': '0.1.0', 'X-Camp-Host-Api': '2' } });
		try {
			await once(socket, 'open');
			const pong = once(socket, 'message');
			socket.send(JSON.stringify({ type: 'ping' }));
			expect(JSON.parse((await pong)[0].toString())).toEqual({ type: 'pong', body: {} });
			const closed = once(socket, 'close');
			expect((await request('i/revoke-client-session', { sessionId: current.id }, 'web-v1', alice.token)).status).toBe(204);
			expect((await closed)[0]).toBe(4001);
			expect((await request('client/i', {}, 'desktop-v1', token)).status).toBe(401);
			const reconnect = new WebSocket(address, { headers: { 'X-Camp-Client': 'desktop-v1', 'X-Camp-Desktop-Version': '0.1.0', 'X-Camp-Host-Api': '2' } });
			const reconnectClosed = once(reconnect, 'close');
			expect((await reconnectClosed)[0]).toBe(4001);
		} finally {
			socket.close();
		}
	}, 10_000);

	test('revocation preserves third-party grants and other logged-in devices', async () => {
		expect((await api('i', {}, alice)).status).toBe(200);
		expect((await request('client/i', {}, 'desktop-v1', desktopToken)).status).toBe(200);
		expect((await request('i', {}, 'third-party-v1', thirdPartyToken)).status).toBe(200);
	});
});
