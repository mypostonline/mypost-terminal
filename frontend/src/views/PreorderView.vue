<script setup>
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { useOrderStore } from "@/stores/orderStore.js";
import { getPrice } from "@/functions/helpers.js";
import { computed } from "vue";
import CallSupportComponent from "@/components/CallSupportComponent.vue";

const route = useRoute();
const router = useRouter();

const propertyStore = usePropertyStore();
const { isOnline, isNetwork, property, post, program, order } = storeToRefs(propertyStore);

const orderStore = useOrderStore();

const createOrder = async () => {
    const createdOrder = await orderStore.createOrder(order.value);
    if (createdOrder?.id) {
        await router.replace({ path: '/order/' + createdOrder.id });
    }
}

const countAddons = computed(() => property.value.addons?.filter(item => item.isActive).length);

</script>

<template>

    <main>
        <div class="text-center">
            <svg class="__svg" style="fill: var(--green-color); width: 4rem; height: 4rem;">
                <use xlink:href="#clock-waiting"></use>
            </svg>
            <h2 class="mt-4">В заказе</h2>
        </div>
        <div class="order-final-list mt-6">
            <div class="header">
                <div class="title">Итоговый список</div>
            </div>
            <div class="content">
                <div class="label">Режим:</div>
                <div class="item">
                    <span>{{ program.name }}</span>
                    <span>{{ getPrice(program.price) }}</span>
                </div>
                <template v-if="countAddons > 0">
                    <div class="label">Дополнительные услуги:</div>
                    <template v-for="(addon, index) in property.addons">
                        <div v-if="addon.isActive" class="item">
                            <span>{{ addon.name }}</span>
                            <span v-if="!addon.isComposite && !addon.isIncluded">{{ getPrice(addon.price) }}</span>
                        </div>
                    </template>
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
        <div style="font-size: 0.75rem; font-weight: 500; margin-top: 1rem;">
            *Для операций с бонусами оплачивайте через сервис
        </div>
        <div class="mt-6" style="display: grid; grid-template-columns: 1fr 2fr 1fr; align-items: center;">
            <div>
                <router-link :to="`/programs/${program.id}`" class="__button --small" @click="router.back()">
                    <svg class="__svg" style="fill: var(--primary-color); transform: rotate(180deg);">
                        <use xlink:href="#arrow"></use>
                    </svg>
                </router-link>
            </div>
            <div>
                <button class="__button --green" @click="createOrder">
                    Оплатить {{ getPrice(order.total_amount) }}
                </button>
            </div>
        </div>

        <div class="mt-6" style="display: grid; grid-template-columns: 1fr 2fr 1fr; align-items: center;">
            <div></div>
            <div class="text-center">
                <svg class="__svg" style="fill: var(--primary-color); width: 10rem; height: 7rem;">
                    <use xlink:href="#nfc"></use>
                </svg>
            </div>
        </div>

        <div class="mt-6 text-center">
            <call-support-component />
        </div>
        <div class="mt-4 text-center">
            <input type="checkbox" checked disabled>
            Заплатив здесь, вы принимаете условия сервиса, платежного агрегатора и <a
            v-if="property?.proprietor?.public_offer_url" :href="property.proprietor.public_offer_url" target="_blank">оферты</a>
        </div>
    </main>

</template>

<style scoped>

</style>