/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ClientResourcesService } from '@/core/ClientResourcesService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	tags: ['meta'],
	requireCredential: false,
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			revision: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(clientResourcesService: ClientResourcesService) {
		super(meta, paramDef, async () => clientResourcesService.snapshot());
	}
}
