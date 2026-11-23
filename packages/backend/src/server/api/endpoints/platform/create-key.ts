/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { AccessTokensRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { agentKeyDigest } from '../../agent-key.js';

export const meta = {
	tags: ['account'], requireCredential: true, secure: true,
	limit: { duration: 3600000, max: 10 },
	res: { type: 'object', optional: false, nullable: false, properties: {
		id: { type: 'string', optional: false, nullable: false },
		key: { type: 'string', optional: false, nullable: false },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 128, pattern: '\\S' },
		allowWrites: { type: 'boolean', default: false },
	},
	required: ['name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(@Inject(DI.accessTokensRepository) tokens: AccessTokensRepository, ids: IdService) {
		super(meta, paramDef, async (ps, me) => {
			const key = 'camp_agent_' + randomBytes(32).toString('base64url');
			const digest = agentKeyDigest(key);
			const id = ids.gen();
			const permission = ['read:account'];
			if (ps.allowWrites) permission.push('write:drive', 'write:notes', 'write:reactions', 'write:favorites', 'write:following');
			await tokens.insert({ id, userId: me.id, name: ps.name.trim(), token: digest, hash: digest, permission, fetched: true });
			return { id, key };
		});
	}
}
