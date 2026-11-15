/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable import/no-default-export */
import { markRaw } from 'vue';
import type { StoryObj } from '@storybook/vue3';
import MkOfflineGate from './MkOfflineGate.vue';
import MkOfflineNotice from './MkOfflineNotice.vue';

export const Default = {
	render: args => ({ components: { MkOfflineGate }, setup: () => ({ args }), template: '<MkOfflineGate v-bind="args"/>' }),
	args: { component: markRaw(MkOfflineNotice) },
} satisfies StoryObj<typeof MkOfflineGate>;
