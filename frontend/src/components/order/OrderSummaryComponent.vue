<script setup>
import { computed } from "vue";
import { getPrice } from "@/functions/helpers.js";
import { calculateCashbackAmount } from "@/functions/cashback.js";

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

const cashbackAmount = computed(() => {
    const accruedAmount = Number(props.order?.cashback_amount);
    if (Number.isFinite(accruedAmount) && accruedAmount > 0) {
        return accruedAmount;
    }

    return calculateCashbackAmount(
        props.order?.total_amount,
        props.order?.cashback_percent
    );
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
                <span>Начислено бонусов*</span>
                <span>{{ getPrice(cashbackAmount) }}</span>
            </div>
        </div>
    </div>
    <div
        style="font-size: 0.75rem; font-weight: 500; margin-top: 1rem;"
    >
        *Для зачисления бонусов, сканируй QR-код после оплаты заказа
    </div>
</template>
