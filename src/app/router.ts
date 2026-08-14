import { createRouter, createWebHashHistory } from 'vue-router';
const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [{
    path: '/:pathMatch(.*)*',
    component: () => import('../features/compat/CompatScreen.vue'),
  }],
});

export default router;
