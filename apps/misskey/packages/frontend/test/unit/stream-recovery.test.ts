/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Paginator } from '@/utility/paginator.js';
import { misskeyApi } from '@/utility/misskey-api.js';

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));

const note = (id: number) => ({ id: String(id).padStart(4, '0'), createdAt: '2026-11-13T00:00:00Z' });

beforeEach(() => vi.mocked(misskeyApi).mockReset());

describe('timeline reconnect recovery', () => {
	test('catches up every page from the disconnect cursor without replacing the viewport', async () => {
		const paginator = new Paginator('notes/timeline', {});
		paginator.items.value = [note(1)] as never;
		const anchor = paginator.items.value[0];
		paginator.enqueue(note(65) as never);
		vi.mocked(misskeyApi)
			.mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => note(i + 2)) as never)
			.mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => note(i + 32)) as never)
			.mockResolvedValueOnce([note(62), note(63), note(64), note(65)] as never)
			.mockResolvedValueOnce([] as never);
		await paginator.fetchNewer({ toQueue: true, sinceId: note(1).id, catchUp: true });
		expect(misskeyApi).toHaveBeenCalledTimes(4);
		expect(vi.mocked(misskeyApi).mock.calls.map(call => (call[1] as { sinceId?: string }).sinceId)).toEqual(['0001', '0031', '0061', '0065']);
		expect(paginator.items.value).toEqual([anchor]);
		expect(paginator.queuedAheadItemsCount.value).toBe(64);
		paginator.releaseQueue();
		expect(paginator.items.value[0].id).toBe('0065');
		expect(new Set(paginator.items.value.map(item => item.id)).size).toBe(paginator.items.value.length);
	});

	test('a failed recovery preserves displayed content and can retry', async () => {
		const paginator = new Paginator('notes/timeline', {});
		paginator.items.value = [note(1)] as never;
		vi.mocked(misskeyApi).mockRejectedValueOnce(new Error('local network interruption'));
		await paginator.fetchNewer({ toQueue: true, catchUp: true });
		expect(paginator.items.value[0].id).toBe('0001');
		expect(paginator.fetchingNewer.value).toBe(false);
		vi.mocked(misskeyApi).mockResolvedValueOnce([note(2)] as never).mockResolvedValueOnce([] as never);
		await paginator.fetchNewer({ toQueue: true, catchUp: true });
		expect(paginator.queuedAheadItemsCount.value).toBe(1);
	});

	test('backfilled notes remain below newer live arrivals at the top of the timeline', async () => {
		const paginator = new Paginator('notes/timeline', {});
		paginator.items.value = [note(5), note(1)] as never;
		vi.mocked(misskeyApi).mockResolvedValueOnce([note(2), note(3), note(4)] as never).mockResolvedValueOnce([] as never);
		await paginator.fetchNewer({ sinceId: note(1).id, catchUp: true });
		expect(paginator.items.value.map(item => item.id)).toEqual(['0005', '0004', '0003', '0002', '0001']);
	});

	test('switching sources discards a recovery response for the previous source', async () => {
		const paginator = new Paginator('notes/timeline', {});
		paginator.items.value = [note(1)] as never;
		let resolveRecovery!: (items: unknown) => void;
		vi.mocked(misskeyApi).mockImplementationOnce(() => new Promise(resolve => { resolveRecovery = resolve; }) as never);
		const recovering = paginator.fetchNewer({ toQueue: true, catchUp: true });
		vi.mocked(misskeyApi).mockResolvedValueOnce([note(100)] as never);
		await paginator.reload();
		resolveRecovery([note(2)]);
		await recovering;
		expect(paginator.items.value.map(item => item.id)).toEqual(['0100']);
		expect(paginator.queuedAheadItemsCount.value).toBe(0);
	});
});
