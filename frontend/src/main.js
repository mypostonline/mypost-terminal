import './assets/css/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';
import { usePaymentStore } from '@/stores/paymentStore.js';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
const paymentStore = usePaymentStore(pinia);

router.beforeEach((to, from) => {
    const isInitialNavigation = from.matched.length === 0;
    const isActivePaymentRoute =
        to.name === 'order' &&
        paymentStore.matchesOrder(to.params.orderId);

    if (
        isInitialNavigation &&
        paymentStore.isNavigationLocked &&
        paymentStore.orderId &&
        !isActivePaymentRoute
    ) {
        return {
            name: 'order',
            params: { orderId: paymentStore.orderId },
        };
    }

    if (isInitialNavigation && to.name !== 'home') {
        const canRecoverPayment =
            to.name === 'order' &&
            paymentStore.isRecoverableOrder(to.params.orderId);
        if (!canRecoverPayment) {
            return { name: 'home' };
        }
    }

    if (paymentStore.isNavigationLocked && !isActivePaymentRoute) {
        return false;
    }

    if (
        from.name === 'order' &&
        to.fullPath !== from.fullPath &&
        paymentStore.isNavigationLocked
    ) {
        return false;
    }

    return true;
});

app.use(router);

app.mount('#app');
