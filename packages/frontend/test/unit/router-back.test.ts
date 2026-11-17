/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { computed, effectScope, ref } from 'vue';

const account = vi.hoisted(() => ({ current: { id: 'local' } as { id: string } | null }));
vi.mock('@/i.js', () => ({ get $i() { return account.current; } }));
vi.mock('@/analytics.js', () => ({ analytics: { page: vi.fn() } }));
vi.mock('@/router.definition.js', () => ({
	page: () => ({ name: 'Page' }),
	ROUTE_DEF: [
		{ path: '/', component: {} }, { path: '/chat', component: {} },
		{ path: '/chat/user/:id', component: {} }, { path: '/notes/:id', component: {} },
		{ path: '/settings', component: {}, children: [
			{ path: '/profile', component: {} }, { path: '/security', component: {} },
			{ path: '/theme', component: {} }, { path: '/theme/install', component: {} },
		] },
		{ path: '/admin', component: {}, children: [{ path: '/overview', component: {} }] },
		{ path: '/about', component: {} }, { path: '/scratchpad', component: {} },
		{ path: '/:(*)', component: {} },
	],
}));

import { createRouter, getRouterPageBackState, goBack, mainRouter, routerCanGoBack, usePageBackRoot } from '@/router.js';

beforeEach(() => {
	account.current = { id: 'local' };
	window.history.replaceState({}, '', '/');
	mainRouter.replaceByPath('/');
});

describe('router-aware page back', () => {
	test('local window history is reactive and does not move the main browser', () => {
		const router = createRouter('/chat');
		router.init();
		const canGoBack = computed(() => routerCanGoBack(router));
		expect(canGoBack.value).toBe(false);
		router.pushByPath('/chat/user/one');
		router.pushByPath('/notes/two');
		expect(canGoBack.value).toBe(true);
		goBack(router);
		expect(router.getCurrentFullPath()).toBe('/chat/user/one');
		goBack(router);
		expect(router.getCurrentFullPath()).toBe('/chat');
		expect(canGoBack.value).toBe(false);
		expect(window.location.pathname).toBe('/');
		expect(mainRouter.getCurrentFullPath()).toBe('/');
	});

	test('a direct local child replaces its parent', () => {
		const router = createRouter('/settings/theme/install');
		router.init();
		goBack(router);
		expect(router.getCurrentFullPath()).toBe('/settings/theme');
		expect(routerCanGoBack(router)).toBe(false);
	});

	test('guest tool back always reaches the login wallpaper', () => {
		account.current = null;
		mainRouter.pushByPath('/about');
		mainRouter.pushByPath('/scratchpad');
		goBack();
		expect(mainRouter.getCurrentFullPath()).toBe('/');
		expect(window.location.pathname).toBe('/');
	});

	test('guest window back clears its tool history after reaching home', () => {
		account.current = null;
		const router = createRouter('/about');
		router.init();
		router.pushByPath('/scratchpad');
		expect(routerCanGoBack(router)).toBe(true);
		goBack(router);
		expect(router.getCurrentFullPath()).toBe('/');
		expect(routerCanGoBack(router)).toBe(false);
	});

	test('wide-shell root suppression responds to width and ends with its scope', () => {
		const router = createRouter('/settings/profile');
		router.init();
		const scope = effectScope();
		const visible = ref(true);
		const state = computed(() => getRouterPageBackState(router));
		expect(state.value.visible).toBe(true);
		scope.run(() => usePageBackRoot(router, '/settings/profile', visible));
		expect(state.value.visible).toBe(false);
		visible.value = false;
		expect(state.value).toEqual({ visible: true, fallback: '/settings' });
		visible.value = true;
		router.pushByPath('/settings/security');
		expect(state.value.visible).toBe(true);
		router.replaceByPath('/settings/profile');
		expect(state.value.visible).toBe(false);
		scope.stop();
		expect(state.value.visible).toBe(true);
	});

	test('settings and admin layout registrations do not mask each other', () => {
		const router = createRouter('/admin/overview');
		router.init();
		const settingsScope = effectScope();
		const adminScope = effectScope();
		settingsScope.run(() => usePageBackRoot(router, '/settings/profile', ref(true)));
		adminScope.run(() => usePageBackRoot(router, '/admin/overview', ref(true)));
		expect(getRouterPageBackState(router).visible).toBe(false);
		settingsScope.stop();
		expect(getRouterPageBackState(router).visible).toBe(false);
		adminScope.stop();
		expect(getRouterPageBackState(router).visible).toBe(true);
	});
});
