<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';

const props = defineProps<{ applyUpdate: () => Promise<void> }>();
const store = useAppStore();
const { updateAvailable, updating, updateStatus } = storeToRefs(store);

async function later() {
  store.postponeUpdate();
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
  <aside
    v-if="updateAvailable"
    class="update-prompt"
    aria-label="Trailbook update ready"
    aria-describedby="update-description"
    aria-live="polite"
    aria-atomic="true"
  >
    <div>
      <strong id="update-title">Update ready</strong>
      <p id="update-description">
        Now or later. This view stays open.
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
  </aside>
  <p
    v-if="updateStatus"
    class="sr-only"
    role="status"
    aria-live="polite"
  >
    {{ updateStatus }}
  </p>
</template>
