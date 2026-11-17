/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ModuleRef } from '@nestjs/core';
import type * as Redis from 'ioredis';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { Config } from '@/config.js';
import type { MiLocalUser } from '@/models/User.js';
import { ClientSessionService } from '@/core/ClientSessionService.js';
import { UserService } from '@/core/UserService.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import { StreamingApiServerService } from '@/server/api/StreamingApiServerService.js';

describe('Streaming client-session setup', () => {
	async function setup(init: () => Promise<void>, listen: () => Promise<void>) {
		const redis = new EventEmitter();
		const auth = mockDeep<AuthenticateService>();
		const sessions = mockDeep<ClientSessionService>();
		const users = mockDeep<UserService>();
		const user = { id: 'test-user', isSuspended: false } as MiLocalUser;
		auth.authenticate.mockResolvedValue([user, null, 'test-session']);
		sessions.isActive.mockResolvedValue(true);
		const stream = { init: vi.fn(init), listen: vi.fn(listen), dispose: vi.fn() };
		const moduleRef = { registerRequestByContextId: vi.fn(), create: vi.fn(async () => stream) } as unknown as ModuleRef;
		const service = new StreamingApiServerService(redis as unknown as Redis.Redis, moduleRef, auth, sessions, users, { version: '2026.11.0' } as Config);
		const server = createServer();
		service.attach(server);
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const address = server.address() as AddressInfo;
		const client = new WebSocket(`ws://127.0.0.1:${address.port}/client-streaming?i=cs_test`, { headers: { 'X-Camp-Client': 'desktop-v1', 'X-Camp-Desktop-Version': '0.1.0', 'X-Camp-Host-Api': '2' } });
		return {
			client, redis, stream, sessions, users,
			async close() {
				client.terminate();
				await service.detach();
				await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
			},
		};
	}

	it('rejects a session revoked after authentication but before stream initialization finishes', async () => {
		let entered!: () => void;
		let resume!: () => void;
		const initializing = new Promise<void>(resolve => { entered = resolve; });
		const released = new Promise<void>(resolve => { resume = resolve; });
		const state = await setup(async () => { entered(); await released; }, async () => {});
		try {
			const message = once(state.client, 'message');
			const closed = once(state.client, 'close');
			await initializing;
			state.sessions.isActive.mockResolvedValue(false);
			state.redis.emit('message', 'internal', JSON.stringify({ channel: 'internal', message: { type: 'clientSessionRevoked', body: { userId: 'test-user', sessionId: 'test-session' } } }));
			resume();
			expect(JSON.parse((await message)[0].toString())).toEqual({ type: 'clientSessionRevoked', body: {} });
			expect((await closed)[0]).toBe(4001);
			expect(state.sessions.isActive).toHaveBeenCalledWith('test-user', 'test-session');
			await expect.poll(() => state.stream.dispose.mock.calls.length).toBe(1);
			expect(state.users.updateLastActiveDate).not.toHaveBeenCalled();
		} finally {
			resume();
			await state.close();
		}
	});

	it('disposes a connection closed while its stream listener is still starting', async () => {
		let resume!: () => void;
		const released = new Promise<void>(resolve => { resume = resolve; });
		const state = await setup(async () => {}, async () => { await released; });
		try {
			await once(state.client, 'open');
			const closed = once(state.client, 'close');
			state.client.close();
			await closed;
			await expect.poll(() => state.stream.dispose.mock.calls.length).toBe(1);
			resume();
			await expect.poll(() => state.sessions.isActive.mock.calls.length).toBe(1);
			expect(state.users.updateLastActiveDate).not.toHaveBeenCalled();
		} finally {
			resume();
			await state.close();
		}
	});
});
