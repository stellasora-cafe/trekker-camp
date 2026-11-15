<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-if="customChrome && isClientAuthorization" class="_campWindowHeader" data-camp-window-drag></div>
	<XEmailVerificationBanner v-if="!isClientAuthorization"/>
	<RouterView/>

	<XCommon/>
</div>
</template>

<script lang="ts" setup>
import { computed, provide, ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import XCommon from './_common_/common.vue';
import XEmailVerificationBanner from './_common_/email-verification-banner.vue';
import type { PageMetadata } from '@/page.js';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { mainRouter } from '@/router.js';
import { DI } from '@/di.js';
import { hasDesktopWindowChrome } from '@/utility/desktop-window.js';

const isRoot = computed(() => mainRouter.currentRoute.value.name === 'index');
const customChrome = hasDesktopWindowChrome();
const isClientAuthorization = computed(() => mainRouter.currentRoute.value.name === 'client-auth');

const pageMetadata = ref<null | PageMetadata>(null);

provide(DI.router, mainRouter);
provideMetadataReceiver((metadataGetter) => {
	const info = metadataGetter();
	pageMetadata.value = info;
	if (pageMetadata.value) {
		if (isRoot.value && pageMetadata.value.title === instanceName) {
			window.document.title = pageMetadata.value.title;
		} else {
			window.document.title = `${pageMetadata.value.title} | ${instanceName}`;
		}
	}
});
provideReactiveMetadata(pageMetadata);
</script>

<style lang="scss" module>
.root {
	position: relative;
	height: 100dvh;
}
</style>
