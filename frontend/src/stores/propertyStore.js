import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { subscribeMqtt } from '@/functions/mqtt.js';
import api from '@/functions/api.js';
//import { POST_ID, PROPERTY_ID } from '@/config.js';

const PROPERTY_ID = Number(import.meta.env.VITE_PROPERTY_ID);
const POST_ID = Number(import.meta.env.VITE_POST_ID);


export const usePropertyStore = defineStore('propertyStore', () => {

    const isInitialized = ref(false);
    const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
    const isNetwork = ref(false);
    const isLoading = ref(false);
    const isConnect = ref(false);
    const property = ref({});
    const post = ref({});
    const program = ref({});
    const addons = ref([]);
    let intervalId = null;


    const order = computed(() => {
        let result = {
            property_id: property.value.id || 0,
            post_id: post.value.id || 0,
            program_id: program.value.id || 0,
            addons: [],
            amount: 0,
            total_amount: 0,
            payment_method: 'terminal'
        };
        if (program.value?.id) {
            result.amount += Number(program.value.price);
            /*
            addons.value.forEach(addon => {
                console.log( 'addons', addon );
                result.addons.push(addon);
                result.amount += addon.price;
            });
            */
            if (property.value?.addons?.length) {
                property.value.addons.forEach((addon) => {
                    if (addon.isActive) {
                        if (addon.isComposite || addon.isIncluded) {
                            return;
                        }
                        result.addons.push({
                            id: addon.id,
                            quantity: 1,
                        });
                        result.amount += Number(addon.price);
                    }
                });
            }
        }
        result.total_amount = result.amount;
        return result;
    });

    const setProgram = (programId) => {
        if (property.value?.programs?.length) {
            //program.value = property.value.programs.find(i => i.id === parseInt(programId));
            programId = parseInt(programId);
            const findProgram = property.value.programs.find(item => item.id === programId);
            if (findProgram.id) {
                program.value = findProgram;
                if (findProgram?.included_addons?.length && property.value?.addons?.length) {
                    findProgram.included_addons.forEach(addon => {
                        property.value.addons.forEach(item => {
                            if (item.id === addon.id) {
                                item.isActive = true;
                                item.isIncluded = true;
                            }
                        });
                        /*
                        addons.value.push({
                            id: addon.id,
                            name: addon.name,
                            price: addon.price,
                            quantity: 1,
                            isIncluded: true
                        });
                        */
                    });
                }
            }
        }
    }

    const setProperty = (data) => {
        if (property.value.id === undefined) {
            property.value = data;
            if (property.value.id) {
                if (isConnect.value === false) {
                    isConnect.value = true;
                    subscribeMqtt(`/property/${property.value.id}/status`, async data => {
                        await getProperty();
                    });
                }
            }
        }
        if (data.posts?.length) {
            post.value = data.posts.find(i => i.id === POST_ID);
        }
    }

    const getProperty = async () => {
        isLoading.value = true;
        try {
            const response = await api(`/properties/${PROPERTY_ID}`);
            if (response.id) {
                setProperty(response);
                isNetwork.value = true;
            }
            else {
                isNetwork.value = false;
            }
        }
        catch (error) {
            isNetwork.value = false;
        }
        finally {
            isLoading.value = false;
        }
    }


    function updateOnlineStatus () {
        if (typeof navigator === 'undefined') return;
        isOnline.value = navigator.onLine;
    }

    async function handleOnline () {
        updateOnlineStatus();
        await getProperty();
    }

    function handleOffline () {
        updateOnlineStatus();
        isNetwork.value = false;
    }

    const init = async () => {
        if (isInitialized.value === false) {
            window.addEventListener('online', handleOnline);
            window.addEventListener('offline', handleOffline);
            await getProperty();
            isInitialized.value = true;
            intervalId = window.setInterval(() => {
                getProperty();
            }, 60_000);
        }
    }

    const selectAddon = (addon) => {
        if (property.value?.addons?.length) {
            property.value.addons.forEach(item => {
                if (item.id === addon.id) {
                    const isActive = !item.isActive;
                    if (item?.isIncluded) {
                        return;
                    }
                    else if (item?.options?.length > 1) {
                        item.options.forEach(option => {
                            property.value.addons.find(i => {
                                if (i?.options?.length === 1) {
                                    if (i.options[0].id === option.id) {
                                        i.isActive = isActive;
                                        i.isComposite = isActive ? true : undefined;
                                    }
                                }
                            });
                        });
                    }
                    else if (item?.options?.length === 1 && item.isComposite) {
                        return;
                    }
                    item.isActive = isActive;
                }
            });
        }
    }

    const toggleAddonTEST = (addonId) => {
        const addon = property.value?.addons?.find(item => item.id === addonId);
        if (!addon || addon.isIncluded) return;
        if (addon.options?.length === 1 && addon.isComposite) return;
        const isActive = addons.value?.find(item => item.id === addonId);
        if (isActive) {
            if (isActive.isIncluded) {
                return;
            }
            addons.value = addons.value.filter(item => item.id !== addonId);
        }
        else {
            addons.value.push({
                id: addon.id,
                name: addon.name,
                price: addon.price,
                quantity: 1,
            });
        }
    }

    const resetAddons = () => {
        //addons.value = [];
        if (property.value?.addons?.length) {
            property.value.addons.forEach((addon) => {
                if (addon.isActive) {
                    addon.isActive = false;
                    addon.isIncluded = false;
                }
            });
        }
    }

    /*
    const isSupportCalled = ref(false);
    const callSupport = async () => {
        if (isSupportCalled.value !== false) return;
        isSupportCalled.value = true;
        await api(`/properties/${PROPERTY_ID}/callSupport`, { method: 'POST', data: { post_id: POST_ID } });
        setTimeout(() => {
            isSupportCalled.value = false;
        }, 30_000);
    }
    */

    const isSupportCalled = ref(false);
    const secondsLeft = ref(0);
    let timerInterval = null;

    const callSupport = async () => {
        if (isSupportCalled.value) return;
        isSupportCalled.value = true;
        secondsLeft.value = 30;
        try {
            await api(`/properties/${PROPERTY_ID}/callSupport`, {
                method: 'POST',
                data: { post_id: POST_ID }
            });
        }
        catch (err) {
            console.log('callSupport', err);
        }
        timerInterval = setInterval(() => {
            if (secondsLeft.value > 0) {
                secondsLeft.value--;
            }
            else {
                clearInterval(timerInterval);
                isSupportCalled.value = false;
            }
        }, 1000);
    }


    return {
        isInitialized,
        isOnline,
        isNetwork,
        isLoading,
        property,
        post,
        program,
        addons,
        order,
        init,
        setProgram,
        resetAddons,
        selectAddon,
        isSupportCalled,
        callSupport,
        secondsLeft
    }
})
