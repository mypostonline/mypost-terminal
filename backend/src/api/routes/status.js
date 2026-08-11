const registerStatusRoutes = (app, {
    cardPayments,
    cashPayments,
    billAcceptor,
}) => {
    app.get('/api/status', (req, res) => {
        res.json({
            ok: true,
            status: 'backend works',
            cardTerminal: cardPayments.getDeviceStatus(),
            cardPayment: cardPayments.getSession(),
            billAcceptor: billAcceptor.getStatus(),
            cashPayment: cashPayments.getSession(),
        });
    });
};

module.exports = { registerStatusRoutes };
