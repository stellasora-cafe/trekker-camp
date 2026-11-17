/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, markRaw, nextTick } from 'vue';
import MkVisitorDashboard from '@/components/MkVisitorDashboard.vue';
import MkOfflineGate from '@/components/MkOfflineGate.vue';
import Visitor from '@/ui/visitor.vue';
import MkPageHeader from '@/components/global/MkPageHeader.vue';
import { openInstanceMenu } from '@/ui/_common_/common.js';
import { desktopWindowMode, openDesktopTool } from '@/utility/desktop-window.js';
import { mainRouter } from '@/router.js';
import { i18n } from '@/i18n.js';
import { offline } from '@/utility/offline.js';
import type { MenuItem, MenuButton, MenuParent } from '@/types/menu.js';

const mocks = vi.hoisted(() => ({ api: vi.fn(), menu: vi.fn(), loggedIn: false }));
vi.mock('@/i.js', () => ({ get $i() { return mocks.loggedIn ? { id: 'test-user', policies: {} } : null; } }));
vi.mock('@/instance.js', () => ({ instance: {
	name: 'Test camp', description: 'A local community', iconUrl: '/favicon.ico',
	clientOptions: {}, policies: { ltlAvailable: true }, federation: 'none',
} }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/utility/offline.js', async () => {
	const { ref } = await import('vue');
	const state = ref(false);
	return { offline: state, maintenanceActive: state, isDesktopClient: () => document.documentElement.dataset.campDesktop === 'true', reconnectingServer: false, reconnectServer: vi.fn() };
});
vi.mock('@/os.js', () => ({ popupMenu: mocks.menu }));
vi.mock('@/accounts.js', () => ({ getAccountMenu: vi.fn() }));
vi.mock('@/utility/device-kind.js', () => ({ deviceKind: 'desktop' }));
vi.mock('@/ui/_common_/common.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkStreamingNotesTimeline.vue', () => ({ default: { template: '<div data-testid="visitor-timeline" />' } }));
vi.mock('@/components/MkVisitorDashboard.ActiveUsersChart.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkNumber.vue', () => ({ default: { template: '<span />' } }));
vi.mock('@/components/MkInfo.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button type="button"><slot /></button>' } }));
vi.mock('@/components/global/MkPageHeader.tabs.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/router.js', async () => {
	const { shallowRef } = await import('vue');
	const { getPageBackState } = await import('@/utility/page-back.js');
	const router = {
		currentRoute: shallowRef({ name: 'about' }),
		currentRef: shallowRef({ route: { path: '/about' }, _parsedRoute: { fullPath: '/about' } }),
		push: vi.fn(),
	};
	return {
		mainRouter: router,
		useRouter: () => router,
		goBack: vi.fn(),
		getRouterPageBackState: () => getPageBackState('/about', false),
	};
});

const global = {
	directives: { tooltip: {} },
	stubs: { MkA: { template: '<a><slot /></a>' }, MkAvatar: true, MkUserName: true },
	components: {
		RouterView: defineComponent({ setup: () => () => h('section', { 'data-testid': 'tool-content' }, h(MkPageHeader)) }),
	},
};

