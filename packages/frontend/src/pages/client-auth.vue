<!--
SPDX-FileCopyrightText: trekker-camp contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main :class="$style.container">
	<section :class="$style.card" aria-labelledby="client-auth-title">
		<header :class="$style.header">
			<div :class="$style.brand">
				<img :src="iconFailed ? '/favicon.ico' : (instance.iconUrl || '/favicon.ico')" alt="" width="36" height="36" @error="iconFailed = true"/>
				<span>{{ instance.name || instanceName }}</span>
			</div>
			<h1 id="client-auth-title">{{ i18n.ts._clientSessions.browserAuthorize }}</h1>
			<p v-if="status === 'pending'">{{ $i ? i18n.ts._clientSessions.browserAuthorizeDescription : i18n.ts._clientSessions.authorizationSignIn }}</p>
		</header>
		<div :class="$style.content">
			<MkSignin v-if="!$i" :class="$style.signin" autoSet/>
			<div v-else-if="loading" :class="$style.result" role="status"><MkLoading/><p>{{ i18n.ts.loading }}</p></div>
			<div v-else-if="status !== 'pending'" :class="$style.result" role="status">
				<i :class="['ti', status === 'approved' ? 'ti-circle-check' : status === 'failed' ? 'ti-alert-circle' : 'ti-circle-x', $style.resultIcon, { [$style.success]: status === 'approved' }]" aria-hidden="true"></i>
				<h2>{{ resultTitle }}</h2>
				<p>{{ resultDescription }}</p>
				<MkButton v-if="status === 'failed'" rounded primary @click="loadRequest">{{ i18n.ts.retry }}</MkButton>
			</div>
			<template v-else-if="request">
				<div :class="$style.device">
					<strong>{{ request.name }}</strong>
					<dl>
						<template v-if="request.platform">
							<dt>{{ i18n.ts._clientSessions.platform }}</dt><dd>{{ request.platform }}</dd>
						</template>
						<dt>{{ i18n.ts._clientSessions.expiresAt }}</dt><dd><MkTime :time="request.expiresAt" mode="detail"/></dd>
					</dl>
				</div>
				<MkAuthConfirm :class="$style.confirmation" :name="request.name" :waitOnDeny="true" :manualWaiting="deciding" @accept="approve" @deny="deny"/>
			</template>
		</div>
	</section>
</main>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import MkAuthConfirm from '@/components/MkAuthConfirm.vue';
import MkButton from '@/components/MkButton.vue';
import MkSignin from '@/components/MkSignin.vue';
import { instance } from '@/instance.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useStream } from '@/stream.js';

const props = defineProps<{ requestId: string }>();
const request = ref<{ name: string; platform: string; expiresAt: string } | null>(null);
const loading = ref(true);
const status = ref<'pending' | 'approved' | 'denied' | 'expired' | 'failed'>('pending');
const deciding = ref(false);
const iconFailed = ref(false);
const controller = new AbortController();
let active = true;
let fetching = false;

const resultTitle = computed(() => status.value === 'approved' ? i18n.ts._auth.accepted : status.value === 'denied' ? i18n.ts._auth.denied : i18n.ts.error);
const resultDescription = computed(() => ({
	approved: i18n.ts._clientSessions.authorizationComplete,
	denied: i18n.ts._clientSessions.authorizationDenied,
	expired: i18n.ts._clientSessions.requestExpired,
	failed: i18n.ts._clientSessions.authorizationFailed,
})[status.value as 'approved' | 'denied' | 'expired' | 'failed']);

async function loadRequest() {
	if (!$i || !active || fetching || deciding.value) return;
	fetching = true;
	loading.value = true;
	status.value = 'pending';
	try {
		const result = await misskeyApi('client-auth/show', { requestId: props.requestId }, undefined, controller.signal);
		if (!active) return;
		request.value = result;
	} catch (error) {
		if (active) status.value = (error as { code?: string })?.code === 'CLIENT_AUTHORIZATION_EXPIRED' ? 'expired' : 'failed';
	} finally {
		fetching = false;
		if (active) loading.value = false;
	}
}

function retryAfterReconnect() {
	if (!request.value && (status.value === 'failed' || status.value === 'pending')) void loadRequest();
}

onMounted(() => {
	void loadRequest();
	useStream().on('_reconnected_', retryAfterReconnect);
});
onUnmounted(() => {
	active = false;
	controller.abort();
	useStream().off('_reconnected_', retryAfterReconnect);
});

async function decide(token: string, decision: 'allow' | 'deny') {
	if (!active || deciding.value || status.value !== 'pending') return;
	deciding.value = true;
	try {
		await misskeyApi('client-auth/approve', { requestId: props.requestId, decision }, token, controller.signal);
		if (active) status.value = decision === 'allow' ? 'approved' : 'denied';
	} catch (error) {
		if (active) status.value = (error as { code?: string })?.code === 'CLIENT_AUTHORIZATION_EXPIRED' ? 'expired' : 'failed';
	} finally {
		if (active) deciding.value = false;
	}
}

function approve(token: string) { return decide(token, 'allow'); }

function deny(token: string) { return decide(token, 'deny'); }

definePage(() => ({ title: i18n.ts._clientSessions.browserAuthorize, icon: 'ti ti-device-desktop' }));
</script>

<style lang="scss" module>
.container {
	min-height: 100svh;
	padding: var(--MI-margin) var(--MI-margin) calc(env(safe-area-inset-bottom, 0px) + var(--MI-margin));
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--MI_THEME-bg);
}

.card {
	width: 100%;
	max-width: 480px;
	min-width: 0;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	box-shadow: 0 8px 32px var(--MI_THEME-shadow);
	overflow: clip;
}

.header {
	padding: calc(var(--MI-margin) * 1.5);
	border-bottom: 1px solid var(--MI_THEME-divider);

	h1 { margin: var(--MI-margin) 0 0; font-size: 1.3em; font-weight: 600; }
	p { margin: var(--MI-marginHalf) 0 0; font-size: 0.9em; line-height: 1.6; color: var(--MI_THEME-fgTransparentWeak); }
}

.brand {
	display: flex;
	align-items: center;
	gap: var(--MI-marginHalf);
	font-weight: 600;

	img { border-radius: var(--MI-radius); object-fit: contain; }
}

.content {
	padding: calc(var(--MI-margin) * 1.5);
}

.signin > div:first-child {
	min-height: 280px;
}

.device {
	padding: var(--MI-margin);
	margin-bottom: var(--MI-margin);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	font-size: 0.85em;
	overflow-wrap: anywhere;

	dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--MI-marginHalf) var(--MI-margin); margin: var(--MI-marginHalf) 0 0; }
	dt { color: var(--MI_THEME-fgTransparentWeak); }
	dd { margin: 0; }
}

.confirmation {
	height: auto;

	> div:first-child { padding: 0; }
}

.result {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--MI-margin);
	padding: var(--MI-margin) 0;
	text-align: center;

	h2 { margin: 0; font-size: 1.1em; font-weight: 600; }
	p { margin: 0; line-height: 1.6; color: var(--MI_THEME-fgTransparentWeak); }
}

.resultIcon {
	font-size: 40px;
	color: var(--MI_THEME-warn);
}

.success {
	color: var(--MI_THEME-success);
}

@media (max-width: 400px) {
	.header, .content { padding: var(--MI-margin); }
}
</style>
