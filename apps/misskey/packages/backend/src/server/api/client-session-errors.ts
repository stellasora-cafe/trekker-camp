/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ApiError } from './error.js';

export const clientSessionErrors = {
	clientProtocolRequired: {
		message: 'This endpoint requires the appropriate Camp client protocol.',
		code: 'CLIENT_PROTOCOL_REQUIRED',
		id: '0927bd43-b48c-49ba-bf34-9b2486613022',
		httpStatusCode: 403,
	},
	authorizationExpired: {
		message: 'The authorization request has expired or has already been handled.',
		code: 'CLIENT_AUTHORIZATION_EXPIRED',
		id: 'a8d94570-afb8-44c4-a184-a8f639b902f7',
		httpStatusCode: 400,
	},
} as const;

export function requireClientProtocol(headers: Record<string, string> | null | undefined, protocol: 'web-v1' | 'desktop-v1') {
	if (headers?.['x-camp-client'] !== protocol) throw new ApiError(clientSessionErrors.clientProtocolRequired);
}