function desktop(mode: 'main' | 'tool' = 'main') {
	document.documentElement.dataset.campDesktop = 'true';
	document.documentElement.dataset.campDesktopWindow = mode;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.loggedIn = false;
	(offline as { value: boolean }).value = false;
	mocks.api.mockResolvedValue({ originalUsersCount: 5, originalNotesCount: 12 });
	delete document.documentElement.dataset.campDesktop;
	delete document.documentElement.dataset.campDesktopWindow;
	delete document.documentElement.dataset.campDesktopGuest;
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('desktop visitor card', () => {
	test('instance menu offers manual updates only inside the desktop host', () => {
		const event = { currentTarget: document.body, target: document.body } as unknown as PointerEvent;
		openInstanceMenu(event);
		expect(mocks.menu.mock.calls[0][0].some((item: MenuItem) => 'text' in item && item.text === i18n.ts._desktop.checkUpdates)).toBe(false);
		desktop();
		mocks.loggedIn = true;
		openInstanceMenu(event);
		expect(mocks.menu.mock.calls[1][0].some((item: MenuItem) => 'text' in item && item.text === i18n.ts._desktop.checkUpdates)).toBe(true);
	});
	test('compact card keeps sign in, registration and a disabled toolbox without fetching visitor activity', () => {
		const view = render(MkVisitorDashboard, { props: { compact: true }, global });
		expect(view.getByRole('button', { name: i18n.ts.login })).toBeTruthy();
		expect(view.getByRole('button', { name: '注册' })).toBeTruthy();
		expect((view.getByRole('button', { name: i18n.ts._desktop.toolboxComingSoon }) as HTMLButtonElement).disabled).toBe(true);
		expect(view.queryByTestId('visitor-timeline')).toBeNull();
		expect(mocks.api).not.toHaveBeenCalled();
	});

	test('ordinary website dashboard retains visitor content', () => {
		const view = render(MkVisitorDashboard, { global });
		expect(view.getByTestId('visitor-timeline')).toBeTruthy();
		expect(view.queryByRole('button', { name: i18n.ts._desktop.toolboxComingSoon })).toBeNull();
		expect(mocks.api).toHaveBeenCalledExactlyOnceWith('stats', {});
	});

	test('desktop main window presents only the compact card and clears its transparency marker on unmount', async () => {
		desktop();
		const view = render(Visitor, { global });
		await view.findByRole('button', { name: i18n.ts._desktop.toolboxComingSoon });
		expect(view.queryByTestId('tool-content')).toBeNull();
		expect(view.queryByTestId('visitor-timeline')).toBeNull();
		expect(document.documentElement.dataset.campDesktopGuest).toBe('true');
		view.unmount();
		expect(document.documentElement.dataset.campDesktopGuest).toBeUndefined();
	});

	test.each([false, true])('desktop tool window stays content-only after login: %s', loggedIn => {
		mocks.loggedIn = loggedIn;
		desktop('tool');
		const view = render(Visitor, { global });
		expect(view.getByTestId('tool-content')).toBeTruthy();
		expect(view.queryByRole('button', { name: i18n.ts.goBack })).toBeNull();
		expect(view.queryByRole('button', { name: i18n.ts.signup })).toBeNull();
		expect(view.container.querySelector('[data-camp-sidebar]')).toBeNull();
		expect(document.documentElement.dataset.campDesktopGuest).toBeUndefined();
	});

	test('ordinary guest pages retain the shared return button', () => {
		const view = render(Visitor, { global });
		expect(view.getByTestId('tool-content')).toBeTruthy();
		expect(view.getByRole('button', { name: i18n.ts.goBack })).toBeTruthy();
	});

	test('offline tools hide their retained content beneath the shared maintenance gate', async () => {
		desktop('tool');
		(offline as { value: boolean }).value = true;
		const view = render(MkOfflineGate, { props: { component: markRaw(Visitor) }, global });
		await nextTick();
		expect(view.getByTestId('tool-content').closest('[inert]')).toBeTruthy();
		expect(view.getByRole('heading', { name: i18n.ts._offline.title })).toBeTruthy();
		expect(view.container.querySelector('dialog')?.open).toBe(true);
	});
});

describe('desktop instance tools', () => {
	function menu() {
		openInstanceMenu({ currentTarget: document.createElement('button') } as unknown as PointerEvent);
		return mocks.menu.mock.calls[0][0] as MenuItem[];
	}

	test('opens main and nested tool menu entries in content-only windows without changing the main route', () => {
		desktop();
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const entries = menu();
		const about = entries.find(item => 'text' in item && item.text === i18n.ts.instanceInfo) as MenuButton;
		about.action(new PointerEvent('click'));
		const tools = entries.find(item => 'type' in item && item.type === 'parent') as MenuParent;
		const scratchpad = (tools.children as MenuItem[]).find(item => 'text' in item && item.text === i18n.ts.scratchpad) as MenuButton;
		scratchpad.action(new PointerEvent('click'));
		expect(open.mock.calls).toEqual([
			[new URL('/about', location.origin).href, 'camp-desktop-tool'],
			[new URL('/scratchpad', location.origin).href, 'camp-desktop-tool'],
		]);
		expect(mainRouter.push).not.toHaveBeenCalled();
	});

	test.each([false, true])('browser or logged-in menus retain normal route links (logged in: %s)', loggedIn => {
		mocks.loggedIn = loggedIn;
		if (loggedIn) desktop();
		const entries = menu();
		expect(entries.find(item => 'text' in item && item.text === i18n.ts.instanceInfo)).toMatchObject({ type: 'link', to: '/about' });
	});

	test('desktop mode is explicit and external URLs cannot enter the tool window', () => {
		expect(desktopWindowMode()).toBe('browser');
		desktop();
		expect(desktopWindowMode()).toBe('main');
		desktop('tool');
		expect(desktopWindowMode()).toBe('tool');
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		openDesktopTool('https://unrelated.example/');
		expect(open).not.toHaveBeenCalled();
	});
});
