/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { LessThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { ClientSessionsRepository, UsersRepository } from '@/models/_.js';
import type { MiClientSession } from '@/models/ClientSession.js';
import type { MiLocalUser } from '@/models/User.js';
import type { Config } from '@/config.js';
import { IdService } from './IdService.js';
import { GlobalEventService } from './GlobalEventService.js';

export type ClientKind = MiClientSession['kind'];
export type ClientDevice = { name?: string; platform?: string };
type BrowserAuthorization = {
	secretHash: string;
	name: string;
	platform: string;
	expiresAt: string;
	status: 'pending' | 'approved' | 'denied';
	userId?: string;
};

const authorizationTTL = 600;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function clientDeviceFromHeaders(headers: Record<string, unknown>): ClientDevice {
	let name = typeof headers['x-camp-device-name'] === 'string' ? headers['x-camp-device-name'] : undefined;
	try { if (name) name = decodeURIComponent(name); } catch { name = undefined; }
	return {
		name,
		platform: typeof headers['x-camp-device-platform'] === 'string' ? headers['x-camp-device-platform'] : undefined,
	};
}

@Injectable()
export class ClientSessionService {
	constructor(
		@Inject(DI.clientSessionsRepository) private sessions: ClientSessionsRepository,
		@Inject(DI.usersRepository) private users: UsersRepository,
		@Inject(DI.redis) private redis: Redis.Redis,
		@Inject(DI.config) private config: Config,
		private idService: IdService,
		private globalEventService: GlobalEventService,
	) {}

	public async issue(userId: string, kind: ClientKind, device: ClientDevice, ip: string, userAgent: string) {
		const token = `cs_${randomBytes(32).toString('base64url')}`;
		const now = new Date();
		const session = this.sessions.create({
			id: this.idService.gen(), tokenHash: digest(token), userId, kind,
			name: device.name?.trim().slice(0, 128) || (kind === 'desktop' ? '旅人营地客户端' : '网页浏览器'),
			platform: device.platform?.trim().slice(0, 64) || '',
			createdAt: now, lastActiveAt: now, ip: ip.slice(0, 128), userAgent: userAgent.slice(0, 512),
		});
		await this.sessions.insert(session);
		return { token, session };
	}

	public async authenticate(token: string, kind: ClientKind) {
		if (!/^cs_[A-Za-z0-9_-]{43}$/.test(token)) return null;
		const session = await this.sessions.findOneBy({ tokenHash: digest(token), kind });
		if (!session) return null;
		const user = await this.users.findOneBy({ id: session.userId });
		if (!user || user.host !== null || user.isSuspended) return null;
		await this.sessions.update({ id: session.id, lastActiveAt: LessThan(new Date(Date.now() - 60_000)) }, { lastActiveAt: new Date() });
		return { user: user as MiLocalUser, session };
	}

	public async list(userId: string, currentId?: string) {
		const sessions = await this.sessions.find({ where: { userId }, order: { lastActiveAt: 'DESC' } });
		return sessions.map(({ tokenHash: _, user: __, userId: ___, ...session }) => ({
			...session, createdAt: session.createdAt.toISOString(), lastActiveAt: session.lastActiveAt.toISOString(), isCurrent: session.id === currentId,
		}));
	}

	public async isActive(userId: string, sessionId: string) {
		return this.sessions.existsBy({ userId, id: sessionId });
	}

	public async revoke(userId: string, sessionId: string) {
		const result = await this.sessions.delete({ id: sessionId, userId });
		if (result.affected) this.globalEventService.publishInternalEvent('clientSessionRevoked', { userId, sessionId });
	}

	public async revokeAll(userId: string) {
		await this.sessions.delete({ userId });
		this.globalEventService.publishInternalEvent('clientSessionRevoked', { userId });
	}

	public async startAuthorization(device: ClientDevice) {
		const requestId = randomUUID();
		const secret = randomBytes(32).toString('base64url');
		const expiresAt = new Date(Date.now() + authorizationTTL * 1000).toISOString();
		const authorization: BrowserAuthorization = {
			secretHash: digest(secret), name: device.name?.trim().slice(0, 128) || '旅人营地客户端',
			platform: device.platform?.trim().slice(0, 64) || '', expiresAt, status: 'pending',
		};
		await this.redis.set(`client-auth:${requestId}`, JSON.stringify(authorization), 'EX', authorizationTTL);
		return { requestId, secret, authorizeUrl: `${this.config.url}/client-auth/${requestId}`, expiresAt };
	}

	public async showAuthorization(requestId: string) {
		const raw = await this.redis.get(`client-auth:${requestId}`);
		if (!raw) return null;
		const authorization = JSON.parse(raw) as BrowserAuthorization;
		if (authorization.status !== 'pending') return null;
		return { name: authorization.name, platform: authorization.platform, expiresAt: authorization.expiresAt };
	}

	public async approveAuthorization(requestId: string, userId: string, decision: 'allow' | 'deny') {
		const result = await this.redis.eval(`
			local raw = redis.call('GET', KEYS[1])
			if not raw then return 0 end
			local value = cjson.decode(raw)
			if value.status ~= 'pending' then return 0 end
			value.status = ARGV[1]
			value.userId = ARGV[2]
			redis.call('SET', KEYS[1], cjson.encode(value), 'KEEPTTL')
			return 1
		`, 1, `client-auth:${requestId}`, decision === 'allow' ? 'approved' : 'denied', userId);
		return result === 1;
	}

	public async checkAuthorization(requestId: string, secret: string, ip: string, userAgent: string): Promise<{
		status: 'pending' | 'approved' | 'denied' | 'expired'; i?: string; id?: string;
	}> {
		const raw = await this.redis.eval(`
			local raw = redis.call('GET', KEYS[1])
			if not raw then return nil end
			local value = cjson.decode(raw)
			if value.secretHash ~= ARGV[1] then return nil end
			if value.status ~= 'pending' then redis.call('DEL', KEYS[1]) end
			return raw
		`, 1, `client-auth:${requestId}`, digest(secret));
		if (typeof raw !== 'string') return { status: 'expired' };
		const authorization = JSON.parse(raw) as BrowserAuthorization;
		if (authorization.status !== 'approved' || !authorization.userId) return { status: authorization.status };
		const user = await this.users.findOneBy({ id: authorization.userId });
		if (!user || user.host !== null || user.isSuspended || user.isDeleted) return { status: 'denied' };
		const { token } = await this.issue(user.id, 'desktop', authorization, ip, userAgent);
		return { status: 'approved', i: token, id: user.id };
	}
}
