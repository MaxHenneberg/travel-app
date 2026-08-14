<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useAppLifecycle } from '../composables/useAppLifecycle';
import { useHeavyFeatures } from '../composables/useHeavyFeatures';

useAppLifecycle();
useHeavyFeatures();
</script>

<template><RouterView /></template>
