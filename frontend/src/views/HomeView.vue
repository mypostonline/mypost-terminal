<script setup>
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";
import BannersComponent from "@/components/BannersComponent.vue";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import { isPostAcceptingOrders } from "@/config/postAvailability.js";

const VITE_QR_SRC = import.meta.env.VITE_QR_SRC;

const propertyStore = usePropertyStore();
const {
    isInitialized,
    isOnline,
    isNetwork,
    post,
    configurationError,
} = storeToRefs(propertyStore);

</script>

<template>

    <main>
        <banners-component />
        <div class="scan-qr">
            <h1 class="title">Сканируй QR-код,<br> Ваш терминал в телефоне!</h1>
            <div class="scan-qr-items">
                <div class="items">
                    <div>
                        <svg class="__svg">
                            <use xlink:href="#phone"></use>
                        </svg>
                        <span>Весь сервис — в вашем телефоне</span>
                    </div>
                    <div>
                        <svg class="__svg">
                            <use xlink:href="#history"></use>
                        </svg>
                        <span>История и чеки</span>
                    </div>
                    <div>
                        <svg class="__svg">
                            <use xlink:href="#loyalty"></use>
                        </svg>
                        <span>Акции и система лояльности</span>
                    </div>
                    <div>
                        <svg class="__svg">
                            <use xlink:href="#schedule"></use>
                        </svg>
                        <span>Статус и режим работы</span>
                    </div>
                </div>
                <div class="qr">
                    <img :src="VITE_QR_SRC" alt="QR-код мобильного сервиса">
                </div>
            </div>
        </div>
        <template v-if="post?.id && isOnline && isNetwork">
            <div class="post">
                <div class="post-actions">
                    <div>
                        <router-link
                            v-if="isPostAcceptingOrders(post)"
                            to="/programs"
                            class="__button"
                        >
                            Начать
                        </router-link>
                        <div v-else class="post-unavailable">
                            Пост временно недоступен
                        </div>
                    </div>
                    <div>
                        <call-support-component />
                    </div>
                </div>
                <div class="post-info">
                    <div class="post-status">
                        <template v-if="post.status === 'online'">
                            <svg class="__svg shape" style="fill: #2AB74D;">
                                <use xlink:href="#shape"></use>
                            </svg>
                            <svg class="__svg face">
                                <use xlink:href="#smiley-face"></use>
                            </svg>
                        </template>
                        <template v-else-if="post.status === 'busy'">
                            <svg class="__svg shape" style="fill: #FFBB00;">
                                <use xlink:href="#shape"></use>
                            </svg>
                            <!--
                            <div class="post-timer">99 мин</div>
                            -->
                        </template>
                        <template v-else-if="post.status === 'offline'">
                            <svg class="__svg shape" style="fill: #E8541E;">
                                <use xlink:href="#shape"></use>
                            </svg>
                            <svg class="__svg face">
                                <use xlink:href="#frowny-face"></use>
                            </svg>
                        </template>
                    </div>
                </div>
            </div>
        </template>
        <template v-else-if="isInitialized && (!isOnline || !isNetwork)">
            <div class="backoff">
                <div class="image">
                    <svg class="__svg" style="fill: #E8541E;">
                        <use xlink:href="#offline"></use>
                    </svg>
                </div>
                <div class="description">
                    Отсутствует интернет-соединение
                </div>
            </div>
        </template>
        <template v-else-if="isInitialized">
            <div class="backoff">
                <div class="image">
                    <svg class="__svg" style="fill: #E8541E;">
                        <use xlink:href="#offline"></use>
                    </svg>
                </div>
                <div class="description">
                    {{
                        configurationError ||
                        'Пост временно недоступен'
                    }}
                </div>
            </div>
        </template>
    </main>

</template>

<style scoped>
.post-unavailable {
    padding: 0.65rem;
    border-radius: 0.65rem;
    color: #9e3211;
    background: #fff5f1;
    font-size: 0.65rem;
    font-weight: 600;
    text-align: center;
}
</style>
