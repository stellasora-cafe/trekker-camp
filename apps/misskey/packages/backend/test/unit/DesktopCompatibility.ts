/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ModuleRef } from '@nestjs/core';
import type * as Redis from 'ioredis';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { Config } from '@/config.js';
import { desktopUpdateRequired } from '@/server/desktop-compatibility.js';
import { registerDesktopManifest } from '@/server/web/desktop-frontend.js';
import { ApiServerService } from '@/server/api/ApiServerService.js';
import type { ApiCallService } from '@/server/api/ApiCallService.js';
import { StreamingApiServerService } from '@/server/api/StreamingApiServerService.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';

const versionHeaders = { 'x-camp-desktop-version': '0.1.0', 'x-camp-host-api': '2' };
const desktopHeaders = { ...versionHeaders, 'x-camp-client': 'desktop-v1' };
const config = { version: '2026.11.0', maxFileSize: 1024 * 1024 } as Config;

describe('Desktop compatibility', () => {
	it.each([
		{},
		{ 'x-camp-desktop-version': '0.1.0' },
		{ 'x-camp-host-api': '2' },
		{ ...versionHeaders, 'x-camp-desktop-version': '0.0.9' },
		{ ...versionHeaders, 'x-camp-desktop-version': '0.1.0-beta.1' },
		{ ...versionHeaders, 'x-camp-desktop-version': 'invalid' },
		{ ...versionHeaders, 'x-camp-host-api': '1' },
		{ ...versionHeaders, 'x-camp-host-api': '3' },
	])('requires a package update for missing or incompatible identity: %s', headers => {
		expect(desktopUpdateRequired(headers, config.version)).toMatchObject({
			error: { code: 'CLIENT_UPDATE_REQUIRED' }, minimumVersion: '0.1.0', hostApi: 2, serverVersion: '2026.11.0',
		});
	});

	it.each(['0.1.0', '0.2.0', '1.0.0'])('accepts supported package %s with the current host API', version => {
		expect(desktopUpdateRequired({ ...versionHeaders, 'x-camp-desktop-version': version }, config.version)).toBeNull();
	});

	it('supports browser websocket query identity without overriding explicit incompatible headers', () => {
		const query = new URLSearchParams({ desktopVersion: '0.1.0', hostApi: '2' });
		expect(desktopUpdateRequired({}, config.version, query)).toBeNull();
		expect(desktopUpdateRequired({ 'x-camp-host-api': '1' }, config.version, query)).not.toBeNull();
	});
});

describe('Desktop bootstrap manifest', () => {
	let directory: string;
	const fastify = Fastify();
	const manifest = { revision: 'a'.repeat(64), sha256: 'a'.repeat(64), size: 100, archive: '/_desktop/frontend/' + 'a'.repeat(64) + '.zip', hostApi: 2 };
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), 'camp-desktop-manifest-'));
		registerDesktopManifest(fastify, directory, config.version);
		await fastify.ready();
	});
	afterAll(async () => {
		await fastify.close();
		await rm(directory, { recursive: true, force: true });
	});

	it('returns 426 and requirements before attempting to load a bundle for an old client', async () => {
		const response = await fastify.inject({ url: '/_desktop/frontend/manifest.json' });
		expect(response.statusCode).toBe(426);
		expect(response.headers['cache-control']).toBe('no-store');
		expect(response.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED' }, minimumVersion: '0.1.0', hostApi: 2 });
	});

	it('returns a retryable failure when a compatible client has no published frontend', async () => {
		const response = await fastify.inject({ url: '/_desktop/frontend/manifest.json', headers: versionHeaders });
		expect(response.statusCode).toBe(503);
		expect(response.json().error.code).toBe('DESKTOP_FRONTEND_UNAVAILABLE');
	});

	it('includes package and protocol requirements without changing archive identity', async () => {
		await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
		const response = await fastify.inject({ url: '/_desktop/frontend/manifest.json', headers: versionHeaders });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ ...manifest, minimumVersion: '0.1.0', serverVersion: '2026.11.0' });
	});

	it('does not relabel an incompatible frontend archive as compatible', async () => {
		await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, hostApi: 1 }));
		const response = await fastify.inject({ url: '/_desktop/frontend/manifest.json', headers: versionHeaders });
		expect(response.statusCode).toBe(503);
		expect(response.json().error.code).toBe('DESKTOP_FRONTEND_UNAVAILABLE');
	});
});

