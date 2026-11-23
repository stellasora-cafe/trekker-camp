/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';

// Reserved storage namespace. Neither the stored digest nor the raw key is a client token.
export const agentKeyMarker = 'agent:';
export function agentKeyDigest(key: string): string {
	return agentKeyMarker + createHash('sha256').update(key).digest('hex');
}
