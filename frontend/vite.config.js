import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
    server: {
        allowedHosts: ['formlessly-surpassing-gecko.cloudpub.ru'],
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:3001',
            },
            '/ws': {
                target: 'ws://127.0.0.1:3001',
                ws: true,
            },
        },
    },
    plugins: [
        vue(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    mqtt: ['mqtt'],
                    splide: ['@splidejs/vue-splide'],
                    vue: ['vue', 'vue-router', 'pinia'],
                },
            },
        },
    },
    test: {
        environment: 'jsdom',
        restoreMocks: true,
    },
})
