<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main :class="[$style.root, { [$style.desktop]: desktop }]">
	<h1 v-if="desktop" id="desktop-auth-title" class="_campWindowHeader" :class="$style.title" data-camp-window-drag>{{ title }}</h1>
	<section :class="$style.card" aria-labelledby="desktop-auth-title">
		<h1 v-if="!desktop" id="desktop-auth-title" :class="$style.title">{{ title }}</h1>
		<template v-if="signup">
			<MkSignupForm v-if="acceptedRules" autoSet @signupEmailPending="close"/>
			<MkSignupRules v-else @done="acceptedRules = true" @cancel="close"/>
		</template>
		<template v-else>
			<div v-if="browserBusy" :class="$style.browserWaiting">
				<MkLoading v-if="browserState !== 'waiting'"/>
				<i v-else class="ti ti-external-link" :class="$style.browserIcon" aria-hidden="true"></i>
				<p role="status">{{ browserMessage }}</p>
				<MkButton v-if="browserState === 'waiting'" rounded @click="browserLogin.reopen()">{{ i18n.ts._desktop.browserLoginReopen }}</MkButton>
				<MkButton v-if="browserState !== 'signingIn'" transparent @click="browserLogin.cancel()">{{ i18n.ts.cancel }}</MkButton>
			</div>
			<template v-else>
				<MkSignin :class="$style.signin" :initialUsername="username" autoSet/>
				<div v-if="desktop" :class="$style.browserActions">
					<p v-if="browserError" role="alert">{{ browserError }}</p>
					<MkButton full rounded @click="browserLogin.start()"><i class="ti ti-external-link" aria-hidden="true"></i> {{ i18n.ts._desktop.browserLogin }}</MkButton>
				</div>
			</template>
		</template>
	</section>
</main>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkSignin from '@/components/MkSignin.vue';
import MkSignupForm from '@/components/MkSignupDialog.form.vue';
import MkSignupRules from '@/components/MkSignupDialog.rules.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { desktopWindowMode } from '@/utility/desktop-window.js';
import { createBrowserLogin } from '@/utility/browser-login.js';

const props = defineProps<{
	mode?: string;
	username?: string;
}>();

const signup = computed(() => props.mode === 'signup');
const title = computed(() => signup.value ? i18n.ts.signup : i18n.ts.login);
const acceptedRules = ref(false);
const desktop = desktopWindowMode() !== 'browser';
const browserLogin = createBrowserLogin();
const browserState = browserLogin.state;
const browserBusy = computed(() => ['starting', 'waiting', 'signingIn'].includes(browserState.value));
const browserMessage = computed(() => browserState.value === 'waiting' ? i18n.ts._desktop.browserLoginWaiting : browserState.value === 'signingIn' ? i18n.ts.loggingIn : i18n.ts.loading);
const browserError = computed(() => ({
	denied: i18n.ts._desktop.browserLoginDenied,
	expired: i18n.ts._desktop.browserLoginExpired,
	failed: i18n.ts._desktop.browserLoginFailed,
})[browserState.value as 'denied' | 'expired' | 'failed']);

watch(signup, () => {
	acceptedRules.value = false;
	browserLogin.cancel();
});

onBeforeUnmount(browserLogin.dispose);

function close() {
	window.close();
}

definePage(() => ({
	title: title.value,
	icon: signup.value ? 'ti ti-user-plus' : 'ti ti-login',
}));
</script>

<style lang="scss" module>
.root {
	box-sizing: border-box;
	min-height: 100%;
	padding: var(--MI-margin);
}

.card {
	max-width: 500px;
	margin: 0 auto;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgOnPanel);
	overflow: clip;
}

.title {
	margin: 0;
	padding: 24px;
	font-size: 1.2em;
	font-weight: 600;
}

.signin {
	padding: 0 24px 24px;
}

.desktop {
	padding: 0;
	.title {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--camp-window-controls-width, 16px) 0 var(--MI-margin);
	}
	.card { margin: var(--MI-margin) auto; }
	.signin { padding: 0 var(--MI-margin) var(--MI-margin); }
	.signin > div:first-child { min-height: 250px; }
}

.browserActions {
	padding: 0 var(--MI-margin) var(--MI-margin);

	p {
		margin: 0 0 var(--MI-marginHalf);
		color: var(--MI_THEME-error);
		font-size: 0.85em;
	}
}

.browserWaiting {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--MI-margin);
	min-height: 300px;
	padding: var(--MI-margin);
	text-align: center;

	p { margin: 0; }
}

.browserIcon { color: var(--MI_THEME-accent); font-size: 40px; }
</style>
