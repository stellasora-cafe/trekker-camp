/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { Nirax } from '@/lib/nirax.js';
import { bindPageHistory, getPageBackState, usesMinimumShell } from '@/utility/page-back.js';

const component = { name: 'TestPage' };
const routes = [
	{ path: '/', component },
	{ path: '/notes/:noteId', component },
	{ path: '/chat', component },
	{ path: '/chat/user/:userId', component },
	{ path: '/old-chat', redirect: '/chat' },
	{ path: '/settings', component, children: [{ path: '/profile', component }, { path: '/theme', component }] },
	{ path: '/:(*)', component },
];
const cleanups: (() => Promise<void>)[] = [];

function setup(path = '/') {
	const browser = new HappyWindow({ url: 'https://camp.test' + path });
	const router = new Nirax(routes, path, true, component);
	const history = bindPageHistory(router, browser as unknown as Window);
	router.init();
	cleanups.push(async () => { history.dispose(); await browser.happyDOM.close(); });
	const traversed = (action: () => void) => new Promise<void>(resolve => {
		browser.addEventListener('popstate', () => resolve(), { once: true });
		action();
	});
	return { browser, router, history, traversed };
}

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe('real Nirax and browser history', () => {
	test('direct entry replaces a real parent without leaving the PWA', () => {
		const { browser, router, history } = setup('/chat/user/direct');
		const length = browser.history.length;
		history.back(getPageBackState(router.getCurrentFullPath(), true).fallback);
		expect(browser.location.pathname).toBe('/chat');
		expect(router.getCurrentFullPath()).toBe('/chat');
		expect(browser.history.length).toBe(length);
		expect(browser.history.state).toMatchObject({ campPageHistory: { previous: null } });
	});

	test('push and back restore actual entries without overrunning the root', async () => {
		const { browser, router, history, traversed } = setup();
		router.pushByPath('/chat');
		router.pushByPath('/chat/user/one');
		await traversed(() => history.back('/chat'));
		expect(router.getCurrentFullPath()).toBe('/chat');
		await traversed(() => history.back('/'));
		expect(browser.location.pathname).toBe('/');
		expect(browser.history.state).toMatchObject({ campPageHistory: { previous: null } });
		history.back('/');
		expect(browser.location.pathname).toBe('/');
	});

	test('reload restores owned history and preserves unrelated entry state', async () => {
		const { browser, router, history, traversed } = setup('/chat');
		browser.history.replaceState({ ...browser.history.state, retained: 'position' }, '', '/chat');
		router.pushByPath('/notes/reload?tab=replies#reply');
		history.dispose();
		const restored = new Nirax(routes, browser.location.pathname + browser.location.search + browser.location.hash, true, component);
		const binding = bindPageHistory(restored, browser as unknown as Window);
		cleanups.push(async () => { binding.dispose(); });
		restored.init();
		expect(browser.history.state).toMatchObject({ retained: 'position' });
		await traversed(() => binding.back('/'));
		expect(restored.getCurrentFullPath()).toBe('/chat');
		expect(browser.history.state).toMatchObject({ retained: 'position' });
	});

	test('redirects to the current route do not add duplicate back steps', async () => {
		const { browser, router, history, traversed } = setup();
		router.pushByPath('/chat');
		const length = browser.history.length;
		router.pushByPath('/old-chat');
		expect(browser.history.length).toBe(length);
		expect(router.getCurrentFullPath()).toBe('/chat');
		await traversed(() => history.back('/'));
		expect(browser.location.pathname).toBe('/');
	});

	test('replace preserves the predecessor without inserting another step', async () => {
		const { browser, router, history, traversed } = setup('/chat');
		router.pushByPath('/settings/profile');
		router.replaceByPath('/settings/theme');
		await traversed(() => history.back('/settings'));
		expect(browser.location.pathname).toBe('/chat');
	});

	test('a lightbox null-state hash closes before navigating away', async () => {
		const { browser, router, history, traversed } = setup('/notes/one');
		browser.history.pushState(null, '', '#pswp');
		await traversed(() => history.back('/'));
		expect(browser.location.pathname + browser.location.hash).toBe('/notes/one');
		expect(router.getCurrentFullPath()).toBe('/notes/one');
		expect(browser.history.state).toMatchObject({ campPageHistory: { previous: null } });
		history.back('/');
		expect(browser.location.pathname).toBe('/');
	});

	test('native hash navigation preserves root boundaries', async () => {
		const { browser, router, history, traversed } = setup('/notes/one');
		const changed = new Promise<void>(resolve => browser.addEventListener('hashchange', () => resolve(), { once: true }));
		browser.location.hash = 'reply';
		await changed;
		expect(router.getCurrentFullPath()).toBe('/notes/one#reply');
		await traversed(() => history.back('/'));
		expect(browser.location.hash).toBe('');
		expect(browser.history.state).toMatchObject({ campPageHistory: { previous: null } });
	});

	test('legacy depth and mismatched markers cannot trigger external back', () => {
		const { browser, router, history } = setup('/notes/direct');
		browser.history.replaceState({ campPageDepth: 40, campPageHistory: { version: 1, path: '/other', previous: '/' } }, '', '/notes/direct');
		router.init();
		history.back('/');
		expect(browser.location.pathname).toBe('/');
		expect(browser.history.state).toMatchObject({ campPageHistory: { previous: null } });
		expect(browser.history.state).not.toHaveProperty('campPageDepth');
	});

	test('minimum-shell tools replace the document to reach the main shell', () => {
		const { browser, history } = setup('/share');
		const replace = vi.spyOn(browser.location, 'replace').mockImplementation(() => {});
		history.replace('/');
		expect(replace).toHaveBeenCalledWith('/');
	});
});

