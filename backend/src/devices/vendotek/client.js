'use strict';

const { EventEmitter } = require('events');
const {
    POS_DISCRIMINATOR,
    VMC_DISCRIMINATOR,
    buildMessage,
    decodeTlvs,
    formatMessage,
    tlvsToObject,
} = require('./protocol');
const {
    createAbr,
    createDis,
    createFin,
    createIdl,
    createVrp,
} = require('./commands');
const {
    VendotekPaymentController,
} = require('./payment-controller');
const { VendotekTransport } = require('./transport');

const HANDSHAKE_TIMEOUT_MS = 15000;
const RETURN_TO_IDLE_TIMEOUT_MS = 15000;

function normalizePositiveNumber(value, fieldName, { allowZero = false } = {}) {
    const number = Number(value);
    const isValid = Number.isFinite(number) && (
        allowZero ? number >= 0 : number > 0
    );

    if (!isValid) {
        const expectation = allowZero ? 'zero or positive' : 'positive';
        throw new Error(`${fieldName} must be ${expectation}`);
    }

    return number;
}

class VtkClient extends EventEmitter {
    constructor({
        host,
        port = 62801,
        keepaliveSec = 10,
        operationTimeoutSec = 60,
        paymentWaitSec = 60,
        debug = true,
        reconnectDelayMs = 5000,
        createConnection,
        transport,
    }) {
        super();

        this.transport = transport || new VendotekTransport({
            host,
            port,
            ...(createConnection ? { createConnection } : {}),
        });
        this.host = this.transport.host;
        this.port = this.transport.port;
        this.keepaliveSec = normalizePositiveNumber(
            keepaliveSec,
            'keepaliveSec'
        );
        this.operationTimeoutSec = normalizePositiveNumber(
            operationTimeoutSec,
            'operationTimeoutSec'
        );
        this.paymentWaitSec = normalizePositiveNumber(
            paymentWaitSec,
            'paymentWaitSec'
        );
        this.debug = Boolean(debug);
        this.reconnectDelayMs = normalizePositiveNumber(
            reconnectDelayMs,
            'reconnectDelayMs',
            { allowZero: true }
        );
        this.operationNumber = 0;
        this.eventNumber = 0;

        this.keepaliveTimer = null;
        this.reconnectTimer = null;
        this.connectPromise = null;

        this.connected = false;
        this.handshaked = false;
        this.isConnecting = false;
        this.manualClose = false;

        this.terminalState = 'disconnected';
        this.paymentController = new VendotekPaymentController(this);

        this.bindTransportEvents();
    }

    log(...args) {
        if (this.debug) {
            console.log(new Date().toISOString(), '[Vendotek]', ...args);
        }
    }

    get socket() {
        return this.transport.socket;
    }

    set socket(socket) {
        this.transport.socket = socket;
    }

    get operationActive() {
        return this.paymentController.operationActive;
    }

    set operationActive(value) {
        this.paymentController.operationActive = value;
    }

    get paymentInProgress() {
        return this.paymentController.paymentInProgress;
    }

    set paymentInProgress(value) {
        this.paymentController.paymentInProgress = value;
    }

    get currentOperation() {
        return this.paymentController.currentOperation;
    }

    set currentOperation(operation) {
        this.paymentController.currentOperation = operation;
    }

    bindTransportEvents() {
        this.transport.on('connect', () => {
            this.connected = true;
            this.handshaked = false;
            this.isConnecting = false;
            this.terminalState = 'connected';
            this.emitStatus('tcp_connected');
        });

        this.transport.on('frame', frame => this.handleFrame(frame));

        this.transport.on('protocolError', error => {
            this.emitStatus('protocol_error', {
                message: error.message,
            });
            this.emitError(error);
        });

        this.transport.on('socketError', ({ error, beforeConnect }) => {
            this.log('TCP error:', error.message);
            this.emitStatus('tcp_error', {
                message: error.message,
            });

            if (beforeConnect) {
                this.isConnecting = false;
            }
            else {
                this.emitError(error);
            }
        });

        this.transport.on('close', () => {
            this.log('TCP closed');
            this.connected = false;
            this.handshaked = false;
            this.isConnecting = false;
            this.terminalState = 'disconnected';

            this.stopKeepalive();
            this.emitStatus('tcp_closed');
            this.emit('close');

            if (!this.manualClose) {
                this.scheduleReconnect();
            }
        });
    }

    emitError(error) {
        this.log('Error:', error.message);

        if (this.listenerCount('error') > 0) {
            this.emit('error', error);
        }
    }

    async start() {
        this.manualClose = false;

        try {
            await this.connect();
            const hello = await this.handshake();

            if (hello.messageName === 'IDL') {
                this.emitStatus('ready');
            } else {
                this.emitStatus('disabled', {
                    pos: hello.posManagement || null,
                });
            }

            return hello;
        } catch (error) {
            this.transport.destroy();
            throw error;
        }
    }

