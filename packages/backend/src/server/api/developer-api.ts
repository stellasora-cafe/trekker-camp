/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clientSessionErrors } from './client-session-errors.js';

type Input = Record<string, unknown>;
type Route = {
	method: 'GET' | 'POST' | 'DELETE';
	path: string;
	fields?: readonly string[];
};

const page = ['limit', 'sinceId', 'untilId'];
const routes: Partial<Record<keyof typeof import('./endpoint-list.js'), Route>> = {
	'drive/files/create': { method: 'POST', path: '/media' },
	i: { method: 'GET', path: '/me' },
	'users/show': { method: 'GET', path: '/users/:userId' },
	'users/notes': { method: 'GET', path: '/users/:userId/posts', fields: page },
	'notes/timeline': { method: 'GET', path: '/timelines/home', fields: page },
	'notes/search': { method: 'GET', path: '/posts/search', fields: ['query', ...page] },
	'notes/show': { method: 'GET', path: '/posts/:noteId' },
	'notes/create': { method: 'POST', path: '/posts', fields: ['text', 'visibility', 'visibleUserIds', 'cw', 'replyId', 'renoteId', 'fileIds'] },
	'notes/delete': { method: 'DELETE', path: '/posts/:noteId' },
	'notes/reactions/create': { method: 'POST', path: '/posts/:noteId/reactions', fields: ['reaction'] },
	'notes/reactions/delete': { method: 'DELETE', path: '/posts/:noteId/reactions/me' },
	'notes/favorites/create': { method: 'POST', path: '/posts/:noteId/bookmark' },
	'notes/favorites/delete': { method: 'DELETE', path: '/posts/:noteId/bookmark' },
	'following/create': { method: 'POST', path: '/users/:userId/follow' },
	'following/delete': { method: 'DELETE', path: '/users/:userId/follow' },
};

type DeveloperRequest = FastifyRequest<{ Body: Input; Querystring: Input; Params: Record<string, string> }>;

export function registerDeveloperApi(
	fastify: FastifyInstance,
	resolve: (name: string) => (request: DeveloperRequest, reply: FastifyReply, params: Input) => Promise<void>,
) {
	for (const [name, route] of Object.entries(routes)) {
		const handle = resolve(name);
		fastify.route<{ Body: Input; Querystring: Input; Params: Record<string, string> }>({
			method: route.method,
			url: '/agent/v1' + route.path,
			bodyLimit: 1024 * 1024,
			exposeHeadRoute: false,
			handler: async (request, reply) => {
				if (request.headers['x-camp-client'] !== 'agent-v1') {
					return reply.code(403).send({ error: clientSessionErrors.clientProtocolRequired });
				}
				if (!request.headers.authorization?.match(/^Bearer \S+$/)) {
					return reply.header('WWW-Authenticate', 'Bearer realm="Camp"').code(401).send({
						error: { code: 'CREDENTIAL_REQUIRED', message: 'An Agent API key is required.' },
					});
				}
				const input = route.method === 'GET' ? request.query : request.body ?? {};
				if (typeof input !== 'object' || Array.isArray(input) ||
					Object.keys(input).some(key => !route.fields?.includes(key)) ||
					(route.method !== 'GET' && Object.keys(request.query).length > 0)) {
					return reply.code(400).send({ error: { code: 'INVALID_PARAM', message: 'Unsupported request parameters.' } });
				}
				await handle(request, reply, { ...input, ...request.params });
				return reply;
			},
		});
	}
}
