<script setup lang="ts">
import { nextTick, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';

const props = defineProps<{ applyUpdate: () => Promise<void> }>();
const store = useAppStore();
const { updateAvailable, updating, updateStatus } = storeToRefs(store);
let previousFocus: HTMLElement | null = null;

watch(updateAvailable, async (available) => {
  if (!available) return;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  document.querySelector<HTMLElement>('[data-update-now]')?.focus();
});

async function later() {
  store.postponeUpdate();
  await nextTick();
  previousFocus?.focus();
}

async function updateNow() {
  store.beginUpdate();
  try {
    await props.applyUpdate();
    store.finishUpdate();
  } catch {
    store.failUpdate();
  }
}
</script>

<template>
  <section
    v-if="updateAvailable"
    class="update-prompt"
    role="dialog"
    aria-labelledby="update-title"
    aria-describedby="update-description"
  >
    <div>
      <strong id="update-title">Trailbook update ready</strong>
      <p id="update-description">
        Update to the complete new version now, or keep using this version until later.
      </p>
    </div>
    <div class="update-actions">
      <button
        data-update-now
        class="button primary"
        type="button"
        :disabled="updating"
        @click="updateNow"
      >
        Update now
      </button>
      <button
        class="button subtle"
        type="button"
        :disabled="updating"
        @click="later"
      >
        Later
      </button>
    </div>
  </section>
  <p
    v-if="updateStatus"
    class="sr-only"
    role="status"
    aria-live="polite"
  >
    {{ updateStatus }}
  </p>
</template>
