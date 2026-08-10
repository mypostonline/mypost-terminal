<script setup>
import { ref } from "vue";

defineProps({
    url: {
        type: String,
        required: true,
    },
});

const isOpen = ref(false);
</script>

<template>
    <button
        type="button"
        class="offer-link"
        @click="isOpen = true"
    >
        оферты
    </button>

    <Teleport to="body">
        <div
            v-if="isOpen"
            class="offer-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Публичная оферта"
            @click.self="isOpen = false"
        >
            <div class="offer-modal-content">
                <div class="offer-modal-header">
                    <strong>Публичная оферта</strong>
                    <button
                        type="button"
                        class="__button --small offer-modal-close"
                        aria-label="Закрыть оферту"
                        @click="isOpen = false"
                    >
                        Закрыть
                    </button>
                </div>
                <iframe
                    :src="url"
                    title="Публичная оферта"
                    sandbox="allow-forms allow-same-origin allow-scripts"
                />
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.offer-link {
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    text-decoration: underline;
}

.offer-modal {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 0.75rem;
    background: rgba(11, 28, 47, 0.78);
}

.offer-modal-content {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: min(94vw, 30rem);
    height: 90vh;
    overflow: hidden;
    border-radius: 0.75rem;
    background: #ffffff;
}

.offer-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.65rem;
    border-bottom: 0.08rem solid rgba(34, 64, 98, 0.15);
}

.offer-modal-close {
    width: auto;
    flex-shrink: 0;
}

.offer-modal-content iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #ffffff;
}
</style>
