/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { gte, valid } from 'semver';
import type { IncomingHttpHeaders } from 'node:http';

export const minimumDesktopVersion = '0.1.0';
export const desktopHostApi = 2;

export function desktopRequirements(serverVersion: string) {
	return { minimumVersion: minimumDesktopVersion, hostApi: desktopHostApi, serverVersion };
}

export function desktopUpdateRequired(headers: IncomingHttpHeaders, serverVersion: string, query?: URLSearchParams) {
	const version = headers['x-camp-desktop-version'] ?? query?.get('desktopVersion');
	const hostApi = headers['x-camp-host-api'] ?? query?.get('hostApi');
	if (typeof version === 'string' && valid(version) && gte(version, minimumDesktopVersion) && hostApi === String(desktopHostApi)) {
		return null;
	}
	return {
		error: {
			message: 'A desktop client update is required.',
			code: 'CLIENT_UPDATE_REQUIRED',
			id: 'e5077542-081f-4334-bdbb-933529fc16e0',
			kind: 'client',
		},
		...desktopRequirements(serverVersion),
	};
}
