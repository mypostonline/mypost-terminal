const EventEmitter = require('events');
const { randomUUID } = require('crypto');

const ACTIVE_STATES = new Set([ 'preparing', 'accepting' ]);

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
        allowOverpayment = true,
        sessionTimeoutSec = 300,
        changeCreditService = null,
        debug = false,
    }) {
        super();

        if (!acceptor) {
            throw new Error('Bill acceptor is required');
        }
        if (!Number.isFinite(Number(sessionTimeoutSec)) || Number(sessionTimeoutSec) <= 0) {
            throw new Error('sessionTimeoutSec must be positive');
        }

        this.acceptor = acceptor;
        this.allowOverpayment = Boolean(allowOverpayment);
        this.changeCreditService = changeCreditService;
        this.sessionTimeoutMs = Number(sessionTimeoutSec) * 1000;
        this.debug = debug;
        this.session = null;
        this.sessionTimer = null;

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
        };
    }

    getStatus () {
        return {
            acceptor: this.acceptor.getStatus(),
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

    startSessionTimer () {
        this.clearSessionTimer();
        this.sessionTimer = setTimeout(() => this.handleSessionTimeout(), this.sessionTimeoutMs);
        this.sessionTimer.unref?.();
    }

    async start ({ orderId, amountMinor }) {
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

        if (
            this.session &&
            this.session.orderId === normalizedOrderId &&
            this.session.targetAmountMinor === normalizedAmount &&
            [ ...ACTIVE_STATES, 'completed', 'attention_required' ].includes(
                this.session.state
            )
        ) {
            return this.getSession();
        }

        if (this.session && ACTIVE_STATES.has(this.session.state)) {
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

        const now = new Date().toISOString();
        this.session = {
            id: randomUUID(),
            orderId: normalizedOrderId,
            state: 'preparing',
            targetAmountMinor: normalizedAmount,
            acceptedAmountMinor: 0,
            remainingAmountMinor: normalizedAmount,
            overpaymentAmountMinor: 0,
            lastBillMinor: null,
            bills: [],
            changeCredit: null,
            error: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        };
        this.emitSession('session_started');

        try {
            await this.acceptor.enableAcceptance();
            this.updateSession({
                state: 'accepting',
            });
            this.startSessionTimer();
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
        if (!this.allowOverpayment && amountMinor > this.session.remainingAmountMinor) {
            return {
                accepted: false,
                reason: 'overpayment_not_allowed',
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
            amountMinor: normalizedAmount,
            amountRub: normalizedAmount / 100,
            pulses: event.pulses ?? null,
            acceptedAt: event.acceptedAt || new Date().toISOString(),
        };
        const bills = [ ...(this.session?.bills || []), bill ];

        if (!decision.accepted) {
            if (
                this.session?.state === 'accepting' &&
                decision.reason === 'overpayment_not_allowed'
            ) {
                const acceptedAmount =
                    this.session.acceptedAmountMinor + normalizedAmount;
                this.updateSession({
                    acceptedAmountMinor: acceptedAmount,
                    remainingAmountMinor: 0,
                    overpaymentAmountMinor:
                        acceptedAmount - this.session.targetAmountMinor,
                    lastBillMinor: normalizedAmount,
                    bills,
                });
                this.emitSession('bill_accepted');
                this.finishWithAttention('unexpected_overpayment');
            }
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
            bills,
        });
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
        const changeCredit = this.createChangeCredit();
        this.updateSession({
            state: 'completed',
            changeCredit,
            completedAt: new Date().toISOString(),
        });
        this.acceptor.disableAcceptance().catch(error => {
            this.log('failed to disable acceptor after completion', error);
        });
        this.emitSession('completed');
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
        await this.acceptor.disableAcceptance();
        this.updateSession({
            state: 'canceled',
            completedAt: new Date().toISOString(),
        });
        this.emitSession('canceled');
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
            this.finishWithAttention('cash_payment_timeout_with_partial_amount');
            return;
        }

        this.updateSession({
            state: 'failed',
            error: 'cash_payment_timeout',
            completedAt: new Date().toISOString(),
        });
        this.acceptor.disableAcceptance().catch(error => {
            this.log('failed to disable acceptor after timeout', error);
        });
        this.emitSession('failed');
    }

    finishWithAttention (errorCode) {
        if (!this.session) {
            return;
        }

        this.clearSessionTimer();
        this.updateSession({
            state: 'attention_required',
            error: errorCode,
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
