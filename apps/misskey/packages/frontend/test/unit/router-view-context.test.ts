/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, inject } from 'vue';
import type { Router } from '@/router.js';
import RouterView from '@/components/global/RouterView.vue';
import StackingRouterView from '@/components/global/StackingRouterView.vue';
import NestedRouterView from '@/components/global/NestedRouterView.vue';
import { Nirax } from '@/lib/nirax.js';
import { DI } from '@/di.js';

vi.mock('@/pages/_loading_.vue', async () => {
	const { defineComponent, h, inject } = await import('vue');
	const { DI } = await import('@/di.js');
	return { default: defineComponent({
		setup() {
			const router = inject(DI.router)!;
			return () => h('div', { 'data-testid': 'loading-route' }, router.getCurrentFullPath());
		},
	}) };
});

const Child = defineComponent({
	setup() {
		const router = inject(DI.router)!;
		const depth = inject(DI.routerCurrentDepth);
		return () => h('button', {
			type: 'button',
			onClick: () => router.replaceByPath('/section/second'),
		}, `${router.getCurrentFullPath()} depth ${depth}`);
	},
});

const Section = defineComponent({
	setup() {
		return () => h('section', { 'data-testid': 'section-root' }, [h(NestedRouterView)]);
	},
});

function createRouter(path: string): Router {
	const router = new Nirax([
		{ path: '/main', component: Child },
		{ path: '/section', component: Section, children: [
			{ path: '/first', component: Child },
			{ path: '/second', component: Child },
		] },
	], path, true, Child);
	router.init();
	return router as Router;
}

function context(router: Router, depth: number) {
	return { provide: { [DI.router as symbol]: router, [DI.routerCurrentDepth as symbol]: depth } };
}

afterEach(cleanup);

const rootViews = [{ name: 'RouterView', Component: RouterView }, { name: 'StackingRouterView', Component: StackingRouterView }];

describe('router view context', () => {
	test.each(rootViews)('isolates an explicit router and its nested depth in $name', async ({ Component }) => {
		const outer = createRouter('/main');
		const embedded = createRouter('/section/first');
		const view = render(Component, { props: { router: embedded }, global: context(outer, 3) });
		await fireEvent.click(view.getByRole('button', { name: '/section/first depth 2' }));
		expect(view.getByRole('button', { name: '/section/second depth 2' })).toBeTruthy();
		expect(embedded.getCurrentFullPath()).toBe('/section/second');
		expect(outer.getCurrentFullPath()).toBe('/main');
	});

	test.each(rootViews)('resets root depth when a window has already provided its explicit router in $name', ({ Component }) => {
		const router = createRouter('/section/first');
		const view = render(Component, { props: { router }, global: context(router, 3) });
		expect(view.getByRole('button', { name: '/section/first depth 2' })).toBeTruthy();
	});

	test('resets the nested view when explicitly switching to a different router', () => {
		const outer = createRouter('/main');
		const embedded = createRouter('/section/first');
		const view = render(NestedRouterView, { props: { router: embedded }, global: context(outer, 3) });
		expect(view.getByTestId('section-root')).toBeTruthy();
		expect(view.getByRole('button', { name: '/section/first depth 2' })).toBeTruthy();
	});

	test.each([false, true])('preserves same-router nesting when explicit is %s', explicit => {
		const router = createRouter('/section/first');
		const view = render(NestedRouterView, { props: explicit ? { router } : {}, global: context(router, 1) });
		expect(view.queryByTestId('section-root')).toBeNull();
		expect(view.getByRole('button', { name: '/section/first depth 2' })).toBeTruthy();
	});

	test.each([...rootViews, { name: 'NestedRouterView', Component: NestedRouterView }])('keeps the loading page inside the correct router while $name is suspended', ({ Component }) => {
		const Pending = defineComponent({
			async setup() {
				await new Promise<void>(() => {});
				return () => h('div');
			},
		});
		const router = new Nirax([{ path: '/pending', component: Pending }], '/pending', true, Child) as Router;
		router.init();
		const outer = createRouter('/main');
		const view = render(Component, { props: { router }, global: context(outer, 3) });
		expect(view.getByTestId('loading-route').textContent).toBe('/pending');
	});
});
