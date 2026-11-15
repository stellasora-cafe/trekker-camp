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
	limit: { duration: 60_000, max: 30 },
} as const;
export const paramDef = {
	type: 'object',
	properties: { requestId: { type: 'string', pattern: '^[0-9a-f-]{36}$' }, decision: { type: 'string', enum: ['allow', 'deny'] } },
	required: ['requestId', 'decision'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private sessions: ClientSessionService) {
		super(meta, paramDef, async (ps, me, _token, _file, _cleanup, _ip, headers) => {
			requireClientProtocol(headers, 'web-v1');
			if (!await this.sessions.approveAuthorization(ps.requestId, me.id, ps.decision)) throw new ApiError(clientSessionErrors.authorizationExpired);
		});
	}
}
