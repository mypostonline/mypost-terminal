import { createRouter, createWebHistory } from 'vue-router';

import HomeView from '@/views/HomeView.vue';
import ProgramsView from '@/views/ProgramsView.vue';
import ProgramView from '@/views/ProgramView.vue';
import PreorderView from "@/views/PreorderView.vue";
import OrderView from "@/views/OrderView.vue";

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeView,
        },
        {
            path: '/programs',
            name: 'programs',
            component: ProgramsView,
        },
        {
            path: '/programs/:programId',
            name: 'program',
            component: ProgramView,
        },
        {
            path: '/programs/:programId/preorder',
            name: 'preorder',
            component: PreorderView,
        },
        {
            path: '/order/:orderId',
            name: 'order',
            component: OrderView,
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
