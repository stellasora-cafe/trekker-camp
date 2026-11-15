/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Nirax, RouteDef } from '@/lib/nirax.js';

const primaryPages = new Set([
	'/', '/timeline', '/explore', '/search', '/announcements', '/channels', '/chat',
	'/pages', '/play', '/gallery', '/games', '/settings', '/admin', '/qr',
	'/my/notifications', '/my/favorites', '/my/achievements', '/my/drive',
	'/my/follow-requests', '/my/lists', '/my/clips', '/my/antennas',
]);

export function usesMinimumShell(fullPath: string): boolean {
	return /^\/(share|auth|client-auth|miauth|oauth|signup-complete|verify-email|install-extensions)(?:\/|\?|#|$)/.test(fullPath);
}

/** A direct detail link has a real parent, without inventing intermediate URLs. */
export function getPageBackState(fullPath: string, isLoggedIn: boolean): { visible: boolean; fallback: string } {
	const path = fullPath.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
	if (path === '/about-camp/misskey' || path === '/about-misskey') return { visible: true, fallback: '/about-camp' };
	if (!isLoggedIn) return { visible: path !== '/', fallback: '/' };
	if (primaryPages.has(path)) return { visible: false, fallback: '/' };
	let fallback = '/';
	const parts = path.split('/').filter(Boolean);
	if (parts[0]?.startsWith('@') && parts.length > 1) fallback = '/' + parts[0];
	else if (/^\/settings\/(theme|plugin|drive)\//.test(path)) fallback = '/settings/' + parts[1];
	else if (path.startsWith('/settings/webhook/')) fallback = '/settings/connect';
	else if (path.startsWith('/settings/')) fallback = '/settings';
	else if (path.startsWith('/admin/user/')) fallback = '/admin/users';
	else if (path.startsWith('/admin/file/')) fallback = '/admin/files';
	else if (path.startsWith('/admin/roles/')) fallback = parts[3] === 'edit' ? '/admin/roles/' + parts[2] : '/admin/roles';
	else if (path.startsWith('/admin/')) fallback = '/admin';
	else if (path.startsWith('/chat/')) fallback = '/chat';
	else if (path.startsWith('/my/drive/')) fallback = '/my/drive';
	else if (/^\/my\/(lists|antennas)\//.test(path)) fallback = '/my/' + parts[1];
	else if (path.startsWith('/clips/')) fallback = '/my/clips';
	else if (path.startsWith('/list/') || path.startsWith('/timeline/list/')) fallback = '/my/lists';
	else if (path.startsWith('/timeline/antenna/')) fallback = '/my/antennas';
	else if (path.startsWith('/announcements/')) fallback = '/announcements';
	else if (/^\/(channels|gallery|play)\//.test(path)) fallback = parts[2] === 'edit' ? '/' + parts.slice(0, 2).join('/') : '/' + parts[0];
	else if (path.startsWith('/pages/')) fallback = '/pages';
	else if (path === '/theme-editor') fallback = '/settings/theme';
	else if (path === '/registry') fallback = '/settings/other';
	else if (path.startsWith('/registry/')) fallback = '/registry';
	else if (path.startsWith('/reversi/g/')) fallback = '/reversi';
	else if (['/reversi', '/bubble-game', '/clicker'].includes(path)) fallback = '/games';
	return { visible: true, fallback };
}

type PageHistory = { version: 1; path: string; previous: string | null };

/** Bind actual browser entries to Nirax, preserving them across reloads. */
export function bindPageHistory<Routes extends RouteDef[]>(router: Nirax<Routes>, browser: Window) {
	const currentPath = () => browser.location.pathname + browser.location.search + browser.location.hash;
	const canonical = (path: string) => {
		const url = new URL(path, browser.location.origin);
		return url.pathname + url.search + url.hash;
	};
	const sameDocument = (a: string, b: string) => a.split('#', 1)[0] === b.split('#', 1)[0];
	const minimumShell = usesMinimumShell(currentPath());
	let lastPath = currentPath();
	let traversing = false;
	const read = (path: string): PageHistory | null => {
		const state = browser.history.state?.campPageHistory;
		if (state?.version !== 1 || state.path !== path) return null;
		if (state.previous !== null && (typeof state.previous !== 'string' || !state.previous.startsWith('/') || state.previous.startsWith('//'))) return null;
		return state;
	};
	const write = (method: 'pushState' | 'replaceState', path: string, previous: string | null) => {
		const state = { ...browser.history.state };
		delete state.campPageDepth;
		state.campPageHistory = { version: 1, path, previous: previous === path ? null : previous } satisfies PageHistory;
		browser.history[method](state, '', path);
		lastPath = path;
	};
	const replace = (path: string) => {
		if (minimumShell && !usesMinimumShell(path)) browser.location.replace(path);
		else router.replaceByPath(path);
	};
	const onPush = ({ fullPath }: { fullPath: string }) => {
		const path = canonical(fullPath);
		const before = currentPath();
		// A redirect can resolve back to the current page after Nirax's
		// initial same-path check. It must not add a duplicate back step.
		if (path === before) write('replaceState', path, read(before)?.previous ?? null);
		else write('pushState', path, before);
	};
	const onReplace = ({ fullPath }: { fullPath: string }) => {
		write('replaceState', canonical(fullPath), read(currentPath())?.previous ?? null);
	};
	const onPopState = () => {
		traversing = false;
		const path = currentPath();
		if (minimumShell && !usesMinimumShell(path)) {
			browser.location.replace(path);
			return;
		}
		// Native hash links have no state in Chromium. They still have an
		// in-app predecessor when this document observed the hash change.
		const restored = read(path);
		const previous = restored ? restored.previous : (path !== lastPath && sameDocument(path, lastPath) ? lastPath : null);
		write('replaceState', path, previous);
		router.replaceByPath(path);
	};
	const onHashChange = () => { if (currentPath() !== lastPath) onPopState(); };
	const back = (fallback: string) => {
		if (traversing) return;
		const path = currentPath();
		// MkLightbox pushes a hash-only entry without notifying Nirax.
		if (!read(path) && path !== lastPath && sameDocument(path, lastPath)) write('replaceState', path, lastPath);
		if (read(path)?.previous && browser.history.length > 1) {
			traversing = true;
			browser.history.back();
		} else {
			replace(fallback);
		}
	};
	router.addListener('push', onPush);
	router.addListener('replace', onReplace);
	browser.addEventListener('popstate', onPopState);
	browser.addEventListener('hashchange', onHashChange);
	return {
		back,
		replace,
		dispose() {
			router.removeListener('push', onPush);
			router.removeListener('replace', onReplace);
			browser.removeEventListener('popstate', onPopState);
			browser.removeEventListener('hashchange', onHashChange);
		},
	};
}
