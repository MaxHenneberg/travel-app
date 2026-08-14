<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';

const root = useTemplateRef<HTMLElement>('root');
let dispose: (() => void) | undefined;

onMounted(async () => {
  const legacy = await import('./runtime') as unknown as {
    initializeLegacyApp(root: HTMLElement): () => void;
  };
  const { initializeLegacyApp } = legacy;
  if (root.value) dispose = initializeLegacyApp(root.value);
});

onBeforeUnmount(() => dispose?.());
</script>

<template>
  <div
    ref="root"
    class="legacy-app"
  />
</template>
