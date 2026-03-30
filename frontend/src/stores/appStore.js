import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useAppStore = defineStore('app', () => {
    const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
    const isNetwork = ref(false)
    const networkChecking = ref(false)
    const lastNetworkCheckAt = ref(null)
    const networkError = ref(null)

    let intervalId = null
    let initialized = false

    const healthUrl = 'http://localhost:3000/health'

    const hasConnectionIssues = computed(() => {
        return !isOnline.value || !isNetwork.value
    })

    function updateOnlineStatus() {
        if (typeof navigator === 'undefined') return
        isOnline.value = navigator.onLine
    }

    async function checkNetwork() {
        if (typeof navigator === 'undefined') return false

        updateOnlineStatus()

        if (!isOnline.value) {
            isNetwork.value = false
            networkError.value = 'offline'
            lastNetworkCheckAt.value = Date.now()
            return false
        }

        networkChecking.value = true
        networkError.value = null

        try {
            const response = await fetch(healthUrl, {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                },
            })

            isNetwork.value = response.ok
            networkError.value = response.ok ? null : `http_${response.status}`
        } catch (error) {
            isNetwork.value = false
            networkError.value = error instanceof Error ? error.message : 'network_error'
        } finally {
            networkChecking.value = false
            lastNetworkCheckAt.value = Date.now()
        }

        return isNetwork.value
    }

    async function handleOnline() {
        updateOnlineStatus()
        await checkNetwork()
    }

    function handleOffline() {
        updateOnlineStatus()
        isNetwork.value = false
        networkError.value = 'offline'
        lastNetworkCheckAt.value = Date.now()
    }

    async function initNetworkWatcher() {
        if (typeof window === 'undefined' || initialized) return

        initialized = true

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        await checkNetwork()

        intervalId = window.setInterval(() => {
            checkNetwork()
        }, 60_000)
    }

    function destroyNetworkWatcher() {
        if (typeof window === 'undefined') return

        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)

        if (intervalId) {
            clearInterval(intervalId)
            intervalId = null
        }

        initialized = false
    }



    return {
        isOnline,
        isNetwork,
        networkChecking,
        lastNetworkCheckAt,
        networkError,
        hasConnectionIssues,
        updateOnlineStatus,
        checkNetwork,
        initNetworkWatcher,
        destroyNetworkWatcher,
    }
})