const wireEvents = ({
    services,
    broadcast,
    debug = false,
    logger = console,
}) => {
    const {
        cardTerminal,
        billAcceptor,
        cardPayments,
        cashPayments,
    } = services;
    const subscriptions = [];

    const subscribe = (emitter, eventName, handler) => {
        emitter.on(eventName, handler);
        subscriptions.push(() => emitter.off(eventName, handler));
    };

    subscribe(cardTerminal, 'status', event => {
        if (debug) {
            logger.log(new Date().toISOString(), '[Card terminal status]', event);
        }
        broadcast({ channel: 'card-terminal-status', payload: event });
    });

    subscribe(cardTerminal, 'raw', event => {
        if (debug) {
            logger.log(new Date().toISOString(), '[Card terminal raw]', event);
        }
        broadcast({ channel: 'card-terminal-raw', payload: event });
    });

    subscribe(cardTerminal, 'info', message => {
        if (typeof message.stageId === 'number') {
            broadcast({
                channel: 'card-terminal-stage',
                payload: {
                    stageId: message.stageId,
                    stageText: message.stageText,
                },
            });
        }
    });

    subscribe(cardTerminal, 'error', error => {
        logger.error(new Date().toISOString(), '[Card terminal error]', error);
        broadcast({
            channel: 'card-terminal-error',
            payload: { message: error.message },
        });
    });

    subscribe(billAcceptor, 'status', status => {
        broadcast({ channel: 'bill-acceptor-status', payload: status });
    });

    subscribe(billAcceptor, 'error', error => {
        logger.error(
            new Date().toISOString(),
            '[Bill acceptor error]',
            error
        );
        broadcast({
            channel: 'bill-acceptor-error',
            payload: { message: error.message },
        });
    });

    subscribe(billAcceptor, 'pulse', event => {
        broadcast({ channel: 'bill-acceptor-pulse', payload: event });
    });

    subscribe(billAcceptor, 'unexpectedBill', event => {
        logger.error(
            new Date().toISOString(),
            '[Bill acceptor unexpected bill]',
            event
        );
        broadcast({
            channel: 'bill-acceptor-unexpected-bill',
            payload: event,
        });
    });

    subscribe(billAcceptor, 'invalidBill', event => {
        logger.error(
            new Date().toISOString(),
            '[Bill acceptor invalid bill packet]',
            event
        );
        broadcast({
            channel: 'bill-acceptor-invalid-bill',
            payload: event,
        });
    });

    subscribe(billAcceptor, 'diagnostic', event => {
        broadcast({
            channel: 'bill-acceptor-diagnostic',
            payload: event,
        });
    });

    subscribe(cashPayments, 'event', event => {
        if (event.event === 'attention_required' &&
            event.session?.error?.startsWith('cash_fiscalization_')) {
            const session = event.session;
            logger.error(
                session.completedAt || new Date().toISOString(),
                '[Cash fiscalization attention required]',
                JSON.stringify({
                    orderId: session.orderId,
                    sessionId: session.id,
                    vendotekEventNumberAttempted:
                        session.fiscalization?.attemptedEventNumber ?? null,
                    amountMinor: session.fiscalization?.amountMinor ?? null,
                    fiscalizationState: session.fiscalization?.state ?? null,
                    sessionStartedAt: session.createdAt,
                    fiscalizationStartedAt:
                        session.fiscalization?.startedAt ?? null,
                    terminalHost: cardTerminal.getState().host ?? null,
                    terminalDriver: cardTerminal.driver || 'unknown',
                })
            );
        }
        if (event.event === 'completed' &&
            event.session?.fiscalization?.state === 'completed') {
            const session = event.session;
            logger.log(
                session.fiscalization.completedAt || new Date().toISOString(),
                '[Cash fiscalization completed]',
                JSON.stringify({
                    orderId: session.orderId,
                    sessionId: session.id,
                    vendotekEventNumber: session.fiscalization.eventNumber ?? null,
                    vendotekLocalTime:
                        session.fiscalization.vendotekLocalTime ?? null,
                    amountMinor: session.fiscalization.amountMinor,
                    acceptedAmountMinor: session.acceptedAmountMinor,
                    productId: session.productId,
                    productName: session.productName,
                    sessionStartedAt: session.createdAt,
                    fiscalizationStartedAt:
                        session.fiscalization.startedAt ?? null,
                    terminalHost: cardTerminal.getState().host ?? null,
                    terminalDriver: cardTerminal.driver || 'unknown',
                })
            );
        }
        broadcast({ channel: 'cash-payment', payload: event });
    });

    subscribe(cardPayments, 'event', event => {
        if (event.event === 'attention_required' && event.session) {
            const session = event.session;
            logger.error(
                session.completedAt || new Date().toISOString(),
                '[Card payment attention required]',
                JSON.stringify({
                    orderId: session.orderId,
                    sessionId: session.id,
                    vendotekOperationNumberAttempted:
                        session.attemptedOperationNumber ?? null,
                    amountMinor: session.approvedAmountMinor ||
                        session.targetAmountMinor,
                    sessionStartedAt: session.createdAt,
                    approvedAt: session.approvedAt ?? null,
                    terminalHost: cardTerminal.getState().host ?? null,
                    terminalDriver: cardTerminal.driver || 'unknown',
                    errorCode: session.error,
                })
            );
        }
        if (event.event === 'completed' && event.session) {
            const session = event.session;
            logger.log(
                session.completedAt || new Date().toISOString(),
                '[Card payment completed]',
                JSON.stringify({
                    orderId: session.orderId,
                    sessionId: session.id,
                    vendotekOperationNumber: session.operationNumber ?? null,
                    vendotekLocalTime: session.vendotekLocalTime ?? null,
                    amountMinor: session.approvedAmountMinor,
                    productId: session.productId,
                    productName: session.productName,
                    sessionStartedAt: session.createdAt,
                    approvedAt: session.approvedAt ?? null,
                    terminalHost: cardTerminal.getState().host ?? null,
                    terminalDriver: cardTerminal.driver || 'unknown',
                })
            );
        }
        broadcast({ channel: 'card-payment', payload: event });
    });

    return () => {
        for (const unsubscribe of subscriptions.reverse()) {
            unsubscribe();
        }
    };
};

module.exports = { wireEvents };
