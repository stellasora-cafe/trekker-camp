/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Redis } from 'ioredis';

const dayMs = 86400000;

function usageDate(time: number) {
	return new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}

function usageKey(userId: string, date: string) {
	return `agent-usage:${userId}:${date}`;
}

export async function recordAgentUsage(redis: Redis, userId: string, endpoint: string, status: number, time: number) {
	const key = usageKey(userId, usageDate(time));
	const batch = redis.multi().hincrby(key, 'requests', 1);
	if (status === 429) batch.hincrby(key, 'limited', 1);
	if (endpoint === 'notes/create' && status >= 200 && status < 300) batch.hincrby(key, 'posts', 1);
	await batch.expire(key, 8 * 86400).exec();
}

export async function readAgentUsage(redis: Redis, userId: string) {
	const now = Date.now();
	return Promise.all(Array.from({ length: 7 }, async (_, index) => {
		const date = usageDate(now - (6 - index) * dayMs);
		const [requests, posts, limited] = await redis.hmget(usageKey(userId, date), 'requests', 'posts', 'limited');
		return { date, requests: Number(requests), posts: Number(posts), limited: Number(limited) };
	}));
}
