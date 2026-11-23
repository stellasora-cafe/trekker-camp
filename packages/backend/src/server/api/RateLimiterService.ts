/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import Limiter from 'ratelimiter';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { agentPostIntervalSchema } from '@/models/json-schema/role.js';
import type { IEndpointMeta } from './endpoints.js';

type RateLimitInfo = {
	code: 'BRIEF_REQUEST_INTERVAL',
	info: Limiter.LimiterInfo,
} | {
	code: 'RATE_LIMIT_EXCEEDED',
	info: Limiter.LimiterInfo,
};

@Injectable()
export class RateLimiterService {
	private logger: Logger;
	private disabled = false;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('limiter');

		if (process.env.NODE_ENV !== 'production') {
			this.disabled = true;
		}
	}

	@bindThis
	private checkLimiter(options: Limiter.LimiterOption): Promise<Limiter.LimiterInfo> {
		return new Promise<Limiter.LimiterInfo>((resolve, reject) => {
			new Limiter(options).get((err, info) => {
				if (err) {
					return reject(err);
				}
				resolve(info);
			});
		});
	}

	@bindThis
	public async reserveAgentPost(userId: string, intervalSec: number): Promise<number | null> {
		// Retain the last submission for the longest configurable interval so a role change applies to the next request.
		const remaining = Number(await this.redisClient.eval(`
			local ttl = redis.call('PTTL', KEYS[1])
			local wait = tonumber(ARGV[1]) - (tonumber(ARGV[2]) - ttl)
			if ttl > 0 and wait > 0 then return wait end
			redis.call('SET', KEYS[1], '1', 'PX', ARGV[2])
			return 0
		`, 1, 'limit:agent-last-post:' + userId, intervalSec * 1000, agentPostIntervalSchema.maximum * 1000));
		return remaining > 0 ? Date.now() + remaining : null;
	}

	@bindThis
	public async limit(limitation: IEndpointMeta['limit'] & { key: NonNullable<string> }, actor: string, factor = 1, alwaysEnforce = false): Promise<RateLimitInfo | null> {
		if (this.disabled && !alwaysEnforce) {
			return null;
		}

		// Short-term limit
		if (limitation.minInterval != null) {
			const info = await this.checkLimiter({
				id: `${actor}:${limitation.key}:min`,
				duration: limitation.minInterval * factor,
				max: 1,
				db: this.redisClient,
			});

			this.logger.debug(`${actor} ${limitation.key} min remaining: ${info.remaining}`);

			if (info.remaining === 0) {
				return { code: 'BRIEF_REQUEST_INTERVAL', info };
			}
		}

		// Long term limit
		if (limitation.duration != null && limitation.max != null) {
			const info = await this.checkLimiter({
				id: `${actor}:${limitation.key}`,
				duration: limitation.duration,
				max: limitation.max / factor,
				db: this.redisClient,
			});

			this.logger.debug(`${actor} ${limitation.key} max remaining: ${info.remaining}`);

			if (info.remaining === 0) {
				return { code: 'RATE_LIMIT_EXCEEDED', info };
			}
		}

		return null;
	}
}
