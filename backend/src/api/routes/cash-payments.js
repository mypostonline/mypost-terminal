const { sendServiceError } = require('./errors');

const registerCashPaymentRoutes = (
    app,
    { cashPayments, allowMockInsert }
) => {
    const sendCashError = (res, error) => {
        sendServiceError(res, error, 'cash_payment_error');
    };

    app.get('/api/cash/status', (req, res) => {
        const status = cashPayments.getStatus();
        const requestedSessionId = req.query.sessionId;

        if (
            requestedSessionId &&
            status.session?.id !== requestedSessionId
        ) {
            return res.status(404).json({
                ok: false,
                error: 'cash_payment_not_found',
            });
        }

        res.json({
            ok: true,
            ...status,
        });
    });

    app.post('/api/cash/start', async (req, res) => {
        try {
            const session = await cashPayments.start({
                orderId: req.body.orderId,
                amountMinor: Number(req.body.amountMinor),
                productId: req.body.productId,
                productName: req.body.productName,
            });

            res.status(201).json({
                ok: true,
                acceptor: cashPayments.getStatus().acceptor,
                session,
            });
        }
        catch (error) {
            sendCashError(res, error);
        }
    });

    app.post('/api/cash/cancel', async (req, res) => {
        try {
            const session = await cashPayments.cancel({
                sessionId: req.body.sessionId,
            });

            res.json({
                ok: true,
                acceptor: cashPayments.getStatus().acceptor,
                session,
            });
        }
        catch (error) {
            sendCashError(res, error);
        }
    });

    app.post('/api/cash/resume', async (req, res) => {
        try {
            const session = await cashPayments.resume({
                sessionId: req.body.sessionId,
            });

            res.json({
                ok: true,
                acceptor: cashPayments.getStatus().acceptor,
                session,
            });
        }
        catch (error) {
            sendCashError(res, error);
        }
    });

    app.post('/api/cash/balance-credit/request', (req, res) => {
        try {
            const session = cashPayments.requestBalanceCredit({
                sessionId: req.body.sessionId,
            });

            res.json({
                ok: true,
                acceptor: cashPayments.getStatus().acceptor,
                session,
            });
        }
        catch (error) {
            sendCashError(res, error);
        }
    });

    app.post('/api/cash/balance-credit/confirm', (req, res) => {
        try {
            const session = cashPayments.confirmBalanceCredit({
                sessionId: req.body.sessionId,
                creditUrl: req.body.creditUrl,
            });

            res.json({
                ok: true,
                acceptor: cashPayments.getStatus().acceptor,
                session,
            });
        }
        catch (error) {
            sendCashError(res, error);
        }
    });

    app.post('/api/cash/release', (req, res) => {
        try {
            const session = cashPayments.release({
                sessionId: req.body.sessionId,
            });

            res.json({
                ok: true,
                acceptor: cashPayments.getStatus().acceptor,
                session,
            });
        }
        catch (error) {
            sendCashError(res, error);
        }
    });

    app.post('/api/cash/mock/insert', (req, res) => {
        if (!allowMockInsert) {
            return res.status(404).json({
                ok: false,
                error: 'not_found',
            });
        }

        try {
            const session = cashPayments.insertMockBill(
                Number(req.body.amountMinor)
            );
            res.json({
                ok: true,
                acceptor: cashPayments.getStatus().acceptor,
                session,
            });
        }
        catch (error) {
            sendCashError(res, error);
        }
    });
};

module.exports = { registerCashPaymentRoutes };
