/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable import/no-default-export */
import { onBeforeUnmount } from 'vue';
import type { StoryObj } from '@storybook/vue3';
import MkDesktopTitlebar from './MkDesktopTitlebar.vue';

export const Default = {
	render: () => ({
		components: { MkDesktopTitlebar },
		setup() {
			const data = window.document.documentElement.dataset;
			const original = { desktop: data.campDesktop, chrome: data.campWindowChrome };
			data.campDesktop = 'true';
			data.campWindowChrome = 'true';
			onBeforeUnmount(() => {
				if (original.desktop === undefined) delete data.campDesktop;
				else data.campDesktop = original.desktop;
				if (original.chrome === undefined) delete data.campWindowChrome;
				else data.campWindowChrome = original.chrome;
			});
		},
		template: '<div class="_campWindowHeader" data-camp-window-drag><MkDesktopTitlebar/></div>',
	}),
} satisfies StoryObj<typeof MkDesktopTitlebar>;