describe('page hierarchy', () => {
	test.each(['/settings/profile', '/settings/unknown', '/admin/overview', '/admin/unknown'])('%s is a child page', path => {
		expect(getPageBackState(path, true)).toEqual({ visible: true, fallback: '/' + path.split('/')[1] });
	});
	test.each([
		['/chat/room/one', '/chat'], ['/my/drive/folder/one', '/my/drive'], ['/my/drive/file/one', '/my/drive'],
		['/admin/user/one', '/admin/users'], ['/admin/file/one', '/admin/files'], ['/admin/roles/one/edit', '/admin/roles/one'],
		['/settings/theme/install', '/settings/theme'], ['/settings/webhook/edit/one', '/settings/connect'],
		['/@camper/followers', '/@camper'], ['/@camper/pages/guide', '/@camper'], ['/channels/one/edit', '/channels/one'],
		['/reversi', '/games'], ['/reversi/g/one', '/reversi'], ['/bubble-game', '/games'],
		['/about-camp/misskey', '/about-camp'], ['/about-misskey', '/about-camp'],
		['/theme-editor', '/settings/theme'], ['/registry', '/settings/other'], ['/notes/one#reply', '/'],
	])('%s falls back to %s', (path, fallback) => {
		expect(getPageBackState(path, true)).toEqual({ visible: true, fallback });
	});
	test.each(['/', '/timeline', '/explore', '/chat', '/my/drive', '/my/lists', '/games', '/settings', '/admin', '/qr'])('%s is a primary page', path => {
		expect(getPageBackState(path + '?mode=one#tab', true).visible).toBe(false);
	});
	test.each(['/about', '/scratchpad', '/api-console', '/reversi', '/settings/profile'])('guest %s returns to the login wallpaper', path => {
		expect(getPageBackState(path, false)).toEqual({ visible: true, fallback: '/' });
	});
	test('guest upstream about page returns to camp information', () => {
		expect(getPageBackState('/about-camp/misskey', false)).toEqual({ visible: true, fallback: '/about-camp' });
	});
	test.each(['/share', '/auth/token', '/client-auth/request-id', '/client-auth/request-id?continue=1#consent', '/miauth/session', '/oauth/authorize', '/signup-complete/code', '/verify-email/code', '/install-extensions?url=one'])('%s selects the minimum shell', path => {
		expect(usesMinimumShell(path)).toBe(true);
	});
	test('similarly named ordinary paths do not select the minimum shell', () => {
		expect(usesMinimumShell('/shareholders')).toBe(false);
		expect(usesMinimumShell('/client-authentication')).toBe(false);
		expect(usesMinimumShell('/desktop-auth?mode=signin')).toBe(false);
		expect(usesMinimumShell('/settings')).toBe(false);
	});
});
