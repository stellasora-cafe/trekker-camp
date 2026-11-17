/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ClientSessionService } from '@/core/ClientSessionService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	tags: ['account'], requireCredential: true, secure: true,
	limit: { duration: 60_000, max: 60 },
} as const;
export const paramDef = {
	type: 'object', properties: { sessionId: { type: 'string', format: 'misskey:id' } }, required: ['sessionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private sessions: ClientSessionService) {
		super(meta, paramDef, async (ps, me) => this.sessions.revoke(me.id, ps.sessionId));
	}
}
