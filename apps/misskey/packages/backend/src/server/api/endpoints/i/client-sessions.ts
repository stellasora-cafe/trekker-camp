/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ClientSessionService } from '@/core/ClientSessionService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	tags: ['account'], requireCredential: true, secure: true,
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'id', optional: false, nullable: false },
				kind: { type: 'string', enum: ['web', 'desktop'], optional: false, nullable: false },
				name: { type: 'string', optional: false, nullable: false },
				platform: { type: 'string', optional: false, nullable: false },
				createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				lastActiveAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				ip: { type: 'string', optional: false, nullable: false },
				userAgent: { type: 'string', optional: false, nullable: false },
				isCurrent: { type: 'boolean', optional: false, nullable: false },
			},
		},
	},
} as const;
export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private sessions: ClientSessionService) {
		super(meta, paramDef, async (_ps, me, _token, _file, _cleanup, _ip, headers) =>
			this.sessions.list(me.id, headers?.['x-camp-session-id']));
	}
}
