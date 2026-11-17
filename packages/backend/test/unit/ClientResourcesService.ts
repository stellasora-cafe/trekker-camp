/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type * as Redis from 'ioredis';
import type { Config } from '@/config.js';
import { ClientResourcesService } from '@/core/ClientResourcesService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';

describe('Client resource updates', () => {
	it('publishes changed public paths and a shared revision without a restart', async () => {
		const rootDir = await mkdtemp(join(tmpdir(), 'camp-resources-'));
		const assets = join(rootDir, 'packages/frontend/assets/camp');
		await mkdir(assets, { recursive: true });
		await mkdir(join(rootDir, 'packages/backend/assets'), { recursive: true });
		const redis = mockDeep<Redis.Redis>();
		let revision = 0;
		redis.get.mockImplementation(async () => String(revision));
		redis.incr.mockImplementation(async () => ++revision);
		const events = mockDeep<GlobalEventService>();
		const logger = mockDeep<LoggerService>();
		const resourceLogger = mockDeep<Logger>();
		logger.getLogger.mockReturnValue(resourceLogger);
		const service = new ClientResourcesService({ rootDir } as Config, redis, events, logger);
		try {
			service.watch();
			await expect.poll(() => revision, { timeout: 5000 }).toBeGreaterThan(0);
			const initial = (await service.snapshot()).revision;
			await writeFile(join(assets, 'logo test.svg'), '<svg/>');
			await expect.poll(() => events.publishBroadcastStream.mock.calls, { timeout: 5000 }).toEqual(expect.arrayContaining([
				['clientResourcesUpdated', { revision: expect.any(String), paths: ['/client-assets/camp/logo%20test.svg'] }],
			]));
			expect((await service.snapshot()).revision).not.toBe(initial);
			expect(resourceLogger.error).not.toHaveBeenCalled();
		} finally {
			await service.onApplicationShutdown();
			await rm(rootDir, { recursive: true, force: true });
		}
	});
});
