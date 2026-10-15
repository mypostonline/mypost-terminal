import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { subscribeMqtt } from '@/functions/mqtt.js';
import api from '@/functions/api.js';
import { deriveAddonSelection } from '@/functions/addonSelection.js';
import {
    calculateCashbackAmount,
    getCashbackLoyalty,
} from '@/functions/cashback.js';

const PROPERTY_ID = Number(import.meta.env.VITE_PROPERTY_ID);
const POST_ID = Number(import.meta.env.VITE_POST_ID);
const CONFIGURATION_VALID =
    Number.isInteger(PROPERTY_ID) &&
    PROPERTY_ID > 0 &&
    Number.isInteger(POST_ID) &&
    POST_ID > 0;

const asMoney = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

export const usePropertyStore = defineStore('propertyStore', () => {
    const isInitialized = ref(false);
    const isOnline = ref(
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );
    const isNetwork = ref(false);
    const isLoading = ref(false);
    const property = ref({});
    const post = ref(null);
    const program = ref({});
    const hasAdditionalServices = computed(() => Boolean(
        property.value.is_dry_open && property.value.addons?.length
    ));
    const configurationError = ref(
        CONFIGURATION_VALID
            ? ''
            : 'Не заданы корректные VITE_PROPERTY_ID и VITE_POST_ID'
    );
    let selectedAddonIds = new Set();

    const syncAddons = () => {
        if (Array.isArray(property.value.addons)) {
            property.value.addons = deriveAddonSelection(
                property.value.addons,
                program.value,
                selectedAddonIds
            );
        }
    };

    const supportState = ref('idle');
    const supportError = ref('');
    const secondsLeft = ref(0);
    const isSupportCalled = computed(() => {
        return [ 'calling', 'sent' ].includes(supportState.value);
    });

    let propertySubscriptionStarted = false;
    let supportTimer = null;

    const order = computed(() => {
        const result = {
            property_id: property.value.id || 0,
            post_id: post.value?.id || 0,
            program_id: program.value.id || 0,
            loyalty_id: null,
            addons: [],
            cashback_percent: 0,
            cashback_amount: 0,
            amount: 0,
            total_amount: 0,
            source: 'terminal',
        };

        if (program.value?.id) {
            result.amount += asMoney(program.value.price);

            property.value.addons?.forEach(addon => {
                if (
                    addon.isActive &&
                    !addon.isExcluded &&
                    !addon.isComposite &&
                    !addon.isIncluded
                ) {
                    result.addons.push({
                        id: addon.id,
                        quantity: 1,
                    });
                    result.amount += asMoney(addon.price);
                }
            });
        }

        const cashbackLoyalty = getCashbackLoyalty(
            property.value.loyalties
        );
        if (cashbackLoyalty) {
            result.loyalty_id = cashbackLoyalty.id;
            result.cashback_percent = asMoney(cashbackLoyalty.percent);
        }

        result.total_amount = result.amount;
        result.cashback_amount = calculateCashbackAmount(
            result.total_amount,
            result.cashback_percent
        );
        return result;
    });

    const resetAddons = () => {
        selectedAddonIds = new Set();
        syncAddons();
    };

    const setProgram = programId => {
        const selectedProgram = property.value.programs?.find(
            item => String(item.id) === String(programId)
        );

        selectedAddonIds = new Set();
        if (!selectedProgram) {
            program.value = {};
            syncAddons();
            return false;
        }

        program.value = selectedProgram;
        syncAddons();
        return true;
    };

    const setProperty = data => {
        const sameProperty = String(property.value?.id) === String(data?.id);
        const selectedProgramId = sameProperty ? program.value?.id : null;
        if (!sameProperty) {
            selectedAddonIds = new Set();
        }
        property.value = data;
        post.value = data.posts?.find(item => item.id === POST_ID) || null;
        program.value = property.value.programs?.find(
            item => String(item.id) === String(selectedProgramId)
        ) || {};
        const availableIds = new Set((property.value.addons || []).map(addon => String(addon.id)));
        selectedAddonIds = new Set([...selectedAddonIds].filter(id => availableIds.has(id)));
        syncAddons();
        selectedAddonIds = new Set([...selectedAddonIds].filter(id => {
            const addon = property.value.addons?.find(item => String(item.id) === id);
            return addon && !addon.isExcluded && !addon.isIncluded;
        }));

        if (property.value.id && !propertySubscriptionStarted) {
            propertySubscriptionStarted = true;
            subscribeMqtt(
                `/property/${property.value.id}/status`,
                () => getProperty()
            ).catch(error => {
                propertySubscriptionStarted = false;
                console.error('Failed to subscribe to property updates', error);
            });
        }
    };

    const getProperty = async () => {
        if (!CONFIGURATION_VALID || isLoading.value) {
            return null;
        }

        isLoading.value = true;
        try {
            const response = await api(`/properties/${PROPERTY_ID}`);
            if (!response?.id) {
                isNetwork.value = false;
                return null;
            }

            setProperty(response);
            isNetwork.value = true;
            configurationError.value = post.value
                ? ''
                : `Пост ${POST_ID} не найден`;
            return response;
        }
        catch (error) {
            isNetwork.value = false;
            console.error('Failed to load property', error);
            return null;
        }
        finally {
            isLoading.value = false;
        }
    };

    const updateOnlineStatus = () => {
        if (typeof navigator !== 'undefined') {
            isOnline.value = navigator.onLine;
        }
    };

    const handleOnline = async () => {
        updateOnlineStatus();
        await getProperty();
    };

    const handleOffline = () => {
        updateOnlineStatus();
        isNetwork.value = false;
    };

    const init = async () => {
        if (isInitialized.value) {
            return;
        }

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        await getProperty();
        isInitialized.value = true;
        window.setInterval(getProperty, 60_000);
    };

    const selectAddon = addon => {
        const selectedAddon = property.value.addons?.find(
            item => String(item.id) === String(addon?.id)
        );
        if (!program.value?.id || !selectedAddon || selectedAddon.isIncluded ||
            selectedAddon.isExcluded || selectedAddon.isComposite) {
            return;
        }

        const id = String(selectedAddon.id);
        if (selectedAddonIds.has(id)) {
            selectedAddonIds.delete(id);
        } else {
            selectedAddonIds.add(id);
        }
        syncAddons();
    };

    const startSupportCooldown = () => {
        if (supportTimer) {
            window.clearInterval(supportTimer);
        }

        secondsLeft.value = 9;
        supportTimer = window.setInterval(() => {
            secondsLeft.value -= 1;
            if (secondsLeft.value <= 0) {
                window.clearInterval(supportTimer);
                supportTimer = null;
                supportState.value = 'idle';
            }
        }, 1_000);
    };

    const callSupport = async () => {
        if (isSupportCalled.value) {
            return false;
        }
        if (!post.value?.id) {
            supportState.value = 'error';
            supportError.value =
                'Пост не настроен, автоматический вызов недоступен';
            return false;
        }

        supportState.value = 'calling';
        supportError.value = '';

        try {
            await api(`/properties/${PROPERTY_ID}/callSupport`, {
                method: 'POST',
                data: { post_id: POST_ID },
            });
            supportState.value = 'sent';
            startSupportCooldown();
            return true;
        }
        catch (error) {
            console.error('Failed to call support', error);
            supportState.value = 'error';
            supportError.value =
                'Не удалось вызвать оператора. Нажмите, чтобы повторить';
            secondsLeft.value = 0;
            return false;
        }
    };

    return {
        isInitialized,
        isOnline,
        isNetwork,
        isLoading,
        property,
        post,
        program,
        hasAdditionalServices,
        order,
        configurationError,
        init,
        getProperty,
        setProperty,
        setProgram,
        resetAddons,
        selectAddon,
        supportState,
        supportError,
        isSupportCalled,
        callSupport,
        secondsLeft,
    };
});
