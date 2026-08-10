'use strict';

const { validateAscii } = require('./protocol');

const PAYMENT_TIMEOUT_MARGIN_SEC = 5;

function matchesOperationMessage(message, messageName, operationNumber) {
    return message.messageName === messageName &&
        String(message.operationNumber || '') === String(operationNumber);
}

class VendotekPaymentController {
    constructor(client) {
        this.client = client;
        this.operationActive = false;
        this.paymentInProgress = false;
        this.currentOperation = null;
    }

    get connected() {
        return this.client.connected;
    }

    get handshaked() {
        return this.client.handshaked;
    }

    get terminalState() {
        return this.client.terminalState;
    }

    set terminalState(state) {
        this.client.terminalState = state;
    }

    get operationNumber() {
        return this.client.operationNumber;
    }

    get operationTimeoutSec() {
        return this.client.operationTimeoutSec;
    }

    get paymentWaitSec() {
        return this.client.paymentWaitSec;
    }

    emitStatus(...args) {
        return this.client.emitStatus(...args);
    }

    emitError(...args) {
        return this.client.emitError(...args);
    }

    recoverFromOperationError(...args) {
        return this.client.recoverFromOperationError(...args);
    }

    returnToIdle(...args) {
        return this.client.returnToIdle(...args);
    }

    sendAbr(...args) {
        return this.client.sendAbr(...args);
    }

    sendFin(...args) {
        return this.client.sendFin(...args);
    }

    sendVrp(...args) {
        return this.client.sendVrp(...args);
    }

    waitForMessage(...args) {
        return this.client.waitForMessage(...args);
    }

    clearCurrentOperation() {
        this.operationActive = false;
        this.currentOperation = null;
    }

    cancelPayment(reason = 'customer_canceled') {
        const operation = this.currentOperation;

        if (
            !this.paymentInProgress ||
            !operation ||
            ![ 'waiting_vrp', 'abort_requested' ].includes(operation.state)
        ) {
            throw new Error('Card payment cannot be canceled now');
        }

        if (operation.cancelRequested) {
            return {
                operationNumber: operation.operationNumber,
                reason: operation.cancelReason,
            };
        }

        operation.cancelRequested = true;
        operation.cancelReason = reason;
        operation.state = 'abort_requested';

        this.emitStatus('payment_cancel_requested', {
            operationNumber: String(operation.operationNumber),
            reason,
        });

        this.sendAbr(operation.operationNumber);

        return {
            operationNumber: operation.operationNumber,
            reason,
        };
    }

    async startPayment({ amountMinor, productId, productName }) {
        if (!this.connected || !this.handshaked) {
            throw new Error('Vendotek is not ready');
        }

        const requestedAmount = Number(amountMinor);
        if (!Number.isInteger(requestedAmount) || requestedAmount <= 0) {
            throw new Error('amountMinor must be a positive integer');
        }
        if (productId !== undefined && productId !== null) {
            validateAscii(productId, 'productId');
        }
        if (productName !== undefined && productName !== null) {
            validateAscii(productName, 'productName');
        }

        if (this.terminalState !== 'idle') {
            throw new Error(
                `Vendotek is not idle: ${this.terminalState}`
            );
        }

        if (this.paymentInProgress || this.operationActive) {
            throw new Error(
                'Previous payment operation is not finished'
            );
        }

        this.paymentInProgress = true;
        this.operationActive = true;
        this.terminalState = 'processing';

        let cancelTimer = null;

        try {
            const operationNumber = this.operationNumber + 1;

            this.currentOperation = {
                operationNumber,
                requestedAmount,
                approvedAmount: null,
                productId: productId ?? null,
                productName: productName ?? null,
                state: 'waiting_vrp',
                cancelRequested: false,
                cancelReason: null,
            };

            const effectivePaymentWaitSec = Math.min(
                this.paymentWaitSec,
                Math.max(
                    0.1,
                    this.operationTimeoutSec - Math.min(
                        PAYMENT_TIMEOUT_MARGIN_SEC,
                        this.operationTimeoutSec / 2
                    )
                )
            );

            this.emitStatus('payment_requested', {
                operationNumber: String(operationNumber),
                amountMinor: requestedAmount,
                productId: productId ?? null,
                productName: productName ?? null,
                paymentWaitSec: effectivePaymentWaitSec,
            });

            cancelTimer = setTimeout(() => {
                try {
                    this.cancelPayment('customer_timeout');
                } catch (error) {
                    this.emitError(error);
                }
            }, effectivePaymentWaitSec * 1000);
            cancelTimer.unref?.();

            const response = await this.waitForMessage(
                (message) => matchesOperationMessage(
                    message,
                    'VRP',
                    operationNumber
                ),
                this.operationTimeoutSec * 1000,
                `VRP operation ${operationNumber}`,
                () => {
                    const sentOperationNumber = this.sendVrp({
                        amountMinor: requestedAmount,
                        productId,
                        productName,
                    });

                    if (sentOperationNumber !== operationNumber) {
                        throw new Error(
                            `Unexpected operation number: ${sentOperationNumber}`
                        );
                    }
                }
            );

            clearTimeout(cancelTimer);
            cancelTimer = null;

            const approvedAmount = Number(response.amount || '0');
            const cancelRequested =
                Boolean(this.currentOperation?.cancelRequested);
            const cancelReason =
                this.currentOperation?.cancelReason || 'customer_canceled';

            if (approvedAmount === 0) {
                if (this.currentOperation) {
                    this.currentOperation.state = 'returning_idle';
                }

                const idleResponse = await this.returnToIdle();

                this.clearCurrentOperation();

                return {
                    operationNumber,
                    approved: false,
                    approvedAmount: 0,
                    canceled: cancelRequested,
                    reason: cancelRequested
                        ? cancelReason
                        : 'declined',
                    response,
                    idleResponse,
                };
            }

            if (cancelRequested) {
                if (this.currentOperation) {
                    this.currentOperation.state = 'finalizing_cancel';
                }

                const finResponse = await this.waitForMessage(
                    (message) => matchesOperationMessage(
                        message,
                        'FIN',
                        operationNumber
                    ),
                    this.operationTimeoutSec * 1000,
                    `FIN operation ${operationNumber}`,
                    () => this.sendFin({
                        operationNumber,
                        amountMinor: 0,
                        productId,
                        productName,
                    })
                );

                if (this.currentOperation) {
                    this.currentOperation.state = 'returning_idle';
                }

                const idleResponse = await this.returnToIdle();

                this.clearCurrentOperation();

                return {
                    operationNumber,
                    approved: false,
                    approvedAmount,
                    canceled: true,
                    autoReversed: true,
                    reason: 'approved_after_cancel',
                    response,
                    finResponse,
                    idleResponse,
                };
            }

            this.currentOperation.approvedAmount = approvedAmount;
            this.currentOperation.state = 'awaiting_fin';
            this.terminalState = 'awaiting_fin';

            return {
                operationNumber,
                approved: true,
                approvedAmount,
                canceled: false,
                response,
            };
        } catch (error) {
            this.recoverFromOperationError('payment_error', error);
            throw error;
        } finally {
            if (cancelTimer) {
                clearTimeout(cancelTimer);
            }

            this.paymentInProgress = false;
        }
    }

