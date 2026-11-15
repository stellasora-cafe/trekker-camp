/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ClientSessionService, clientDeviceFromHeaders } from '@/core/ClientSessionService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { clientSessionErrors, requireClientProtocol } from '@/server/api/client-session-errors.js';

export const meta = {
	tags: ['account'], requireCredential: true, secure: true, errors: clientSessionErrors,
	limit: { duration: 60_000, max: 10 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			i: { type: 'string', optional: false, nullable: false },
			id: { type: 'string', format: 'id', optional: false, nullable: false },
		},
	},
} as const;
export const paramDef = {
	type: 'object', properties: { i: { type: 'string' } }, required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private sessions: ClientSessionService) {
		super(meta, paramDef, async (ps, me, _token, _file, _cleanup, ip, headers) => {
			requireClientProtocol(headers, 'web-v1');
			const credential = headers?.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : ps.i;
			if (credential?.startsWith('cs_')) return { i: credential, id: me.id };
			const { token } = await this.sessions.issue(me.id, 'web', clientDeviceFromHeaders(headers ?? {}), ip ?? '', headers?.['user-agent'] ?? '');
			return { i: token, id: me.id };
		});
	}
}
