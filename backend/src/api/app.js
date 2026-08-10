const path = require('path');
const express = require('express');
const cors = require('cors');
const { registerStatusRoutes } = require('./routes/status');
const {
    registerCardPaymentRoutes,
} = require('./routes/card-payments');
const {
    registerCashPaymentRoutes,
} = require('./routes/cash-payments');

const DEFAULT_STATIC_DIR = path.resolve(
    __dirname,
    '../../../frontend/dist'
);

const createApp = ({
    config,
    services,
    staticDir = DEFAULT_STATIC_DIR,
}) => {
    const app = express();

    app.use(cors({
        origin: config.server.corsOrigin,
        methods: [ 'GET', 'POST', 'OPTIONS' ],
        credentials: true,
    }));
    app.use(express.json());

    registerStatusRoutes(app, services);
    registerCardPaymentRoutes(app, services);
    registerCashPaymentRoutes(app, {
        ...services,
        allowMockInsert: config.billAcceptor.mode === 'mock',
    });

    app.use(express.static(staticDir));
    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(staticDir, 'index.html'));
    });

    return app;
};

module.exports = {
    DEFAULT_STATIC_DIR,
    createApp,
};