    async finalizeSuccess(amountMinor, productId, productName) {
        const operation = this.getOperationAwaitingFin();

        const finalAmount = Number(amountMinor);

        if (!Number.isInteger(finalAmount) || finalAmount <= 0) {
            throw new Error('FIN amount must be a positive integer');
        }

        if (finalAmount !== operation.approvedAmount) {
            throw new Error(
                `FIN amount must match approved amount: ${operation.approvedAmount}`
            );
        }

        const finalProductId = productId ?? operation.productId;
        const finalProductName = productName ?? operation.productName;
        if (finalProductId !== undefined && finalProductId !== null) {
            validateAscii(finalProductId, 'productId');
        }
        if (finalProductName !== undefined && finalProductName !== null) {
            validateAscii(finalProductName, 'productName');
        }

        return this.finalizeOperation({
            operation,
            amountMinor: finalAmount,
            productId: finalProductId,
            productName: finalProductName,
        });
    }

    async finalizeFailure(productId, productName) {
        const operation = this.getOperationAwaitingFin();
        const finalProductId = productId ?? operation.productId;
        const finalProductName = productName ?? operation.productName;
        if (finalProductId !== undefined && finalProductId !== null) {
            validateAscii(finalProductId, 'productId');
        }
        if (finalProductName !== undefined && finalProductName !== null) {
            validateAscii(finalProductName, 'productName');
        }

        return this.finalizeOperation({
            operation,
            amountMinor: 0,
            productId: finalProductId,
            productName: finalProductName,
        });
    }

    getOperationAwaitingFin() {
        if (!this.connected || !this.handshaked) {
            throw new Error('Vendotek is not ready');
        }

        const operation = this.currentOperation;

        if (!operation || operation.state !== 'awaiting_fin') {
            throw new Error(
                'There is no approved payment awaiting FIN'
            );
        }

        return operation;
    }

    async finalizeOperation({
        operation,
        amountMinor,
        productId,
        productName,
    }) {
        const operationNumber = operation.operationNumber;
        operation.state = 'finalizing';
        this.terminalState = 'finalizing';

        this.emitStatus('finalization_requested', {
            operationNumber,
            amountMinor,
        });

        try {
            const response = await this.waitForMessage(
                (message) => matchesOperationMessage(
                    message,
                    'FIN',
                    operationNumber
                ),
                this.operationTimeoutSec * 1000,
                `FIN operation ${operationNumber}`,
                () => this.sendFin({
                    operationNumber,
                    amountMinor,
                    productId,
                    productName,
                })
            );

            operation.state = 'returning_idle';
            const idleResponse = await this.returnToIdle();

            this.clearCurrentOperation();

            return {
                finResponse: response,
                idleResponse,
            };
        } catch (error) {
            this.recoverFromOperationError('finalization_error', error);
            throw error;
        }
    }
}

module.exports = { VendotekPaymentController };

