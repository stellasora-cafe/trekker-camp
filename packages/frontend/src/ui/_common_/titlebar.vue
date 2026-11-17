<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.title">
		<img :src="instance.iconUrl || '/favicon.ico'" alt="" :class="$style.instanceIcon"/>
		<span :class="$style.instanceTitle">{{ instance.name ?? host }}</span>
	</div>
	<div :class="$style.controls">
		<span :class="$style.left">
			<button v-if="canBack" type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.goBack" @click="goBack(router)"><i class="ti ti-arrow-left"></i></button>
		</span>
		<span :class="$style.right">
		</span>
	</div>
</div>
</template>

<script lang="ts" setup>
import { host } from '@@/js/config.js';
import { computed } from 'vue';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { goBack, useRouter, getRouterPageBackState } from '@/router.js';

const router = useRouter();
const canBack = computed(() => getRouterPageBackState(router).visible);
</script>

<style lang="scss" module>
.root {
	--height: 36px;

	background: var(--MI_THEME-navBg);
	height: var(--height);
	font-size: 90%;
}

.title {
	display: flex;
	justify-content: center;
	align-items: center;
	text-align: center;
	height: var(--height);
}

.controls {
	position: absolute;
	top: 0;
	left: 0;
	display: flex;
	justify-content: center;
	align-items: center;
	height: var(--height);
}

.instanceIcon {
	display: inline-block;
	width: 20px;
	aspect-ratio: 1;
	border-radius: 5px;
	margin-right: 8px;
}

.instanceTitle {
	display: inline-block;
}

.left {
	margin-right: auto;
}

.right {
	margin-left: auto;
}

.button {
	display: inline-block;
	height: var(--height);
	aspect-ratio: 1;
}
</style>
