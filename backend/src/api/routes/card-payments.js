const { sendServiceError } = require('./errors');

const registerCardPaymentRoutes = (
    app,
    { cardPayments, cardTerminal, allowMockControl = false }
) => {
    const sendCardError = (res, error) => {
        sendServiceError(res, error, 'card_payment_error');
    };

    app.get('/api/card/status', (req, res) => {
        const status = cardPayments.getStatus();
        const requestedSessionId = req.query.sessionId;
        const requestedOrderId = req.query.orderId;

        if (
            (requestedSessionId &&
                status.session?.id !== requestedSessionId) ||
            (requestedOrderId &&
                status.session?.orderId !== String(requestedOrderId))
        ) {
            return res.status(404).json({
                ok: false,
                error: 'card_payment_not_found',
            });
        }

        res.json({
            ok: true,
            ...status,
        });
    });

    app.post('/api/card/start', (req, res) => {
        try {
            const session = cardPayments.start({
                orderId: req.body.orderId,
                amountMinor: Number(req.body.amountMinor),
                productId: req.body.productId,
                productName: req.body.productName,
            });

            res.status(
                [ 'processing', 'canceling', 'finalizing' ].includes(
                    session.state
                )
                    ? 202
                    : 200
            ).json({
                ok: true,
                device: cardPayments.getDeviceStatus(),
                session,
            });
        }
        catch (error) {
            sendCardError(res, error);
        }
    });

    app.post('/api/card/cancel', (req, res) => {
        try {
            const session = cardPayments.cancel({
                sessionId: req.body.sessionId,
                orderId: req.body.orderId,
            });

            res.status(202).json({
                ok: true,
                session,
            });
        }
        catch (error) {
            sendCardError(res, error);
        }
    });

    const requireMockControl = res => {
        if (allowMockControl) {
            return true;
        }

        res.status(404).json({
            ok: false,
            error: 'not_found',
        });
        return false;
    };

    app.post('/api/card/mock/approve', async (req, res) => {
        if (!requireMockControl(res)) {
            return;
        }

        try {
            cardTerminal.simulateApprove(
                req.body.amountMinor === undefined
                    ? undefined
                    : Number(req.body.amountMinor)
            );
            const session = await cardPayments.waitForSettlement();
            res.json({ ok: true, session });
        }
        catch (error) {
            sendCardError(res, error);
        }
    });

    app.post('/api/card/mock/decline', async (req, res) => {
        if (!requireMockControl(res)) {
            return;
        }

        try {
            cardTerminal.simulateDecline('test_declined');
            const session = await cardPayments.waitForSettlement();
            res.json({ ok: true, session });
        }
        catch (error) {
            sendCardError(res, error);
        }
    });

    app.post('/api/pay', (req, res) => {
        res.status(410).json({
            ok: false,
            error: 'endpoint_deprecated',
            message: 'Use /api/card/start with orderId',
        });
    });
};

module.exports = { registerCardPaymentRoutes };
