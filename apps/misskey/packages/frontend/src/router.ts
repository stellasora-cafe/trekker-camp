/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { inject, onScopeDispose, shallowReactive, shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { page } from '@/router.definition.js';
import { $i } from '@/i.js';
import { Nirax } from '@/lib/nirax.js';
import { ROUTE_DEF } from '@/router.definition.js';
import { analytics } from '@/analytics.js';
import { DI } from '@/di.js';
import { bindPageHistory, getPageBackState } from '@/utility/page-back.js';

export type Router = Nirax<typeof ROUTE_DEF>;

const routerHistories = new WeakMap<Router, ShallowRef<string[]>>();
const pageBackRoots = new WeakMap<Router, Map<string, Ref<boolean>>>();

function routerPageRoots(router: Router): Map<string, Ref<boolean>> {
	let roots = pageBackRoots.get(router);
	if (!roots) pageBackRoots.set(router, roots = shallowReactive(new Map()));
	return roots;
}

export function createRouter(fullPath: string): Router {
	const router = new Nirax(ROUTE_DEF, fullPath, !!$i, page(() => import('@/pages/not-found.vue')));
	const history = shallowRef([fullPath]);
	routerHistories.set(router, history);
	router.addListener('push', ctx => {
		if (history.value.at(-1) !== ctx.fullPath) history.value = [...history.value, ctx.fullPath];
	});
	router.addListener('replace', ctx => { history.value = [...history.value.slice(0, -1), ctx.fullPath]; });
	return router;
}

export function routerCanGoBack(router: Router): boolean {
	return (routerHistories.get(router)?.value.length ?? 0) > 1;
}

/** A wide settings/admin shell already displays its directory beside the page. */
export function usePageBackRoot(router: Router, path: string, visible: Ref<boolean>): void {
	const roots = routerPageRoots(router);
	roots.set(path, visible);
	onScopeDispose(() => { if (Object.is(roots.get(path), visible)) roots.delete(path); });
}

export function getRouterPageBackState(router: Router): { visible: boolean; fallback: string } {
	const fullPath = router.currentRef.value._parsedRoute.fullPath;
	const state = getPageBackState(fullPath, !!$i);
	const path = fullPath.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
	if ($i && routerPageRoots(router).get(path)?.value) state.visible = false;
	return state;
}

export const mainRouter = createRouter(window.location.pathname + window.location.search + window.location.hash);

const mainHistory = bindPageHistory(mainRouter, window);

mainRouter.addListener('forceReplace', ctx => {
	window.location.replace(ctx.fullPath);
});

mainRouter.addListener('forcePush', ctx => {
	window.location.href = ctx.fullPath;
});

mainRouter.addListener('change', ctx => {
	if (_DEV_) console.log('mainRouter: change', ctx.fullPath);
	analytics.page({
		path: ctx.fullPath,
		title: ctx.fullPath,
	});
});

mainRouter.init();

export function useRouter(): Router {
	return inject(DI.router, null) ?? mainRouter;
}

/** Return through this app's history, keeping direct PWA entries inside the app. */
export function goBack(router: Router = mainRouter): void {
	const { fallback } = getPageBackState(router.getCurrentFullPath(), !!$i);
	if (router === mainRouter) {
		if ($i) mainHistory.back(fallback);
		else mainHistory.replace('/');
	} else {
		const history = routerHistories.get(router);
		if ($i && history && history.value.length > 1) {
			history.value = history.value.slice(0, -1);
			router.replaceByPath(history.value.at(-1)!);
		} else {
			if (!$i && history) history.value = [fallback];
			router.replaceByPath(fallback);
		}
	}
}
