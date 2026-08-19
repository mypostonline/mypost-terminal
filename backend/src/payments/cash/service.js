const EventEmitter = require('events');
const { randomUUID } = require('crypto');

const ACTIVE_STATES = new Set([ 'preparing', 'accepting' ]);
const UNRESOLVED_STATES = new Set([
    ...ACTIVE_STATES,
    'fiscalizing',
    'partial_payment',
    'balance_credit_required',
]);
const REUSABLE_STATES = new Set([
    ...UNRESOLVED_STATES,
    'completed',
    'attention_required',
]);

class CashPaymentError extends Error {
    constructor (message, { code = 'cash_payment_error', statusCode = 400 } = {}) {
        super(message);
        this.name = 'CashPaymentError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

class CashPaymentService extends EventEmitter {
    constructor ({
        acceptor,
        billTimeoutSec = 120,
        partialDecisionTimeoutSec = 600,
        changeCreditService = null,
        fiscalizer = null,
        fiscalizationEnabled = false,
        fiscalProductId = 1,
        fiscalProductName = 'WASH',
        debug = false,
    }) {
        super();

        if (!acceptor) {
            throw new Error('Bill acceptor is required');
        }
        const timeoutEntries = [
            [ 'billTimeoutSec', billTimeoutSec ],
            [ 'partialDecisionTimeoutSec', partialDecisionTimeoutSec ],
        ];
        for (const [ name, value ] of timeoutEntries) {
            if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
                throw new Error(`${name} must be positive`);
            }
        }

        this.acceptor = acceptor;
        this.changeCreditService = changeCreditService;
        this.fiscalizer = fiscalizer;
        this.fiscalizationEnabled = Boolean(fiscalizationEnabled);
        this.fiscalProductId = fiscalProductId;
        this.fiscalProductName = fiscalProductName;

        if (
            this.fiscalizationEnabled &&
            typeof this.fiscalizer?.registerCashSale !== 'function'
        ) {
            throw new Error(
                'Cash fiscalizer with registerCashSale() is required'
            );
        }
        this.billTimeoutMs = Number(billTimeoutSec) * 1000;
        this.partialDecisionTimeoutMs =
            Number(partialDecisionTimeoutSec) * 1000;
        this.debug = debug;
        this.session = null;
        this.sessionTimer = null;
        this.partialDecisionTimer = null;
        this.fiscalizationPromise = null;

        this.acceptor.on('bill', event => this.handleAcceptedBill(event));
        this.acceptor.on('invalidBill', event => this.handleInvalidBill(event));
        this.acceptor.on('error', error => this.handleAcceptorError(error));
    }

    log (...args) {
        if (this.debug) {
            console.log(new Date().toISOString(), '[Cash payment]', ...args);
        }
    }

    getSession () {
        if (!this.session) {
            return null;
        }

        return {
            ...this.session,
            bills: this.session.bills.map(bill => ({ ...bill })),
            changeCredit: this.session.changeCredit
                ? { ...this.session.changeCredit }
                : null,
            balanceCredit: this.session.balanceCredit
                ? { ...this.session.balanceCredit }
                : null,
            fiscalization: this.session.fiscalization
                ? { ...this.session.fiscalization }
                : null,
        };
    }

    getFiscalizationStatus () {
        if (!this.fiscalizationEnabled) {
            return {
                enabled: false,
                available: false,
                driver: this.fiscalizer?.driver || null,
                state: 'disabled',
                busy: false,
            };
        }

        const terminal = this.fiscalizer.getState();
        const busy = Boolean(
            terminal.operationActive ||
            terminal.paymentInProgress ||
            terminal.cashSaleInProgress
        );
        const available = Boolean(
            terminal.connected &&
            terminal.handshaked &&
            terminal.terminalState === 'idle' &&
            !busy
        );

        return {
            enabled: true,
            available,
            driver: this.fiscalizer.driver || 'unknown',
            state: terminal.terminalState,
            connected: Boolean(terminal.connected),
            handshaked: Boolean(terminal.handshaked),
            busy,
        };
    }

    getStatus () {
        return {
            acceptor: this.acceptor.getStatus(),
            fiscalization: this.getFiscalizationStatus(),
            session: this.getSession(),
        };
    }

    emitSession (event) {
        const payload = {
            event,
            session: this.getSession(),
        };

        this.log(event, payload.session);
        this.emit('event', payload);
        return payload;
    }

    clearSessionTimer () {
        if (this.sessionTimer) {
            clearTimeout(this.sessionTimer);
            this.sessionTimer = null;
        }
    }

    clearPartialDecisionTimer () {
        if (this.partialDecisionTimer) {
            clearTimeout(this.partialDecisionTimer);
            this.partialDecisionTimer = null;
        }
    }

    startSessionTimer (timeoutMs) {
        this.clearSessionTimer();
        this.updateSession({
            acceptanceDeadlineAt: new Date(Date.now() + timeoutMs)
                .toISOString(),
            acceptanceTimeoutSec: timeoutMs / 1000,
        });
        this.sessionTimer = setTimeout(
            () => this.handleSessionTimeout(),
            timeoutMs
        );
        this.sessionTimer.unref?.();
    }

    startPartialDecisionTimer () {
        this.clearPartialDecisionTimer();
        this.updateSession({
            decisionDeadlineAt: new Date(
                Date.now() + this.partialDecisionTimeoutMs
            ).toISOString(),
            decisionTimeoutSec: this.partialDecisionTimeoutMs / 1000,
        });
        this.partialDecisionTimer = setTimeout(
            () => this.handlePartialDecisionTimeout(),
            this.partialDecisionTimeoutMs
        );
        this.partialDecisionTimer.unref?.();
    }

    async start ({
        orderId,
        amountMinor,
        productId = this.fiscalProductId,
        productName = this.fiscalProductName,
    }) {
        const normalizedOrderId = String(orderId || '').trim();
        const normalizedAmount = Number(amountMinor);

        if (!normalizedOrderId) {
            throw new CashPaymentError('orderId is required', {
                code: 'invalid_order_id',
            });
        }
        if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
            throw new CashPaymentError('amountMinor must be a positive integer', {
                code: 'invalid_amount',
            });
        }


        const normalizedProductId = String(productId ?? '').trim();
        const normalizedProductName = String(productName ?? '').trim();
        if (
            this.fiscalizationEnabled &&
            !/^\d{1,6}$/.test(normalizedProductId)
        ) {
            throw new CashPaymentError(
                'productId must contain from 1 to 6 decimal digits',
                { code: 'invalid_product_id' }
            );
        }
        if (
            this.fiscalizationEnabled &&
            (
                !normalizedProductName ||
                !/^[\x20-\x7e]+$/.test(normalizedProductName)
            )
        ) {
            throw new CashPaymentError(
                'productName must contain ASCII characters only',
                { code: 'invalid_product_name' }
            );
        }

        if (
            this.session &&
            this.session.orderId === normalizedOrderId &&
            this.session.targetAmountMinor === normalizedAmount &&
            REUSABLE_STATES.has(this.session.state)
        ) {
            return this.getSession();
        }

        if (
            this.session &&
            (
                UNRESOLVED_STATES.has(this.session.state) ||
                (
                    this.session.state === 'attention_required' &&
                    this.session.acceptedAmountMinor > 0
                )
            )
        ) {
            throw new CashPaymentError('Another cash payment is already in progress', {
                code: 'cash_payment_busy',
                statusCode: 409,
            });
        }

        const acceptorStatus = this.acceptor.getStatus();
        if (!acceptorStatus.available || acceptorStatus.state !== 'ready') {
            throw new CashPaymentError('Bill acceptor is not available', {
                code: 'bill_acceptor_unavailable',
                statusCode: 503,
            });
        }


        const fiscalizationStatus = this.getFiscalizationStatus();
        if (
            this.fiscalizationEnabled &&
            !fiscalizationStatus.available
        ) {
            throw new CashPaymentError('Cash fiscalizer is not available', {
                code: 'cash_fiscalizer_unavailable',
                statusCode: 503,
            });
        }

        const now = new Date().toISOString();
        this.session = {
            id: randomUUID(),
            orderId: normalizedOrderId,
            state: 'preparing',
            targetAmountMinor: normalizedAmount,
            productId: normalizedProductId || null,
            productName: normalizedProductName || null,
            acceptedAmountMinor: 0,
            remainingAmountMinor: normalizedAmount,
            overpaymentAmountMinor: 0,
            lastBillMinor: null,
            bills: [],
            changeCredit: null,
            balanceCredit: null,
            fiscalization: this.fiscalizationEnabled
                ? {
                    state: 'pending',
                    eventNumber: null,
                    amountMinor: normalizedAmount,
                    error: null,
                    completedAt: null,
                }
                : {
                    state: 'disabled',
                    eventNumber: null,
                    amountMinor: null,
                    error: null,
                    completedAt: null,
                },
            error: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            lastBillAt: null,
            acceptanceDeadlineAt: null,
            acceptanceTimeoutSec: null,
            decisionDeadlineAt: null,
            decisionTimeoutSec: null,
        };
        this.emitSession('session_started');

        try {
            await this.acceptor.enableAcceptance();
            this.updateSession({
                state: 'accepting',
            });
            this.startSessionTimer(this.billTimeoutMs);
            this.emitSession('accepting');
            return this.getSession();
        }
        catch (error) {
            this.updateSession({
                state: 'failed',
                error: 'bill_acceptor_start_failed',
            });
            this.emitSession('failed');
            throw new CashPaymentError(error.message, {
                code: 'bill_acceptor_start_failed',
                statusCode: 503,
            });
        }
    }

