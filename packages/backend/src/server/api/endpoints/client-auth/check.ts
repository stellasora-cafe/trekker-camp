/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ClientSessionService } from '@/core/ClientSessionService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { clientSessionErrors, requireClientProtocol } from '@/server/api/client-session-errors.js';

export const meta = {
	tags: ['account'], requireCredential: false, errors: clientSessionErrors,
	limit: { duration: 60_000, max: 120 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			status: { type: 'string', enum: ['pending', 'approved', 'denied', 'expired'], optional: false, nullable: false },
			i: { type: 'string', optional: true, nullable: false },
			id: { type: 'string', format: 'id', optional: true, nullable: false },
		},
	},
} as const;
export const paramDef = {
	type: 'object',
	properties: { requestId: { type: 'string', pattern: '^[0-9a-f-]{36}$' }, secret: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } },
	required: ['requestId', 'secret'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private sessions: ClientSessionService) {
		super(meta, paramDef, async (ps, _me, _token, _file, _cleanup, ip, headers) => {
			requireClientProtocol(headers, 'desktop-v1');
			return this.sessions.checkAuthorization(ps.requestId, ps.secret, ip ?? '', headers?.['user-agent'] ?? '');
		});
	}
}
