const wireEvents = ({
    services,
    broadcast,
    debug = false,
    logger = console,
}) => {
    const {
        vendotek,
        billAcceptor,
        cardPayments,
        cashPayments,
    } = services;
    const subscriptions = [];

    const subscribe = (emitter, eventName, handler) => {
        emitter.on(eventName, handler);
        subscriptions.push(() => emitter.off(eventName, handler));
    };

    subscribe(vendotek, 'status', event => {
        if (debug) {
            logger.log(new Date().toISOString(), '[Vendotek status]', event);
        }
        broadcast({ channel: 'vendotek-status', payload: event });
    });

    subscribe(vendotek, 'raw', event => {
        if (debug) {
            logger.log(new Date().toISOString(), '[Vendotek raw]', event);
        }
        broadcast({ channel: 'vendotek-raw', payload: event });
    });

    subscribe(vendotek, 'info', message => {
        if (typeof message.stageId === 'number') {
            broadcast({
                channel: 'vendotek-stage',
                payload: {
                    stageId: message.stageId,
                    stageText: message.stageText,
                },
            });
        }
    });

    subscribe(vendotek, 'error', error => {
        logger.error(new Date().toISOString(), '[Vendotek error]', error);
        broadcast({
            channel: 'vendotek-error',
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
        broadcast({ channel: 'cash-payment', payload: event });
    });

    subscribe(cardPayments, 'event', event => {
        broadcast({ channel: 'card-payment', payload: event });
    });

    return () => {
        for (const unsubscribe of subscriptions.reverse()) {
            unsubscribe();
        }
    };
};

module.exports = { wireEvents };
