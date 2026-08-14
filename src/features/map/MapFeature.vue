<script setup lang="ts">
defineProps<{ href: string }>();
</script>
<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
  >Open in Google Maps</a>
</template>
