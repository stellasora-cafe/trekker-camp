<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component :is="hasPageHeader ? 'div' : PageWithHeader">
	<MkLoading/>
</component>
</template>

<script lang="ts" setup>
import { inject } from 'vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';

const hasPageHeader = inject('pageHeaderProvided', false);
</script>
