/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import MkPageHeader from '@/components/global/MkPageHeader.vue';
import Titlebar from '@/ui/_common_/titlebar.vue';
import NotFound from '@/pages/not-found.vue';
import LoadingPage from '@/pages/_loading_.vue';
import { mainRouter, useRouter, goBack, getRouterPageBackState } from '@/router.js';
import { i18n } from '@/i18n.js';

const account = vi.hoisted(() => ({ loggedIn: false }));

vi.mock('@/i.js', () => ({ get $i() { return account.loggedIn ? { id: 'local-user' } : null; } }));
vi.mock('@/router.js', async () => {
	const { shallowRef } = await import('vue');
	const { getPageBackState } = await import('@/utility/page-back.js');
	const router = {
		currentRef: shallowRef({ route: { path: '/' }, _parsedRoute: { fullPath: '/' } }),
		replaceByPath: vi.fn(),
		useListener: vi.fn(),
	};
	return {
		mainRouter: router,
		useRouter: vi.fn(() => router),
		goBack: vi.fn(),
		getRouterPageBackState: vi.fn(target => getPageBackState(target.currentRef.value._parsedRoute.fullPath, account.loggedIn)),
	};
});
vi.mock('@/instance.js', () => ({ instance: { name: '营地', iconUrl: '/favicon.ico' } }));
vi.mock('@/accounts.js', () => ({ getAccountMenu: vi.fn() }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn() }));
vi.mock('@/utility/device-kind.js', () => ({ deviceKind: 'desktop' }));
vi.mock('@/components/global/MkPageHeader.tabs.vue', () => ({ default: { template: '<div />' } }));

const global = {
	directives: { tooltip: {} },
	stubs: { MkAvatar: true, MkUserName: true, MkResult: true },
};

function route(fullPath: string, matchedPath = fullPath): void {
	mainRouter.currentRef.value = {
		route: { path: matchedPath },
		_parsedRoute: { fullPath },
	} as typeof mainRouter.currentRef.value;
}

function header(provide = {}) {
	return render(MkPageHeader, { props: { overridePageMetadata: { title: 'Test page' } }, global: { ...global, provide } });
}

beforeEach(() => {
	vi.clearAllMocks();
	account.loggedIn = false;
	vi.mocked(useRouter).mockReturnValue(mainRouter);
	route('/');
});

afterEach(cleanup);