describe('Desktop business API gate', () => {
	const fastify = Fastify();
	const moduleRef = mockDeep<ModuleRef>();
	const apiCalls = mockDeep<ApiCallService>();
	beforeAll(async () => {
		moduleRef.get.mockReturnValue({ exec: vi.fn() });
		apiCalls.handleRequest.mockImplementation(async (_ep, _request, reply) => { reply.send({ ok: true }); });
		const service = new ApiServerService(moduleRef, config, mockDeep(), mockDeep(), mockDeep(), apiCalls, mockDeep(), mockDeep(), mockDeep(), mockDeep(), mockDeep());
		fastify.register(service.createServer, { prefix: '/api' });
		await fastify.ready();
	});
	afterAll(async () => { await fastify.close(); });

	it('rejects old and missing package versions before dispatching business logic', async () => {
		for (const headers of [{ 'x-camp-client': 'desktop-v1' }, { ...desktopHeaders, 'x-camp-desktop-version': '0.0.9' }]) {
			const before = apiCalls.handleRequest.mock.calls.length;
			const response = await fastify.inject({ method: 'POST', url: '/api/client/i', headers, payload: {} });
			expect(response.statusCode).toBe(426);
			expect(response.json().error.code).toBe('CLIENT_UPDATE_REQUIRED');
			expect(apiCalls.handleRequest).toHaveBeenCalledTimes(before);
		}
	});

	it.each([
		['/api/client/i', desktopHeaders],
		['/api/i', { 'x-camp-client': 'web-v1' }],
		['/api/meta', {}],
	] as const)('continues to serve supported desktop and ordinary web APIs: %s', async (url, headers) => {
		const response = await fastify.inject({ method: 'POST', url, headers, payload: {} });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ ok: true });
	});
});

describe('Desktop streaming compatibility gate', () => {
	it.each([
		['/client-streaming', {}, 426],
		['/client-streaming', { ...desktopHeaders, 'x-camp-desktop-version': '0.0.9' }, 426],
		['/client-streaming?desktopVersion=0.1.0&hostApi=2', {}, 101],
		['/streaming', {}, 101],
	] as const)('checks desktop upgrades and preserves web upgrades: %s %s', async (path, headers, status) => {
		const auth = mockDeep<AuthenticateService>();
		auth.authenticate.mockResolvedValue([null, null, undefined]);
		const redis = new EventEmitter();
		const stream = { init: vi.fn(), listen: vi.fn(), dispose: vi.fn() };
		const moduleRef = { registerRequestByContextId: vi.fn(), create: vi.fn(async () => stream) } as unknown as ModuleRef;
		const service = new StreamingApiServerService(redis as unknown as Redis.Redis, moduleRef, auth, mockDeep(), mockDeep(), config);
		const server = createServer();
		service.attach(server);
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { headers });
		ws.on('error', () => {});
		try {
			if (status === 426) {
				const [, response] = await once(ws, 'unexpected-response');
				expect(response.statusCode).toBe(426);
				const chunks: Buffer[] = [];
				for await (const chunk of response) chunks.push(chunk);
				expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED' }, minimumVersion: '0.1.0', hostApi: 2, serverVersion: '2026.11.0' });
				expect(auth.authenticate).not.toHaveBeenCalled();
			} else {
				await once(ws, 'open');
				expect(auth.authenticate).toHaveBeenCalled();
			}
		} finally {
			ws.terminate();
			await service.detach();
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});
});
