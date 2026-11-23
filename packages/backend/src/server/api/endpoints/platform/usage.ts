/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { readAgentUsage } from '../../agent-usage.js';

const count = { type: 'integer', optional: false, nullable: false } as const;
export const meta = {
	tags: ['account'], requireCredential: true, secure: true,
	res: {
		type: 'array', optional: false, nullable: false,
		items: { type: 'object', optional: false, nullable: false, properties: {
			date: { type: 'string', optional: false, nullable: false },
			requests: count, posts: count, limited: count,
		} },
	},
} as const;
export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.redis) redis: Redis) {
		super(meta, paramDef, async (_ps, me) => readAgentUsage(redis, me.id));
	}
}
