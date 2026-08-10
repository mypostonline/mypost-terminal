<script setup>
import { computed } from "vue";
import { getPrice } from "@/functions/helpers.js";

const props = defineProps({
    order: {
        type: Object,
        required: true,
    },
});

const program = computed(() => {
    return props.order?.items?.find(item => item.program_id);
});

const addons = computed(() => {
    return props.order?.items?.filter(item => item.addon_id) || [];
});
</script>

<template>
    <div class="order-final-list mt-6">
        <div class="header">
            <div class="title">Итоговый список</div>
        </div>
        <div class="content">
            <template v-if="program">
                <div class="label">Режим:</div>
                <div class="item">
                    <span>{{ program.name }}</span>
                    <span>{{ getPrice(program.price) }}</span>
                </div>
            </template>
            <template v-if="addons.length">
                <div class="label">Дополнительные услуги:</div>
                <div v-for="addon in addons" :key="addon.id" class="item">
                    <span>{{ addon.name }}</span>
                    <span>{{ getPrice(addon.price) }}</span>
                </div>
            </template>
            <div class="item label" style="color: var(--green-color);">
                <span>Итого:</span>
                <span>{{ getPrice(order.total_amount) }}</span>
            </div>
        </div>
        <div class="footer">
            <div class="item">
                <span>Зачислено бонусов*</span>
                <span>{{ getPrice(0) }}</span>
            </div>
        </div>
    </div>
</template>