describe('visitor return to wallpaper', () => {
	test.each(['/about', '/about#emojis', '/about#charts', '/ads', '/scratchpad', '/contact', '/about-misskey'])('has one return button on %s using the shared router action', async path => {
		route(path);
		const view = header();
		const buttons = view.getAllByRole('button', { name: i18n.ts.goBack });
		expect(buttons).toHaveLength(1);
		await fireEvent.click(buttons[0]);
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
		route('/');
		await nextTick();
		expect(view.queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
	});

	test.each(['/api-console', '/clicker'])('retains the return button in the login-required fallback for %s', async path => {
		route(path);
		const PageWithHeader = defineComponent({
			setup(_, { slots }) {
				return () => h('section', [h(MkPageHeader), slots.default?.()]);
			},
		});
		const view = render(NotFound, { props: { showLoginPopup: true }, global: { ...global, components: { PageWithHeader } } });
		expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
	});

	test.each(['/', '/?from=login', '/#login'])('keeps wallpaper %s without a return button', path => {
		route(path);
		expect(header().queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
	});
});

describe('signed-in navigation', () => {
	test.each(['/', '/timeline', '/explore', '/channels', '/my/notifications', '/my/drive', '/settings', '/admin', '/qr'])('keeps first-level %s without a back button', path => {
		account.loggedIn = true;
		route(path);
		expect(header().queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
	});

	test.each(['/about', '/contact', '/ads', '/about-misskey', '/scratchpad', '/api-console', '/theme-editor', '/registry'])('provides an exit on auxiliary page %s', async path => {
		account.loggedIn = true;
		route(path);
		const view = header();
		expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
		expect(mainRouter.replaceByPath).not.toHaveBeenCalled();
	});

	test.each([
		['/notes/local-note', '/notes/:noteId/:initialTab?'],
		['/settings/privacy', '/settings'],
		['/settings/profile', '/settings'],
		['/admin/users', '/admin'],
		['/admin/overview', '/admin'],
		['/settings/missing', '/settings'],
		['/admin/missing', '/admin'],
		['/missing', '/:pathMatch(.*)*'],
	])('uses the actual %s URL when matched against %s', async (path, matchedPath) => {
		account.loggedIn = true;
		route(path, matchedPath);
		const view = header();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
	});

	test('updates the return button as a reused header moves between main navigation and details', async () => {
		account.loggedIn = true;
		route('/explore');
		const view = header();
		expect(view.queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
		route('/notes/local-note', '/notes/:noteId/:initialTab?');
		await nextTick();
		expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
		route('/my/notifications');
		await nextTick();
		expect(view.queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
	});
});

describe('embedded router ownership', () => {
	function embeddedRouter(path: string) {
		const router = {
			...mainRouter,
			currentRef: shallowRef({ route: { path }, _parsedRoute: { fullPath: path } }),
			replaceByPath: vi.fn(),
		} as typeof mainRouter;
		vi.mocked(useRouter).mockReturnValue(router);
		return router;
	}

	test.each([false, true])('returns through the injected router when signed in is %s', async loggedIn => {
		account.loggedIn = loggedIn;
		const router = embeddedRouter('/about');
		const view = header();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(goBack).toHaveBeenCalledExactlyOnceWith(router);
		expect(mainRouter.replaceByPath).not.toHaveBeenCalled();
	});

	test('leaves the window back control as the only return button', async () => {
		account.loggedIn = true;
		const router = embeddedRouter('/notes/local-note');
		const windowBack = vi.fn();
		const window = defineComponent({
			setup() {
				return () => h('section', [
					h('button', { type: 'button', 'aria-label': i18n.ts.goBack, onClick: windowBack }),
					h(MkPageHeader),
				]);
			},
		});
		const view = render(window, { global: { ...global, provide: { pageHeaderBackRouter: router, shouldOmitHeaderTitle: true, shouldHeaderThin: true } } });
		expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(windowBack).toHaveBeenCalledOnce();
		expect(goBack).not.toHaveBeenCalled();
	});

	test('does not hide an independent embedded router behind another router window controls', () => {
		account.loggedIn = true;
		embeddedRouter('/notes/local-note');
		expect(header({ pageHeaderBackRouter: mainRouter }).getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
	});

	test('retains an exit when a compact embedded header omits its title', () => {
		account.loggedIn = true;
		embeddedRouter('/notes/local-note');
		expect(header({ shouldOmitHeaderTitle: true, shouldHeaderThin: true }).getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
	});
});

describe('header interaction', () => {
	test.each([false, true])('keeps one return control during page loading with an existing header: %s', async existingHeader => {
		route('/scratchpad');
		const shell = defineComponent({
			setup() {
				return () => h('section', [existingHeader ? h(MkPageHeader) : null, h(LoadingPage)]);
			},
		});
		const view = render(shell, { global: {
			...global,
			components: { MkPageHeader },
			stubs: { ...global.stubs, MkLoading: true, MkStickyContainer: { template: '<section><slot name="header"/><slot/></section>' } },
			provide: { pageHeaderProvided: existingHeader },
		} });
		expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
	});

	test('moves the single return control between the titlebar and page header as the preference changes', async () => {
		route('/about');
		const titlebarRouter = shallowRef<typeof mainRouter | null>(mainRouter);
		const shell = defineComponent({
			setup() {
				return () => h('section', [titlebarRouter.value ? h(Titlebar) : null, h(MkPageHeader)]);
			},
		});
		const view = render(shell, { global: { ...global, provide: { pageHeaderBackRouter: titlebarRouter } } });
		expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
		titlebarRouter.value = null;
		await nextTick();
		expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
		expect(goBack).toHaveBeenCalledTimes(2);
	});

	test('reacts to the shared layout visibility state without changing routes', async () => {
		account.loggedIn = true;
		route('/settings/profile');
		const visible = shallowRef(false);
		const getBackState = vi.mocked(getRouterPageBackState);
		const defaultImplementation = getBackState.getMockImplementation()!;
		getBackState.mockImplementation(() => ({ visible: visible.value, fallback: '/settings' }));
		try {
			const view = header();
			expect(view.queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
			visible.value = true;
			await nextTick();
			expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
			visible.value = false;
			await nextTick();
			expect(view.queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
		} finally {
			getBackState.mockImplementation(defaultImplementation);
		}
	});

	test.each([390, 1280])('keeps a single labelled return button at %s px and stops the click bubbling', async width => {
		const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width);
		try {
			route('/about');
			const view = header();
			const ancestorClick = vi.fn();
			view.container.addEventListener('click', ancestorClick);
			expect(view.getAllByRole('button', { name: i18n.ts.goBack })).toHaveLength(1);
			await fireEvent.click(view.getByRole('button', { name: i18n.ts.goBack }));
			expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
			expect(ancestorClick).not.toHaveBeenCalled();
		} finally {
			offsetWidth.mockRestore();
		}
	});
});
