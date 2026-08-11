const { VtkClient } = require('./devices/vendotek/client');
const { MockCardTerminal } = require('./devices/card-terminal/mock-client');
const { BillAcceptorClient } = require('./devices/bill-acceptor/client');
const { CardPaymentService } = require('./payments/card/service');
const { CashPaymentService } = require('./payments/cash/service');
const {
    CashChangeCreditService,
} = require('./payments/cash/change-credit');

const createServices = config => {
    const cardTerminal = config.cardTerminal.driver === 'mock'
        ? new MockCardTerminal({ debug: config.debug })
        : new VtkClient({
            host: config.vendotek.host,
            port: config.vendotek.port,
            waitStaBeforeVrp: false,
            paymentWaitSec: config.vendotek.paymentWaitSec,
            debug: config.debug,
        });

    const billAcceptor = new BillAcceptorClient({
        mode: config.billAcceptor.mode,
        gpioChip: config.billAcceptor.gpioChip,
        gpioLine: config.billAcceptor.gpioLine,
        rubPerPulse: config.billAcceptor.rubPerPulse,
        debounceMs: config.billAcceptor.debounceMs,
        packetGapMs: config.billAcceptor.packetGapMs,
        maxPacketTimeMs: config.billAcceptor.maxPacketTimeMs,
        validAmountsRub: config.billAcceptor.validAmountsRub,
        gpiomonCommand: config.billAcceptor.gpiomonCommand,
        debug: config.debug,
    });

    const cardPayments = new CardPaymentService({
        terminal: cardTerminal,
        enabled: config.cardTerminal.enabled,
        debug: config.debug,
    });

    const cashChangeCredit = new CashChangeCreditService({
        urlTemplate: config.cashPayment.changeCreditUrlTemplate,
        tokenSecret: config.cashPayment.changeCreditTokenSecret,
        tokenTtlSec: config.cashPayment.changeCreditTokenTtlSec,
    });

    const cashPayments = new CashPaymentService({
        acceptor: billAcceptor,
        sessionTimeoutSec: config.cashPayment.timeoutSec,
        changeCreditService: cashChangeCredit,
        debug: config.debug,
    });

    return {
        cardTerminal,
        billAcceptor,
        cashChangeCredit,
        cardPayments,
        cashPayments,
    };
};

module.exports = { createServices };
