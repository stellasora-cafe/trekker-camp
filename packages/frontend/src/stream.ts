/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { markRaw } from 'vue';
import { $i } from '@/i.js';
import { wsOrigin } from '@@/js/config.js';
import { fetchInstance } from '@/instance.js';
import { fetchCustomEmojis } from '@/custom-emojis.js';
import { refreshCurrentAccount } from '@/accounts.js';
import { refreshClientResources, updateClientResources } from '@/utility/client-resources.js';
import { signout } from '@/signout.js';

// heart beat interval in ms
const HEART_BEAT_INTERVAL = 15_000;
const HEART_BEAT_TIMEOUT = 10_000;

let stream: Misskey.IStream | null = null;
let timeoutHeartBeat: number | null = null;
let timeoutPong: number | null = null;

export function useStream(): Misskey.IStream {
	if (stream) return stream;

	stream = markRaw(new Misskey.Stream(wsOrigin, $i ? {
		token: $i.token,
	} : null, { client: 'web-v1' }));
	stream.on('_pong_', clearPongTimeout);
	stream.on('_disconnected_', clearPongTimeout);
	stream.on('_connected_', () => {
		heartbeat();
		window.dispatchEvent(new Event('camp-stream-connected'));
	});
	stream.on('_authenticationFailed_', () => { void signout({ revoked: true }); });
	stream.on('clientResourcesUpdated', update => { void updateClientResources(update).catch(() => {}); });
	void refreshClientResources().catch(() => {});
	stream.on('_reconnected_', () => {
		void Promise.allSettled([fetchInstance(true), fetchCustomEmojis(true), refreshCurrentAccount(), refreshClientResources()]);
	});
	window.addEventListener('online', () => stream?.reconnect());

	if (timeoutHeartBeat) window.clearTimeout(timeoutHeartBeat);
	timeoutHeartBeat = window.setTimeout(heartbeat, HEART_BEAT_INTERVAL);

	window.document.addEventListener('visibilitychange', () => {
		if (window.document.visibilityState !== 'visible') return;
		stream?.reconnect();
		heartbeat();
	});

	return stream;
}

function heartbeat(): void {
	if (stream?.state === 'connected' && timeoutPong == null) {
		stream.ping();
		timeoutPong = window.setTimeout(() => {
			timeoutPong = null;
			stream?.reconnect(true);
		}, HEART_BEAT_TIMEOUT);
	}
	if (timeoutHeartBeat) window.clearTimeout(timeoutHeartBeat);
	timeoutHeartBeat = window.setTimeout(heartbeat, HEART_BEAT_INTERVAL);
}

function clearPongTimeout(): void {
	if (timeoutPong != null) window.clearTimeout(timeoutPong);
	timeoutPong = null;
}
