const http = require('http');
const { loadConfig } = require('./config/env');
const { createServices } = require('./create-services');
const { createApp } = require('./api/app');
const { createWebSocketHub } = require('./realtime/websocket-hub');
const { wireEvents } = require('./realtime/wire-events');

const listen = (server, port) => new Promise((resolve, reject) => {
    const onError = error => {
        server.off('listening', onListening);
        reject(error);
    };
    const onListening = () => {
        server.off('error', onError);
        resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
});

const closeHttpServer = server => new Promise((resolve, reject) => {
    if (!server.listening) {
        resolve();
        return;
    }

    server.close(error => {
        if (error) {
            reject(error);
            return;
        }
        resolve();
    });
});

const createBackend = ({
    config = loadConfig(),
    logger = console,
    staticDir,
} = {}) => {
    const services = createServices(config);
    const app = createApp({ config, services, staticDir });
    const server = http.createServer(app);
    const realtime = createWebSocketHub({
        server,
        path: '/ws',
        getInitialMessages: () => [
            {
                channel: 'card-payment-snapshot',
                payload: services.cardPayments.getStatus(),
            },
            {
                channel: 'cash-payment-snapshot',
                payload: services.cashPayments.getStatus(),
            },
        ],
    });
    const unwireEvents = wireEvents({
        services,
        broadcast: realtime.broadcast,
        debug: config.debug,
        logger,
    });

    let started = false;
    let stopPromise = null;

    const startDevices = async () => {
        const vendotekRequired =
            config.cardTerminal.enabled ||
            config.cashPayment.fiscalizationEnabled;

        if (vendotekRequired) {
            try {
                await services.cardTerminal.start();
                logger.log(
                    new Date().toISOString(),
                    `Vendotek driver=${config.cardTerminal.driver} ready`
                );
            }
            catch (error) {
                logger.error(
                    new Date().toISOString(),
                    'Vendotek start failed:',
                    error.message
                );
            }
        }
        else {
            logger.log(
                new Date().toISOString(),
                'Vendotek integrations disabled'
            );
        }

        try {
            const relayStatus = await services.billAcceptorRelay.start();
            logger.log(
                new Date().toISOString(),
                `Bill acceptor relay state=${relayStatus.state}`
            );
        }
        catch (error) {
            logger.error(
                new Date().toISOString(),
                'Bill acceptor relay start failed:',
                error.message
            );
        }

        try {
            const status = await services.billAcceptor.start();
            logger.log(
                new Date().toISOString(),
                `Bill acceptor mode=${status.mode} state=${status.state}`
            );
        }
        catch (error) {
            logger.error(
                new Date().toISOString(),
                'Bill acceptor start failed:',
                error.message
            );
        }
    };

    const start = async () => {
        if (started) {
            return runtime;
        }

        await listen(server, config.server.port);
        started = true;
        logger.log(
            new Date().toISOString(),
            `Server started on http://127.0.0.1:${config.server.port}`
        );
        await startDevices();
        return runtime;
    };

    const stop = () => {
        if (stopPromise) {
            return stopPromise;
        }

        stopPromise = (async () => {
            services.cardTerminal.close();
            await services.billAcceptor.stop();
            await services.billAcceptorRelay.close();
            unwireEvents();
            await realtime.close();
            await closeHttpServer(server);
            started = false;
        })();

        return stopPromise;
    };

    const runtime = {
        app,
        config,
        realtime,
        server,
        services,
        start,
        stop,
    };

    return runtime;
};

const startBackend = async options => {
    const backend = createBackend(options);
    await backend.start();
    return backend;
};

module.exports = {
    closeHttpServer,
    createBackend,
    startBackend,
};
