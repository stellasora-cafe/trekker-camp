<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.wrapper">
	<div class="_gaps" :class="$style.root">
		<div class="_gaps_s">
			<div :class="$style.passkeyIcon">
				<i class="ti ti-fingerprint"></i>
			</div>
			<div :class="$style.passkeyDescription">{{ i18n.ts.useSecurityKey }}</div>
		</div>

		<div v-if="failed" role="status" :class="$style.passkeyDescription">{{ i18n.ts.passkeyVerificationFailed }}</div>
		<MkButton large primary rounded :disabled="queryingKey" style="margin: 0 auto;" @click="retry">{{ i18n.ts.retry }}</MkButton>

		<MkButton v-if="isPerformingPasswordlessLogin !== true" transparent rounded style="margin: 0 auto;" @click="useTotp">{{ i18n.ts.useTotp }}</MkButton>
	</div>
</div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';

import { i18n } from '@/i18n.js';

import MkButton from '@/components/MkButton.vue';

import type { PublicKeyCredentialRequestOptionsJSON, AuthenticationResponseJSON } from '@simplewebauthn/browser';

const props = defineProps<{
	credentialRequest: PublicKeyCredentialRequestOptionsJSON;
	isPerformingPasswordlessLogin?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'done', credential: AuthenticationResponseJSON): void;
	(ev: 'useTotp'): void;
	(ev: 'retry'): void;
}>();

const queryingKey = ref(true);
const failed = ref(false);
let active = true;

function retry(): void {
	if (queryingKey.value) return;
	emit('retry');
}

function useTotp(): void {
	active = false;
	if (queryingKey.value) WebAuthnAbortService.cancelCeremony();
	queryingKey.value = false;
	emit('useTotp');
}

async function queryKey() {
	queryingKey.value = true;
	failed.value = false;
	try {
		const credential = await startAuthentication({ optionsJSON: props.credentialRequest });
		if (active) emit('done', credential);
	} catch (err) {
		const name = err instanceof Error ? err.name : undefined;
		failed.value = active && name !== 'AbortError' && name !== 'NotAllowedError';
	} finally {
		queryingKey.value = false;
	}
}

onMounted(() => {
	void queryKey();
});

watch(() => props.credentialRequest, () => {
	if (active) void queryKey();
});

onBeforeUnmount(() => {
	active = false;
	if (queryingKey.value) WebAuthnAbortService.cancelCeremony();
});
</script>

<style lang="scss" module>
.wrapper {
	display: flex;
	align-items: center;
	width: 100%;
	min-height: 336px;

	> .root {
		width: 100%;
	}
}

.passkeyIcon {
	margin: 0 auto;
	background-color: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	text-align: center;
	height: 64px;
	width: 64px;
	font-size: 24px;
	line-height: 64px;
	border-radius: 50%;
}

.passkeyDescription {
	text-align: center;
	font-size: 1.1em;
}
</style>
