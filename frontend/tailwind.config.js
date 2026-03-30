export default {
    content: [],
    theme: {
        extend: {
            gridTemplateColumns: {
                'max-3': 'repeat(auto-fit, minmax(15rem, 1fr))',
            }
        },
    },
    plugins: [],
    corePlugins: {
        container: false,
        preflight: false,
    },
};