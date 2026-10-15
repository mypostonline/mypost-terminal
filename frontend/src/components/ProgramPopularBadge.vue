<template>
    <span class="program-popular-badge" aria-label="Хит">
        <svg viewBox="0 0 16 18" aria-hidden="true" focusable="false">
            <path d="M9.3 1.1c.3 2.1-.8 3.1-1.9 4.3-.5.5-.9 1-1.1 1.6-.4-1-.4-2-.2-2.9C3.4 6.4 2 8.9 2 11.3a6 6 0 0 0 12 0c0-3.2-1.8-5.4-4.7-10.2ZM8 15a2.6 2.6 0 0 1-2.6-2.6c0-1.3.8-2.5 2.3-3.7-.1 1 .3 1.6.9 2.2.7.7 1.8 1.5 1.8 2.5A2.6 2.6 0 0 1 8 15Z" fill="currentColor"/>
        </svg>
        ХИТ
    </span>
</template>

<style scoped>
.program-popular-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
    padding: 0.2rem 0.4rem;
    border-radius: 0.35rem;
    background: #ff6e00;
    color: #fff;
    font-size: 0.625rem;
    font-weight: 800;
    line-height: 1;
    white-space: nowrap;
}

.program-popular-badge svg {
    width: 0.75rem;
    height: 0.85rem;
}
</style>