    updateSession (changes) {
        if (!this.session) {
            return;
        }

        Object.assign(this.session, changes, {
            updatedAt: new Date().toISOString(),
        });
    }

    canAcceptBill (amountMinor) {
        if (!this.session || this.session.state !== 'accepting') {
            return {
                accepted: false,
                reason: 'cash_payment_not_accepting',
            };
        }
        if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
            return {
                accepted: false,
                reason: 'invalid_bill_amount',
            };
        }
        return { accepted: true };
    }

    insertMockBill (amountMinor) {
        const normalizedAmount = Number(amountMinor);
        const decision = this.canAcceptBill(normalizedAmount);

        if (!decision.accepted) {
            throw new CashPaymentError('Bill cannot be accepted', {
                code: decision.reason,
                statusCode: 409,
            });
        }

        this.acceptor.simulateBill(normalizedAmount);
        return this.getSession();
    }

    handleAcceptedBill (event) {
        const normalizedAmount = Number(event.amountMinor);
        const decision = this.canAcceptBill(normalizedAmount);
        const bill = {
            id: randomUUID(),
            sequence: (this.session?.bills?.length || 0) + 1,
            amountMinor: normalizedAmount,
            amountRub: normalizedAmount / 100,
            pulses: event.pulses ?? null,
            acceptedAt: event.acceptedAt || new Date().toISOString(),
        };
        const bills = [ ...(this.session?.bills || []), bill ];

        if (!decision.accepted) {
            return;
        }

        const acceptedAmount = this.session.acceptedAmountMinor + normalizedAmount;
        const remainingAmount = Math.max(
            this.session.targetAmountMinor - acceptedAmount,
            0,
        );

        this.updateSession({
            acceptedAmountMinor: acceptedAmount,
            remainingAmountMinor: remainingAmount,
            overpaymentAmountMinor: Math.max(
                acceptedAmount - this.session.targetAmountMinor,
                0,
            ),
            lastBillMinor: normalizedAmount,
            lastBillAt: bill.acceptedAt,
            bills,
        });
        this.startSessionTimer(this.billTimeoutMs);
        this.emitSession('bill_accepted');

        if (remainingAmount === 0) {
            this.complete();
        }
    }

    complete () {
        if (!this.session || this.session.state !== 'accepting') {
            return;
        }

        this.clearSessionTimer();
        this.clearPartialDecisionTimer();
        const changeCredit = this.createChangeCredit();
        this.acceptor.disableAcceptance().catch(error => {
            this.log('failed to disable acceptor after completion', error);
        });

        if (!this.fiscalizationEnabled) {
            this.updateSession({
                state: 'completed',
                changeCredit,
                acceptanceDeadlineAt: null,
                decisionDeadlineAt: null,
                completedAt: new Date().toISOString(),
            });
            this.emitSession('completed');
            return;
        }

        const sessionId = this.session.id;
        this.updateSession({
            state: 'fiscalizing',
            changeCredit,
            acceptanceDeadlineAt: null,
            decisionDeadlineAt: null,
            fiscalization: {
                ...this.session.fiscalization,
                state: 'processing',
                error: null,
                startedAt: new Date().toISOString(),
            },
        });
        this.emitSession('fiscalization_started');

        this.fiscalizationPromise = this.fiscalize(sessionId)
            .catch(error => {
                this.log('cash fiscalization failed', error);
            })
            .finally(() => {
                this.fiscalizationPromise = null;
            });
    }

    async fiscalize (sessionId) {
        try {
            const result = await this.fiscalizer.registerCashSale({
                // The receipt amount is the sale total. Any accepted
                // overpayment is handled separately as change credit.
                amountMinor: this.session.targetAmountMinor,
                productId: this.session.productId,
                productName: this.session.productName,
                eventName: 'CSAPP',
            });

            if (
                !this.session ||
                this.session.id !== sessionId ||
                this.session.state !== 'fiscalizing'
            ) {
                return;
            }

            const completedAt = new Date().toISOString();
            this.updateSession({
                state: 'completed',
                completedAt,
                fiscalization: {
                    ...this.session.fiscalization,
                    state: 'completed',
                    eventNumber: result.eventNumber ?? null,
                    completedAt,
                },
            });
            this.emitSession('completed');
        }
        catch (error) {
            if (!this.session || this.session.id !== sessionId) {
                throw error;
            }

            const errorCode = error.outcomeUnknown
                ? 'cash_fiscalization_outcome_unknown'
                : 'cash_fiscalization_failed';
            const completedAt = new Date().toISOString();
            this.updateSession({
                state: 'attention_required',
                error: errorCode,
                completedAt,
                fiscalization: {
                    ...this.session.fiscalization,
                    state: error.outcomeUnknown
                        ? 'outcome_unknown'
                        : 'failed',
                    error: errorCode,
                    reason: error.message,
                    completedAt,
                },
            });
            this.emitSession('attention_required');
            throw error;
        }
    }

    async waitForSettlement () {
        await this.fiscalizationPromise;
        return this.getSession();
    }

    createChangeCredit () {
        const amountMinor = Number(
            this.session?.overpaymentAmountMinor || 0
        );
        if (amountMinor <= 0) {
            return null;
        }

        if (!this.changeCreditService) {
            return {
                status: 'configuration_required',
                amountMinor,
                qrPayload: null,
                expiresAt: null,
            };
        }

        return this.changeCreditService.createClaim({
            sessionId: this.session.id,
            orderId: this.session.orderId,
            amountMinor,
        });
    }

    async cancel ({ sessionId } = {}) {
        if (!this.session || !ACTIVE_STATES.has(this.session.state)) {
            throw new CashPaymentError('There is no active cash payment', {
                code: 'cash_payment_not_active',
                statusCode: 409,
            });
        }
        if (sessionId && this.session.id !== sessionId) {
            throw new CashPaymentError('Cash payment session not found', {
                code: 'cash_payment_not_found',
                statusCode: 404,
            });
        }
        if (this.session.acceptedAmountMinor > 0) {
            throw new CashPaymentError('Cash payment cannot be canceled after accepting a bill', {
                code: 'cash_already_accepted',
                statusCode: 409,
            });
        }
        if (this.acceptor.getStatus().pendingPulses > 0) {
            throw new CashPaymentError('A bill is still being processed', {
                code: 'cash_bill_processing',
                statusCode: 409,
            });
        }

        this.clearSessionTimer();
        this.clearPartialDecisionTimer();
        await this.acceptor.disableAcceptance();
        this.updateSession({
            state: 'canceled',
            acceptanceDeadlineAt: null,
            decisionDeadlineAt: null,
            completedAt: new Date().toISOString(),
        });
        this.emitSession('canceled');
        return this.getSession();
    }

    async resume ({ sessionId } = {}) {
        if (!this.session || this.session.state !== 'partial_payment') {
            throw new CashPaymentError('Cash payment cannot be resumed', {
                code: 'cash_payment_not_resumable',
                statusCode: 409,
            });
        }
        if (sessionId && this.session.id !== sessionId) {
            throw new CashPaymentError('Cash payment session not found', {
                code: 'cash_payment_not_found',
                statusCode: 404,
            });
        }

        const acceptorStatus = this.acceptor.getStatus();
        if (!acceptorStatus.available || acceptorStatus.state !== 'ready') {
            throw new CashPaymentError('Bill acceptor is not available', {
                code: 'bill_acceptor_unavailable',
                statusCode: 503,
            });
        }

        this.clearPartialDecisionTimer();
        this.updateSession({
            state: 'preparing',
            error: null,
            decisionDeadlineAt: null,
        });

        try {
            await this.acceptor.enableAcceptance();
            this.updateSession({ state: 'accepting' });
            this.startSessionTimer(this.billTimeoutMs);
            this.emitSession('resumed');
            return this.getSession();
        }
        catch (error) {
            this.finishWithAttention('bill_acceptor_start_failed');
            throw new CashPaymentError(error.message, {
                code: 'bill_acceptor_start_failed',
                statusCode: 503,
            });
        }
    }

    requestBalanceCredit ({ sessionId } = {}) {
        if (
            !this.session ||
            ![ 'partial_payment', 'balance_credit_required' ].includes(
                this.session.state
            )
        ) {
            throw new CashPaymentError('Balance credit is not available', {
                code: 'cash_balance_credit_not_available',
                statusCode: 409,
            });
        }
        if (sessionId && this.session.id !== sessionId) {
            throw new CashPaymentError('Cash payment session not found', {
                code: 'cash_payment_not_found',
                statusCode: 404,
            });
        }

        this.clearPartialDecisionTimer();
        this.updateSession({
            state: 'balance_credit_required',
            decisionDeadlineAt: null,
            balanceCreditRequestedAt:
                this.session.balanceCreditRequestedAt ||
                new Date().toISOString(),
        });
        this.emitSession('balance_credit_required');
        return this.getSession();
    }

    confirmBalanceCredit ({ sessionId, creditUrl = null } = {}) {
        if (
            !this.session ||
            this.session.state !== 'balance_credit_required'
        ) {
            throw new CashPaymentError('Balance credit is not pending', {
                code: 'cash_balance_credit_not_pending',
                statusCode: 409,
            });
        }
        if (sessionId && this.session.id !== sessionId) {
            throw new CashPaymentError('Cash payment session not found', {
                code: 'cash_payment_not_found',
                statusCode: 404,
            });
        }

        this.updateSession({
            state: 'balance_credit_ready',
            balanceCredit: {
                amountMinor: this.session.acceptedAmountMinor,
                creditUrl: creditUrl ? String(creditUrl) : null,
                confirmedAt: new Date().toISOString(),
            },
            completedAt: new Date().toISOString(),
        });
        this.emitSession('balance_credit_ready');
        return this.getSession();
    }

    release ({ sessionId } = {}) {
        if (
            !this.session ||
            ![
                'partial_payment',
                'balance_credit_required',
                'balance_credit_ready',
            ].includes(this.session.state)
        ) {
            throw new CashPaymentError('Cash payment cannot be released', {
                code: 'cash_payment_not_releasable',
                statusCode: 409,
            });
        }
        if (sessionId && this.session.id !== sessionId) {
            throw new CashPaymentError('Cash payment session not found', {
                code: 'cash_payment_not_found',
                statusCode: 404,
            });
        }

        this.clearSessionTimer();
        this.clearPartialDecisionTimer();
        this.updateSession({
            state: 'released',
            acceptanceDeadlineAt: null,
            decisionDeadlineAt: null,
            releasedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
        });
        this.emitSession('released');
        return this.getSession();
    }

    handleSessionTimeout () {
        this.sessionTimer = null;

        if (!this.session || !ACTIVE_STATES.has(this.session.state)) {
            return;
        }

        const acceptorStatus = this.acceptor.getStatus();
        if (acceptorStatus.pendingPulses > 0) {
            const retryAfterMs =
                Number(acceptorStatus.gpio?.packetGapMs || 1200) + 100;
            this.sessionTimer = setTimeout(
                () => this.handleSessionTimeout(),
                retryAfterMs,
            );
            this.sessionTimer.unref?.();
            return;
        }

        if (this.session.acceptedAmountMinor > 0) {
            this.pausePartialPayment();
            return;
        }

        this.updateSession({
            state: 'failed',
            error: 'cash_payment_timeout',
            acceptanceDeadlineAt: null,
            completedAt: new Date().toISOString(),
        });
        this.acceptor.disableAcceptance().catch(error => {
            this.log('failed to disable acceptor after timeout', error);
        });
        this.emitSession('failed');
    }

    pausePartialPayment () {
        if (!this.session || this.session.state !== 'accepting') {
            return;
        }

        this.clearSessionTimer();
        this.updateSession({
            state: 'partial_payment',
            error: 'cash_payment_timeout_with_partial_amount',
            acceptanceDeadlineAt: null,
        });
        this.startPartialDecisionTimer();
        this.acceptor.disableAcceptance().catch(error => {
            this.log('failed to pause bill acceptor', error);
        });
        this.emitSession('partial_payment');
    }

    handlePartialDecisionTimeout () {
        this.partialDecisionTimer = null;
        if (!this.session || this.session.state !== 'partial_payment') {
            return;
        }

        this.requestBalanceCredit({ sessionId: this.session.id });
    }

    finishWithAttention (errorCode) {
        if (!this.session) {
            return;
        }

        this.clearSessionTimer();
        this.clearPartialDecisionTimer();
        this.updateSession({
            state: 'attention_required',
            error: errorCode,
            acceptanceDeadlineAt: null,
            decisionDeadlineAt: null,
            completedAt: new Date().toISOString(),
        });
        this.acceptor.disableAcceptance().catch(error => {
            this.log('failed to disable acceptor', error);
        });
        this.emitSession('attention_required');
    }

    handleInvalidBill (event) {
        this.log('invalid bill pulse packet', event);
        if (this.session && ACTIVE_STATES.has(this.session.state)) {
            this.finishWithAttention('bill_amount_unrecognized');
        }
    }

    handleAcceptorError (error) {
        this.log('acceptor error', error);
        if (this.session && ACTIVE_STATES.has(this.session.state)) {
            this.finishWithAttention('bill_acceptor_error');
        }
    }
}

module.exports = {
    CashPaymentError,
    CashPaymentService,
};
