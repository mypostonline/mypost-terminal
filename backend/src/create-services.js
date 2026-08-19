const { VtkClient } = require('./devices/vendotek/client');
const { MockCardTerminal } = require('./devices/card-terminal/mock-client');
const { BillAcceptorClient } = require('./devices/bill-acceptor/client');
const {
    HttpRelayGate,
} = require('./devices/bill-acceptor/http-relay-gate');
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

    const billAcceptorRelay = new HttpRelayGate({
        enabled: config.billAcceptor.relay.enabled,
        url: config.billAcceptor.relay.url,
        leaseMs: config.billAcceptor.relay.leaseMs,
        renewIntervalMs:
            config.billAcceptor.relay.renewIntervalMs,
        requestTimeoutMs:
            config.billAcceptor.relay.requestTimeoutMs,
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
        acceptanceGate: billAcceptorRelay,
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
        billTimeoutSec: config.cashPayment.billTimeoutSec,
        partialDecisionTimeoutSec:
            config.cashPayment.partialDecisionTimeoutSec,
        changeCreditService: cashChangeCredit,
        fiscalizer: cardTerminal,
        fiscalizationEnabled:
            config.cashPayment.fiscalizationEnabled,
        fiscalProductId: config.cashPayment.fiscalProductId,
        fiscalProductName: config.cashPayment.fiscalProductName,
        debug: config.debug,
    });

    return {
        cardTerminal,
        billAcceptor,
        billAcceptorRelay,
        cashChangeCredit,
        cardPayments,
        cashPayments,
    };
};

module.exports = { createServices };
