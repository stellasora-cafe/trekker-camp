/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { relative, resolve, sep } from 'node:path';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { FSWatcher } from 'chokidar';
import type * as Redis from 'ioredis';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { GlobalEventService } from './GlobalEventService.js';
import { LoggerService } from './LoggerService.js';

@Injectable()
export class ClientResourcesService implements OnApplicationShutdown {
	private watcher: FSWatcher | null = null;
	private timer: NodeJS.Timeout | null = null;
	private paths = new Set<string>();
	private refreshAll = false;
	private readonly revisionKey = 'clientResourcesRevision';

	constructor(
		@Inject(DI.config) private config: Config,
		@Inject(DI.redis) private redis: Redis.Redis,
		private globalEventService: GlobalEventService,
		private loggerService: LoggerService,
	) {}

	public async snapshot(): Promise<{ revision: string }> {
		return { revision: await this.redis.get(this.revisionKey) ?? '0' };
	}

	public watch(): void {
		if (this.watcher) return;
		const roots = [
			{ directory: resolve(this.config.rootDir, 'packages/frontend/assets'), prefix: '/client-assets/' },
			{ directory: resolve(this.config.rootDir, 'packages/backend/assets'), prefix: '/static-assets/' },
		];
		const logger = this.loggerService.getLogger('client-resources');
		this.watcher = new FSWatcher({
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
		});
		this.watcher.on('all', (event, path) => {
			if (!['add', 'change', 'unlink'].includes(event)) return;
			for (const root of roots) {
				const name = relative(root.directory, resolve(path));
				if (name === '..' || name.startsWith(`..${sep}`)) continue;
				this.paths.add(root.prefix + name.split(sep).map(encodeURIComponent).join('/'));
				break;
			}
			this.schedule();
		});
		// A restart may follow an offline resource update. Both clients compare
		// this shared revision after reconnecting, without replacing their page.
		this.watcher.on('ready', () => {
			this.refreshAll = true;
			this.schedule();
		});
		this.watcher.on('error', error => logger.error(error instanceof Error ? error : String(error)));
		this.watcher.add(roots.map(root => root.directory));
	}

	private schedule(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.publish().catch(error => this.loggerService.getLogger('client-resources').error(error));
		}, 150);
		this.timer.unref();
	}

	private async publish(): Promise<void> {
		const paths = this.refreshAll ? [] : [...this.paths];
		this.paths.clear();
		this.refreshAll = false;
		const revision = String(await this.redis.incr(this.revisionKey));
		this.globalEventService.publishBroadcastStream('clientResourcesUpdated', { revision, paths });
	}

	public async onApplicationShutdown(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		await this.watcher?.close();
		this.watcher = null;
	}
}
