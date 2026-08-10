import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePaymentStore } from '@/stores/paymentStore.js';

export function useInactivity(msTimeout = 60_000) {
    const route = useRoute();
    const router = useRouter();
    const paymentStore = usePaymentStore();
    const timer = ref(null);

    const resetTimer = () => {
        clearTimeout(timer.value);
        timer.value = setTimeout(async () => {
            if (
                route.name !== 'home' &&
                !paymentStore.isNavigationLocked
            ) {
                await router.replace({ path: '/' });
            }
        }, msTimeout);
    };

    onMounted(() => {
        const events = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'scroll'];
        events.forEach(event => {
            window.addEventListener(event, resetTimer);
        });
        resetTimer();
    });

    onUnmounted(() => {
        const events = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'scroll'];
        events.forEach(event => {
            window.removeEventListener(event, resetTimer);
        });
        clearTimeout(timer.value);
    });
}
