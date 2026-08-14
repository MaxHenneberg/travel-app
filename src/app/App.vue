<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useAppLifecycle } from '../composables/useAppLifecycle';
import { useHeavyFeatures } from '../composables/useHeavyFeatures';
import { requestPwaUpdate, usePwaUpdatePrompt } from '../pwa/update';
import UpdatePrompt from './UpdatePrompt.vue';

useAppLifecycle();
useHeavyFeatures();
usePwaUpdatePrompt();
</script>

<template>
  <RouterView />
  <UpdatePrompt :apply-update="requestPwaUpdate" />
</template>
