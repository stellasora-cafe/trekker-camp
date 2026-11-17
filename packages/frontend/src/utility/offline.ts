/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readonly, ref } from 'vue';
import { apiUrl } from '@@/js/config.js';

export function isDesktopClient(): boolean {
	return window.document.documentElement.dataset.campDesktop === 'true';
}

const unavailable = ref(isDesktopClient() && (!navigator.onLine || window.document.documentElement.dataset.campConnection === 'offline'));
const reconnecting = ref(false);
const maintenance = ref(false);
let hostMaintenance = false;
export const maintenanceActive = readonly(maintenance);
export const offline = readonly(unavailable);
export const reconnectingServer = readonly(reconnecting);
let connectionChannel: BroadcastChannel | undefined;

function updateAvailability(value: boolean, broadcast = true): void {
	unavailable.value = value;
	if (!isDesktopClient()) return;
	const state = value ? 'offline' : 'online';
	if (window.document.documentElement.dataset.campConnection === state) return;
	window.document.documentElement.dataset.campConnection = state;
	window.dispatchEvent(new Event('camp-connection-change'));
	if (broadcast) connectionChannel?.postMessage(state);
}

export function serverUnavailable(): void {
	if (isDesktopClient()) updateAvailability(true);
}

export function serverAvailable(): void {
	if (!hostMaintenance) maintenance.value = false;
	updateAvailability(isDesktopClient() && !navigator.onLine);
}

export function observeMaintenanceResponse(response: Response): boolean {
	if (!isDesktopClient() || !response.url) return false;
	const target = new URL(response.url);
	if ((target.origin === window.location.origin || target.origin === 'https://camp.stellasora.cafe') && target.pathname === '/__camp-maintenance/v1.html') {
		maintenance.value = true;
		serverUnavailable();
		return true;
	}
	return false;
}

export async function reconnectServer(): Promise<boolean> {
	if (reconnecting.value) return false;
	reconnecting.value = true;
	try {
		const response = await window.fetch(`${apiUrl}/meta`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Camp-Client': 'web-v1' },
			body: JSON.stringify({ detail: false, i: null }),
			signal: AbortSignal.timeout(4000),
		});
		if (observeMaintenanceResponse(response) || !response.ok) throw new Error('Server unavailable');
		const body = await response.json();
		if (typeof body.version !== 'string') throw new Error('Invalid server response');
		serverAvailable();
		return true;
	} catch {
		serverUnavailable();
		return false;
	} finally {
		reconnecting.value = false;
	}
}

let started = false;
export function startOfflineRecovery(): void {
	if (started || !isDesktopClient()) return;
	started = true;
	window.addEventListener('camp-server-maintenance', () => {
		hostMaintenance = window.document.documentElement.dataset.campMaintenance === 'true';
		maintenance.value = hostMaintenance;
		if (hostMaintenance) serverUnavailable();
		else void reconnectServer();
	});
	hostMaintenance = window.document.documentElement.dataset.campMaintenance === 'true';
	maintenance.value = hostMaintenance;
	connectionChannel = new BroadcastChannel('camp-desktop-connection');
	connectionChannel.onmessage = ({ data }) => {
		if (data === 'offline' || data === 'online') updateAvailability(data === 'offline' || !navigator.onLine, false);
	};
	// The native welcome replaces itself with an already-offline WebView. Let
	// idle login and tool windows enter maintenance along with that new window.
	if (unavailable.value) connectionChannel.postMessage('offline');
	if (navigator.onLine) void reconnectServer();
	else serverUnavailable();
	window.addEventListener('offline', () => {
		maintenance.value = false;
		hostMaintenance = false;
		serverUnavailable();
	});
	window.addEventListener('online', () => { void reconnectServer(); });
	window.setInterval(() => {
		if (unavailable.value && navigator.onLine && window.document.visibilityState !== 'hidden') void reconnectServer();
	}, 15000);
}
