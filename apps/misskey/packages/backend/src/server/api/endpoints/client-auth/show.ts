/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ClientSessionService } from '@/core/ClientSessionService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { clientSessionErrors, requireClientProtocol } from '@/server/api/client-session-errors.js';

export const meta = {
	tags: ['account'], requireCredential: true, secure: true, errors: clientSessionErrors,
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			name: { type: 'string', optional: false, nullable: false },
			platform: { type: 'string', optional: false, nullable: false },
			expiresAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
		},
	},
} as const;
export const paramDef = {
	type: 'object', properties: { requestId: { type: 'string', pattern: '^[0-9a-f-]{36}$' } }, required: ['requestId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private sessions: ClientSessionService) {
		super(meta, paramDef, async (ps, _me, _token, _file, _cleanup, _ip, headers) => {
			requireClientProtocol(headers, 'web-v1');
			const authorization = await this.sessions.showAuthorization(ps.requestId);
			if (!authorization) throw new ApiError(clientSessionErrors.authorizationExpired);
			return authorization;
		});
	}
}
