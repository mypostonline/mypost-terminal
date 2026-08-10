import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'src/assets/fonts/**',
        ],
    },
    js.configs.recommended,
    ...pluginVue.configs['flat/essential'],
    {
        files: [ '**/*.{js,vue}' ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'off',
            'vue/multi-word-component-names': 'off',
        },
    },
];
