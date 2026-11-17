/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type { Component } from 'vue';
import ErrorPage from '@/pages/_error_.vue';
import LoadingPage from '@/pages/_loading_.vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import MkPageHeader from '@/components/global/MkPageHeader.vue';
import { goBack, mainRouter } from '@/router.js';
import { i18n } from '@/i18n.js';
import { provideMetadataReceiver } from '@/page.js';

const api = vi.hoisted(() => vi.fn());

vi.mock('@/i.js', () => ({ $i: { id: 'local-user' } }));
vi.mock('@/router.js', async () => {
	const { shallowRef } = await import('vue');
	const { getPageBackState } = await import('@/utility/page-back.js');
	const router = {
		currentRef: shallowRef({ route: { path: '/settings' }, _parsedRoute: { fullPath: '/settings/privacy' } }),
		useListener: vi.fn(),
	};
	return {
		mainRouter: router,
		useRouter: () => router,
		goBack: vi.fn(),
		getRouterPageBackState: vi.fn(target => getPageBackState(target.currentRef.value._parsedRoute.fullPath, true)),
	};
});
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: api }));
vi.mock('@/utility/unison-reload.js', () => ({ unisonReload: vi.fn() }));
vi.mock('@/instance.js', () => ({ instance: {} }));
vi.mock('@/accounts.js', () => ({ getAccountMenu: vi.fn() }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn() }));
vi.mock('@/utility/device-kind.js', () => ({ deviceKind: 'desktop' }));
vi.mock('@/components/global/MkPageHeader.tabs.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkTabs.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkSwiper.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button type="button"><slot /></button>' } }));
vi.mock('@/components/MkLink.vue', () => ({ default: { template: '<a><slot /></a>' } }));

function renderPage(nested: boolean, component: Component = ErrorPage) {
	const page = defineComponent({
		setup() {
			provideMetadataReceiver(() => {});
			return () => nested ? h(PageWithHeader, null, { default: () => h(component) }) : h(component);
		},
	});
	return render(page, {
		global: {
			directives: { tooltip: {} },
			components: {
				MkPageHeader,
				MkStickyContainer: { template: '<div><slot name="header"/><slot/><slot name="footer"/></div>' },
				MkLoading: { template: '<span role="status">Loading</span>' },
			},
			stubs: { MkAvatar: true, MkUserName: true },
		},
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(cleanup);

describe('page load error navigation', () => {
	test.each([false, true])('keeps one working return while metadata is pending with an ancestor header: %s', async nested => {
		api.mockReturnValue(new Promise(() => {}));
		const view = renderPage(nested);
		expect(view.getByRole('status')).toBeTruthy();
		const buttons = view.getAllByRole('button', { name: i18n.ts.goBack });
		expect(buttons).toHaveLength(1);
		await fireEvent.click(buttons[0]);
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
	});

	test.each([false, true])('keeps one working return after metadata fails with an ancestor header: %s', async nested => {
		let rejectRequest!: (reason: Error) => void;
		api.mockReturnValue(new Promise((resolve, reject) => { rejectRequest = reject; }));
		const view = renderPage(nested);
		rejectRequest(new Error('Offline'));
		await Promise.resolve();
		await nextTick();
		expect(view.queryByRole('status')).toBeNull();
		expect(view.getByText(i18n.ts.serverIsDead)).toBeTruthy();
		const buttons = view.getAllByRole('button', { name: i18n.ts.goBack });
		expect(buttons).toHaveLength(1);
		await fireEvent.click(buttons[0]);
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
	});
});

describe('page loading navigation', () => {
	test.each([false, true])('keeps one working return during page loading with an ancestor header: %s', async nested => {
		const view = renderPage(nested, LoadingPage);
		expect(view.getByRole('status')).toBeTruthy();
		const buttons = view.getAllByRole('button', { name: i18n.ts.goBack });
		expect(buttons).toHaveLength(1);
		await fireEvent.click(buttons[0]);
		expect(goBack).toHaveBeenCalledExactlyOnceWith(mainRouter);
	});
});
