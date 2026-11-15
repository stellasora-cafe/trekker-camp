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
	limit: { duration: 60_000, max: 10 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			requestId: { type: 'string', optional: false, nullable: false },
			secret: { type: 'string', optional: false, nullable: false },
			authorizeUrl: { type: 'string', optional: false, nullable: false },
			expiresAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
		},
	},
} as const;
export const paramDef = {
	type: 'object', properties: { name: { type: 'string', maxLength: 128 }, platform: { type: 'string', maxLength: 64 } }, required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private sessions: ClientSessionService) {
		super(meta, paramDef, async (ps, _me, _token, _file, _cleanup, _ip, headers) => {
			requireClientProtocol(headers, 'desktop-v1');
			return this.sessions.startAuthorization(ps);
		});
	}
}
