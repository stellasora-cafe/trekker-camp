/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'events';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import * as WebSocket from 'ws';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { desktopUpdateRequired } from '../desktop-compatibility.js';
import type { MiAccessToken } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import type { MiLocalUser } from '@/models/User.js';
import { UserService } from '@/core/UserService.js';
import { ClientSessionService } from '@/core/ClientSessionService.js';
import { AuthenticateService, AuthenticationError } from './AuthenticateService.js';
import MainStreamConnection, { ConnectionRequest } from './stream/Connection.js';
import type * as http from 'node:http';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';

@Injectable()
export class StreamingApiServerService {
	#wss: WebSocket.WebSocketServer;
	#connections = new Map<WebSocket.WebSocket, number>();
	#cleanConnectionsIntervalId: NodeJS.Timeout | null = null;
	#activeUsers = new Map<MiLocalUser['id'], { connections: number; intervalId: NodeJS.Timeout; }>();

	constructor(
		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,

		private moduleRef: ModuleRef,
		private authenticateService: AuthenticateService,
		private clientSessionService: ClientSessionService,
		private usersService: UserService,
		@Inject(DI.config)
		private config: Config,
	) {
	}

	@bindThis
	public attach(server: http.Server): void {
		this.#wss = new WebSocket.WebSocketServer({
			noServer: true,
			maxPayload: 1024 * 1024, // 1MiB
			perMessageDeflate: false,
		});

		server.on('upgrade', async (request, socket, head) => {
			if (request.url == null) {
				socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
				socket.destroy();
				return;
			}

			const url = new URL(request.url, `http://${request.headers.host}`);
			if (url.pathname !== '/streaming' && url.pathname !== '/client-streaming') {
				socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
				socket.destroy();
				return;
			}
			const q = url.searchParams;
			const clientApi = url.pathname === '/client-streaming';
			if (clientApi) {
				const incompatible = desktopUpdateRequired(request.headers, this.config.version, q);
				if (incompatible) {
					const body = JSON.stringify(incompatible);
					socket.end(`HTTP/1.1 426 Upgrade Required\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
					return;
				}
			}
			const protocol = request.headers['x-camp-client'] as string | undefined ?? q.get('client') ?? undefined;

			let user: MiLocalUser | null = null;
			let app: MiAccessToken | null = null;
			let sessionId: string | undefined;

			// https://datatracker.ietf.org/doc/html/rfc6750.html#section-2.1
			// Note that the standard WHATWG WebSocket API does not support setting any headers,
			// but non-browser apps may still be able to set it.
			const token = request.headers.authorization?.startsWith('Bearer ')
				? request.headers.authorization.slice(7)
				: q.get('i');

			try {
				[user, app, sessionId] = await this.authenticateService.authenticate(token, protocol, clientApi);

				if (app !== null && !app.permission.some(p => p === 'read:account')) {
					throw new AuthenticationError('Your app does not have necessary permissions to use websocket API.');
				}
			} catch (e) {
				if (e instanceof AuthenticationError) {
					if (token?.startsWith('cs_') && protocol === (clientApi ? 'desktop-v1' : 'web-v1')) {
						this.#wss.handleUpgrade(request, socket, head, ws => {
							ws.send(JSON.stringify({ type: 'clientSessionRevoked', body: {} }));
							ws.close(4001, 'Client session revoked');
						});
						return;
					}
					socket.write([
						'HTTP/1.1 401 Unauthorized',
						'WWW-Authenticate: Bearer realm="Misskey", error="invalid_token", error_description="Failed to authenticate"',
					].join('\r\n') + '\r\n\r\n');
				} else {
					socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
				}
				socket.destroy();
				return;
			}

			if (user?.isSuspended) {
				socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
				socket.destroy();
				return;
			}

			const contextId = ContextIdFactory.create();
			this.moduleRef.registerRequestByContextId<ConnectionRequest>({
				user,
				token: app,
			}, contextId);
			const stream = await this.moduleRef.create(MainStreamConnection, contextId);

			await stream.init();

			this.#wss.handleUpgrade(request, socket, head, (ws) => {
				this.#wss.emit('connection', ws, request, {
					stream, user, app, sessionId,
				});
			});
		});

		const globalEv = new EventEmitter();

		this.redisForSub.on('message', (_: string, data: string) => {
			const parsed = JSON.parse(data);
			globalEv.emit('message', parsed);
		});

		this.#wss.on('connection', async (connection: WebSocket.WebSocket, request: http.IncomingMessage, ctx: {
			stream: MainStreamConnection,
			user: MiLocalUser | null;
			app: MiAccessToken | null;
			sessionId?: string;
		}) => {
			const { stream, user } = ctx;

			const ev = new EventEmitter();
			let counted = false;
			const revoked = () => {
				if (connection.readyState !== WebSocket.WebSocket.OPEN) return;
				connection.send(JSON.stringify({ type: 'clientSessionRevoked', body: {} }));
				connection.close(4001, 'Client session revoked');
			};

			function onRedisMessage(data: any): void {
				if (data.channel === 'internal' && data.message.type === 'clientSessionRevoked' &&
					data.message.body.userId === user?.id && ctx.sessionId &&
					(!data.message.body.sessionId || data.message.body.sessionId === ctx.sessionId)) {
					revoked();
					return;
				}
				ev.emit(data.channel, data.message);
			}

			connection.once('close', () => {
				ev.removeAllListeners();
				stream.dispose();
				globalEv.off('message', onRedisMessage);
				this.#connections.delete(connection);
				if (user && counted) this.onUserDisconnected(user);
			});
			globalEv.on('message', onRedisMessage);

			try {
				await stream.listen(ev, connection);
				// A revocation can happen after authentication while stream.init
				// runs. Subscribe first, then recheck to cover that setup interval.
				if (user && ctx.sessionId && !await this.clientSessionService.isActive(user.id, ctx.sessionId)) {
					revoked();
					return;
				}
			} catch {
				connection.close(1011, 'Failed to initialize stream');
				return;
			}
			if (connection.readyState !== WebSocket.WebSocket.OPEN) return;
			this.#connections.set(connection, Date.now());
			if (user) {
				counted = true;
				this.onUserConnected(user);
			}

			connection.on('pong', () => {
				this.#connections.set(connection, Date.now());
			});
		});

		// 一定期間通信が無いコネクションは実際には切断されている可能性があるため定期的にterminateする
		this.#cleanConnectionsIntervalId = setInterval(() => {
			const now = Date.now();
			for (const [connection, lastActive] of this.#connections.entries()) {
				if (now - lastActive > 1000 * 60 * 2) {
					connection.terminate();
					this.#connections.delete(connection);
				} else {
					connection.ping();
				}
			}
		}, 1000 * 60);
	}

	@bindThis
	private onUserConnected(user: MiLocalUser): void {
		const activeUser = this.#activeUsers.get(user.id);
		if (activeUser) {
			activeUser.connections++;
			return;
		}

		this.usersService.updateLastActiveDate(user);
		this.#activeUsers.set(user.id, {
			connections: 1,
			intervalId: setInterval(() => {
				this.usersService.updateLastActiveDate(user);
			}, 1000 * 60 * 5),
		});
	}

	@bindThis
	private onUserDisconnected(user: MiLocalUser): void {
		const activeUser = this.#activeUsers.get(user.id);
		if (!activeUser) return;

		activeUser.connections--;
		if (activeUser.connections <= 0) {
			clearInterval(activeUser.intervalId);
			this.#activeUsers.delete(user.id);
		}
	}

	@bindThis
	public detach(): Promise<void> {
		if (this.#cleanConnectionsIntervalId) {
			clearInterval(this.#cleanConnectionsIntervalId);
			this.#cleanConnectionsIntervalId = null;
		}
		return new Promise((resolve) => {
			this.#wss.close(() => resolve());
		});
	}
}
