<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps({
    label: {
        type: String,
        default: 'Действия на странице',
    },
});

const panel = ref(null);
const panelHeight = ref('6rem');
let resizeObserver = null;

onMounted(() => {
    const updateHeight = () => {
        panelHeight.value = `${Math.ceil(panel.value.getBoundingClientRect().height)}px`;
    };

    updateHeight();
    resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(panel.value);
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
});
</script>

<template>
    <!-- Reserve the actual panel height, including wrapped labels and errors. -->
    <div
        class="fixed-actions-spacer"
        :style="{ height: panelHeight }"
        aria-hidden="true"
    />
    <Teleport to="body">
        <nav ref="panel" class="fixed-actions" :aria-label="label">
            <div v-if="$slots.notice" class="fixed-actions-notice">
                <slot name="notice" />
            </div>
            <div class="fixed-actions-layout">
                <div class="fixed-actions-side">
                    <slot name="leading" />
                </div>
                <div class="fixed-actions-items">
                    <!-- Wrap each action in a div if it also renders a status message. -->
                    <slot />
                </div>
                <div class="fixed-actions-side">
                    <slot name="trailing" />
                </div>
            </div>
        </nav>
    </Teleport>
</template>

<style scoped>
.fixed-actions-spacer {
    flex-shrink: 0;
}

.fixed-actions {
    --fixed-actions-side-size: clamp(48px, 2.75rem, 96px);
    position: fixed;
    z-index: 50;
    inset: auto 0 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
}

.fixed-actions-layout {
    display: grid;
    grid-template-columns: var(--fixed-actions-side-size) minmax(0, 1fr) var(--fixed-actions-side-size);
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    max-width: 1080px;
    margin-inline: auto;
    padding: 0.65rem max(1rem, env(safe-area-inset-right, 0px))
        0.65rem max(1rem, env(safe-area-inset-left, 0px));
    box-sizing: border-box;
}

.fixed-actions-items {
    --button-min-width: 13rem;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: center;
    gap: 0.5rem;
    min-width: 0;
}

.fixed-actions-side {
    min-width: 0;
}

.fixed-actions-notice {
    max-width: 1080px;
    margin-inline: auto;
    padding: 0.65rem max(1rem, env(safe-area-inset-right, 0px))
        0 max(1rem, env(safe-area-inset-left, 0px));
    box-sizing: border-box;
    overflow-wrap: anywhere;
}

.fixed-actions-items > :deep(*) {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
}

.fixed-actions-layout :deep(.__button) {
    width: var(--button-width, auto);
    max-width: 100%;
    min-width: var(--button-min-width, 0);
    min-height: var(--fixed-actions-side-size);
    padding: 0 0.5rem;
    font-size: clamp(16px, 0.9rem, 32px);
    line-height: 1.25;
    white-space: normal;
}

.fixed-actions-side :deep(.__button) {
    width: var(--fixed-actions-side-size);
    height: var(--fixed-actions-side-size);
    min-height: var(--fixed-actions-side-size);
    padding: 0;
    font-size: clamp(20px, 1rem, 36px);
}

.fixed-actions-layout :deep(.__button:disabled) {
    opacity: 0.4;
}

.fixed-actions-layout :deep(.__button .__svg) {
    flex-shrink: 0;
    fill: currentColor;
}

.fixed-actions-layout :deep(.__button .__svg.--back) {
    transform: rotate(180deg);
}

.fixed-actions-layout :deep(.__button:focus-visible) {
    outline: 2px solid var(--primary-color);
    outline-offset: 3px;
}
</style>