    connect() {
        if (this.connected) {
            return Promise.resolve();
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.isConnecting = true;
        this.terminalState = 'connecting';
        this.connectPromise = this.transport.connect()
            .finally(() => {
                this.connectPromise = null;
            });

        return this.connectPromise;
    }

    scheduleReconnect() {
        if (this.reconnectTimer || this.manualClose) {
            return;
        }

        this.emitStatus('reconnecting', {
            delayMs: this.reconnectDelayMs,
        });

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;

            try {
                await this.start();
            } catch (error) {
                this.log('Reconnect failed:', error.message);
                this.scheduleReconnect();
            }
        }, this.reconnectDelayMs);
        this.reconnectTimer.unref?.();
    }

    close() {
        this.manualClose = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.stopKeepalive();
        this.transport.close();

        this.connected = false;
        this.handshaked = false;
        this.isConnecting = false;
        this.terminalState = 'disconnected';
        this.operationActive = false;
        this.paymentInProgress = false;
        this.currentOperation = null;
    }

    emitStatus(type, extra = {}) {
        this.emit('status', {
            type,
            connected: this.connected,
            handshaked: this.handshaked,
            terminalState: this.terminalState,
            ...extra,
        });
    }

    clearCurrentOperation() {
        this.paymentController.clearCurrentOperation();
    }

    recoverFromOperationError(type, error) {
        this.emitStatus(type, {
            operationNumber:
                this.currentOperation?.operationNumber ?? null,
            message: error.message,
        });

        /*
         * The transaction outcome is unknown after a transport or protocol
         * failure. Reconnect and handshake before allowing another payment.
         */
        this.transport.destroy();
    }

    startKeepalive() {
        this.stopKeepalive();

        this.keepaliveTimer = setInterval(() => {
            try {
                if (
                    !this.connected ||
                    !this.handshaked ||
                    this.operationActive
                ) {
                    return;
                }

                if (this.terminalState === 'disabled') {
                    this.sendDis();
                } else {
                    this.sendIdl();
                }
            } catch (error) {
                this.emitError(error);
            }
        }, this.keepaliveSec * 1000);
        this.keepaliveTimer.unref?.();
    }

    stopKeepalive() {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
    }

    handleFrame(frame) {
        if (frame.discriminator !== POS_DISCRIMINATOR) {
            throw new Error(
                `Unexpected discriminator: 0x${frame.discriminator.toString(16)}`
            );
        }

        const tlvs = decodeTlvs(frame.appMessage);
        const message = tlvsToObject(tlvs);

        if (
            message.operationNumber &&
            !Number.isNaN(Number(message.operationNumber))
        ) {
            this.operationNumber = Number(message.operationNumber);
        }

        if (
            message.eventNumber &&
            !Number.isNaN(Number(message.eventNumber))
        ) {
            this.eventNumber = Number(message.eventNumber);
        }

        if (message.keepalive && Number(message.keepalive) > 0) {
            this.keepaliveSec = Number(message.keepalive);
            this.startKeepalive();
        }

        if (
            message.operationTimeout &&
            Number(message.operationTimeout) > 0
        ) {
            this.operationTimeoutSec = Number(message.operationTimeout);
        }

        const cleanMessage = formatMessage(message);

        this.log('RX:', cleanMessage);
        this.emit('message', cleanMessage);
        this.emit('raw', {
            direction: 'rx',
            payload: cleanMessage,
        });

        if (message.messageName === 'STA') {
            this.emit('sta', cleanMessage);
        }

        if (message.messageName === 'INF') {
            this.emit('info', cleanMessage);
        }

        if (message.messageName === 'MFR') {
            this.emit('mfr', cleanMessage);
        }

        if (message.messageName === 'PRS') {
            this.emit('prs', cleanMessage);
        }

        if (message.messageName === 'IDL') {
            this.terminalState = 'idle';
            this.emit('idleState', cleanMessage);
            this.emitStatus('idle', {
                pos: cleanMessage.posManagement || null,
            });
        }

        if (message.messageName === 'DIS') {
            this.terminalState = 'disabled';
            this.emit('idleState', cleanMessage);
            this.emitStatus('disabled', {
                pos: cleanMessage.posManagement || null,
            });
        }

        if (message.messageName === 'VRP') {
            const approvedAmount = Number(message.amount || '0');
            const isCurrentOperation =
                this.currentOperation &&
                String(this.currentOperation.operationNumber) ===
                String(message.operationNumber || '');
            const abortRequested =
                isCurrentOperation &&
                this.currentOperation.state === 'abort_requested';

            if (approvedAmount > 0) {
                this.emitStatus(
                    abortRequested ? 'approved_after_cancel' : 'approved',
                    {
                        operationNumber: message.operationNumber,
                        amountMinor: approvedAmount,
                    }
                );
            } else {
                this.emitStatus(
                    abortRequested ? 'canceled' : 'declined',
                    {
                        operationNumber: message.operationNumber,
                        amountMinor: 0,
                    }
                );
            }
        }

        if (message.messageName === 'FIN') {
            this.emitStatus('finalized', {
                operationNumber: message.operationNumber,
                amountMinor: Number(message.amount || '0'),
            });
        }
    }

    sendTlvMessage(tlvs, label = 'UNKNOWN') {
        if (!this.connected) {
            throw new Error('Socket is not connected');
        }

        const frame = buildMessage(VMC_DISCRIMINATOR, tlvs);
        this.transport.send(frame);

        this.log('TX:', label);
        this.emit('raw', {
            direction: 'tx',
            label,
        });
    }

    sendCommand(command) {
        this.sendTlvMessage(command.tlvs, command.label);
    }

    sendIdl(extraTlvs = []) {
        this.sendCommand(createIdl({
            operationNumber: this.operationNumber,
            eventNumber: this.eventNumber,
            extraTlvs,
        }));
    }

    sendDis() {
        this.sendCommand(createDis({
            operationNumber: this.operationNumber,
        }));
    }

    sendAbr(operationNumber = this.operationNumber) {
        this.sendCommand(createAbr({ operationNumber }));
    }

    cancelPayment(reason = 'customer_canceled') {
        return this.paymentController.cancelPayment(reason);
    }

    sendVrp({ amountMinor, productId, productName }) {
        const operationNumber = this.operationNumber + 1;
        const command = createVrp({
            operationNumber,
            amountMinor,
            productId,
            productName,
        });

        this.operationNumber = operationNumber;
        this.sendCommand(command);
        return operationNumber;
    }

    sendFin({
        operationNumber = this.operationNumber,
        amountMinor,
        productId,
        productName,
    }) {
        this.sendCommand(createFin({
            operationNumber,
            amountMinor,
            productId,
            productName,
        }));
    }

    waitForMessage(
        predicate,
        timeoutMs,
        description = 'Vendotek message',
        send = null
    ) {
        return new Promise((resolve, reject) => {
            let timer = null;

            const cleanup = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                this.off('message', onMessage);
                this.off('error', onError);
                this.off('close', onClose);
            };

            const finish = (callback, value) => {
                cleanup();
                callback(value);
            };

            const onMessage = (message) => {
                try {
                    if (predicate(message)) {
                        finish(resolve, message);
                    }
                } catch (error) {
                    finish(reject, error);
                }
            };

            const onError = (error) => {
                finish(reject, error);
            };

            const onClose = () => {
                finish(
                    reject,
                    new Error('Vendotek TCP connection closed')
                );
            };

            this.on('message', onMessage);
            this.on('error', onError);
            this.on('close', onClose);

            timer = setTimeout(() => {
                finish(
                    reject,
                    new Error(
                        `Timeout waiting for ${description} after ${timeoutMs} ms`
                    )
                );
            }, timeoutMs);
            timer.unref?.();

            if (send) {
                try {
                    send();
                } catch (error) {
                    finish(reject, error);
                }
            }
        });
    }

    async returnToIdle(timeoutMs = RETURN_TO_IDLE_TIMEOUT_MS) {
        if (!this.connected || !this.handshaked) {
            throw new Error('Vendotek is not ready');
        }

        this.terminalState = 'returning_idle';

        const response = await this.waitForMessage(
            (message) =>
                message.messageName === 'IDL' ||
                message.messageName === 'DIS',
            timeoutMs,
            'IDL/DIS',
            () => this.sendIdl()
        );

        this.terminalState =
            response.messageName === 'IDL' ? 'idle' : 'disabled';

        return response;
    }

    async handshake() {
        const response = await this.waitForMessage(
            (message) =>
                message.messageName === 'IDL' ||
                message.messageName === 'DIS',
            HANDSHAKE_TIMEOUT_MS,
            'handshake IDL/DIS',
            () => this.sendIdl()
        );

        this.handshaked = true;
        this.terminalState =
            response.messageName === 'IDL' ? 'idle' : 'disabled';

        /*
         * IDL означает, что терминал подтвердил состояние ожидания.
         * После переподключения снимаем локальные блокировки операции.
         */
        if (response.messageName === 'IDL') {
            this.paymentInProgress = false;
            this.clearCurrentOperation();
        }

        this.startKeepalive();
        this.emitStatus('handshake_ok', {
            hello: response,
        });

        return response;
    }

    startPayment(options) {
        return this.paymentController.startPayment(options);
    }

    finalizeSuccess(amountMinor, productId, productName) {
        return this.paymentController.finalizeSuccess(
            amountMinor,
            productId,
            productName
        );
    }

    finalizeFailure(productId, productName) {
        return this.paymentController.finalizeFailure(
            productId,
            productName
        );
    }

    getOperationAwaitingFin() {
        return this.paymentController.getOperationAwaitingFin();
    }

    finalizeOperation(options) {
        return this.paymentController.finalizeOperation(options);
    }

    getState() {
        return {
            host: this.host,
            port: this.port,
            connected: this.connected,
            handshaked: this.handshaked,
            terminalState: this.terminalState,
            operationNumber: this.operationNumber,
            eventNumber: this.eventNumber,
            keepaliveSec: this.keepaliveSec,
            operationTimeoutSec: this.operationTimeoutSec,
            paymentWaitSec: this.paymentWaitSec,
            operationActive: this.operationActive,
            paymentInProgress: this.paymentInProgress,
            currentOperation: this.currentOperation
                ? { ...this.currentOperation }
                : null,
        };
    }
}

module.exports = { VtkClient };
