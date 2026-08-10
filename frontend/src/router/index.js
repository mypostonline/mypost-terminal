import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'home',
            component: () => import('@/views/HomeView.vue'),
        },
        {
            path: '/programs',
            name: 'programs',
            component: () => import('@/views/ProgramsView.vue'),
        },
        {
            path: '/programs/:programId',
            name: 'program',
            component: () => import('@/views/ProgramView.vue'),
        },
        {
            path: '/programs/:programId/preorder',
            name: 'preorder',
            component: () => import('@/views/PreorderView.vue'),
        },
        {
            path: '/order/:orderId',
            name: 'order',
            component: () => import('@/views/OrderView.vue'),
        },
    ],
    scrollBehavior(to, from, savedPosition) {
        if (savedPosition) {
            return savedPosition;
        }
        else {
            return { top: 0 };
        }
    }
});

export default router;
