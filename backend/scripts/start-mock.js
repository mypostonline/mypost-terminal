const path = require('path');
const { loadConfig } = require('../src/config/env');
const { run } = require('../src/server');

const useMockDrivers = config => ({
    ...config,
    cardTerminal: {
        ...config.cardTerminal,
        enabled: true,
        driver: 'mock',
    },
    billAcceptor: {
        ...config.billAcceptor,
        enabled: true,
        driver: 'mock',
        mode: 'mock',
        relay: {
            ...config.billAcceptor.relay,
            enabled: false,
        },
    },
});

if (require.main === module) {
    const config = useMockDrivers(loadConfig({
        envFile: path.resolve(__dirname, '../.env'),
    }));
    run({ config });
}

module.exports = { useMockDrivers };
