import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../stores/auth';
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('../pages/Login.vue') },
    { path: '/', redirect: '/tickets' },
    { path: '/tickets', component: () => import('../pages/Tickets.vue') },
    { path: '/tickets/:id', component: () => import('../pages/TicketDetail.vue') },
    { path: '/assistant', component: () => import('../pages/Assistant.vue') },
    { path: '/knowledge', component: () => import('../pages/Knowledge.vue') },
    { path: '/knowledge/:id', component: () => import('../pages/Document.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/tickets' },
  ],
});
router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.ready) await auth.restore();
  if (!auth.user && to.path !== '/login') return '/login';
  if (auth.user && to.path === '/login') return '/tickets';
});
window.addEventListener('session-expired', () => {
  const auth = useAuth();
  auth.user = null;
  if (auth.ready) void router.push('/login');
});
