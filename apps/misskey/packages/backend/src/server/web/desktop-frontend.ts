/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { desktopHostApi, desktopRequirements, desktopUpdateRequired } from '../desktop-compatibility.js';
import type { FastifyInstance } from 'fastify';

export function registerDesktopManifest(fastify: FastifyInstance, directory: string, serverVersion: string) {
	fastify.get('/_desktop/frontend/manifest.json', async (request, reply) => {
		reply.header('Cache-Control', 'no-store');
		reply.header('X-Content-Type-Options', 'nosniff');
		const incompatible = desktopUpdateRequired(request.headers, serverVersion);
		if (incompatible) return reply.code(426).send(incompatible);
		try {
			const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
			if (manifest.hostApi !== desktopHostApi) throw new Error('Incompatible desktop frontend archive');
			return { ...manifest, ...desktopRequirements(serverVersion) };
		} catch {
			return reply.code(503).send({ error: { code: 'DESKTOP_FRONTEND_UNAVAILABLE', message: 'The desktop frontend is not available.' }, ...desktopRequirements(serverVersion) });
		}
	});
}
