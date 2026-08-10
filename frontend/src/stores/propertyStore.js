import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { subscribeMqtt } from '@/functions/mqtt.js';
import api from '@/functions/api.js';

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
    const configurationError = ref(
        CONFIGURATION_VALID
            ? ''
            : 'Не заданы корректные VITE_PROPERTY_ID и VITE_POST_ID'
    );

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
            addons: [],
            amount: 0,
            total_amount: 0,
            source: 'terminal',
        };

        if (program.value?.id) {
            result.amount += asMoney(program.value.price);

            property.value.addons?.forEach(addon => {
                if (
                    addon.isActive &&
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

        result.total_amount = result.amount;
        return result;
    });

    const resetAddons = () => {
        property.value.addons?.forEach(addon => {
            addon.isActive = false;
            addon.isIncluded = false;
            addon.isComposite = false;
        });
    };

    const applyIncludedAddons = selectedProgram => {
        if (
            !selectedProgram?.included_addons?.length ||
            !property.value.addons?.length
        ) {
            return;
        }

        const includedIds = new Set(
            selectedProgram.included_addons.map(addon => addon.id)
        );
        property.value.addons.forEach(addon => {
            if (includedIds.has(addon.id)) {
                addon.isActive = true;
                addon.isIncluded = true;
            }
        });
    };

    const setProgram = programId => {
        const id = Number.parseInt(programId, 10);
        const selectedProgram = property.value.programs?.find(
            item => item.id === id
        );

        if (!selectedProgram) {
            program.value = {};
            return false;
        }

        program.value = selectedProgram;
        applyIncludedAddons(selectedProgram);
        return true;
    };

    const preserveAddonState = nextAddons => {
        const currentState = new Map(
            (property.value.addons || []).map(addon => [
                addon.id,
                {
                    isActive: addon.isActive,
                    isIncluded: addon.isIncluded,
                    isComposite: addon.isComposite,
                },
            ])
        );

        return (nextAddons || []).map(addon => ({
            ...addon,
            ...(currentState.get(addon.id) || {}),
        }));
    };

    const setProperty = data => {
        const selectedProgramId = program.value?.id;
        property.value = {
            ...data,
            addons: preserveAddonState(data.addons),
        };
        post.value = data.posts?.find(item => item.id === POST_ID) || null;

        if (selectedProgramId) {
            const refreshedProgram = property.value.programs?.find(
                item => item.id === selectedProgramId
            );
            program.value = refreshedProgram || {};
        }

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
            item => item.id === addon.id
        );
        if (!selectedAddon || selectedAddon.isIncluded) {
            return;
        }
        if (
            selectedAddon.options?.length === 1 &&
            selectedAddon.isComposite
        ) {
            return;
        }

        const isActive = !selectedAddon.isActive;

        if (selectedAddon.options?.length > 1) {
            selectedAddon.options.forEach(option => {
                const childAddon = property.value.addons.find(candidate => {
                    return candidate.options?.length === 1 &&
                        candidate.options[0].id === option.id;
                });
                if (childAddon) {
                    childAddon.isActive = isActive;
                    childAddon.isComposite = isActive;
                }
            });
        }

        selectedAddon.isActive = isActive;
    };

    const startSupportCooldown = () => {
        if (supportTimer) {
            window.clearInterval(supportTimer);
        }

        secondsLeft.value = 30;
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
        order,
        configurationError,
        init,
        getProperty,
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
