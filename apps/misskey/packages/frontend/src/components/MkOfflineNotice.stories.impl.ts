/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import MkOfflineNotice from './MkOfflineNotice.vue';

export const Default = {
	render: args => ({ components: { MkOfflineNotice }, setup: () => ({ args }), template: '<div style="width: min(720px, 100%)"><MkOfflineNotice v-bind="args"/></div>' }),
	args: {},
} satisfies StoryObj<typeof MkOfflineNotice>;

export const Narrow = {
	...Default,
	render: args => ({ components: { MkOfflineNotice }, setup: () => ({ args }), template: '<div style="width: 320px"><MkOfflineNotice v-bind="args"/></div>' }),
} satisfies StoryObj<typeof MkOfflineNotice>;
