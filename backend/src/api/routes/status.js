const registerStatusRoutes = (app, {
    cardPayments,
    cashPayments,
    billAcceptor,
}) => {
    app.get('/api/status', (req, res) => {
        res.json({
            ok: true,
            status: 'backend works',
            vendotek: cardPayments.getDeviceStatus(),
            cardPayment: cardPayments.getSession(),
            billAcceptor: billAcceptor.getStatus(),
            cashPayment: cashPayments.getSession(),
        });
    });
};

module.exports = { registerStatusRoutes };
