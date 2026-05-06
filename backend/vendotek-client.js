'use strict';

const net = require('net');
const { EventEmitter } = require('events');

const VMC_DISCRIMINATOR = 0x96fb;
const POS_DISCRIMINATOR = 0x97fb;

function encodeAscii(str) {
    return Buffer.from(String(str), 'ascii');
}

function encodeTlv(tag, valueBuffer) {
    if (!Buffer.isBuffer(valueBuffer)) {
        throw new Error('valueBuffer must be Buffer');
    }

    const len = valueBuffer.length;

    if (len < 0x80) {
        return Buffer.concat([
            Buffer.from([tag]),
            Buffer.from([len]),
            valueBuffer,
        ]);
    }

    if (len <= 0xff) {
        return Buffer.concat([
            Buffer.from([tag, 0x81, len]),
            valueBuffer,
        ]);
    }

    if (len <= 0xffff) {
        const lb = Buffer.alloc(2);
        lb.writeUInt16BE(len, 0);
        return Buffer.concat([
            Buffer.from([tag, 0x82]),
            lb,
            valueBuffer,
        ]);
    }

    throw new Error('TLV too long');
}

function decodeTlvs(buffer) {
    const items = [];
    let offset = 0;

    while (offset < buffer.length) {
        const tag = buffer[offset++];
        if (offset >= buffer.length) break;

        let len = buffer[offset++];

        if (len & 0x80) {
            const lenBytes = len & 0x7f;
            if (lenBytes < 1 || lenBytes > 2) {
                throw new Error(`Unsupported BER length bytes count: ${lenBytes}`);
            }

            if (offset + lenBytes > buffer.length) {
                throw new Error('Invalid BER length');
            }

            len = 0;
            for (let i = 0; i < lenBytes; i++) {
                len = (len << 8) | buffer[offset++];
            }
        }

        if (offset + len > buffer.length) {
            throw new Error('TLV overruns buffer');
        }

        const value = buffer.subarray(offset, offset + len);
        offset += len;

        items.push({ tag, value });
    }

    return items;
}

function buildMessage(discriminator, tlvList) {
    const appMessage = Buffer.concat(tlvList);
    const payloadLength = 2 + appMessage.length;

    const header = Buffer.alloc(4);
    header.writeUInt16BE(payloadLength, 0);
    header.writeUInt16BE(discriminator, 2);

    return Buffer.concat([header, appMessage]);
}

function parseFrames(buffer) {
    const frames = [];
    let offset = 0;

    while (offset + 4 <= buffer.length) {
        const payloadLength = buffer.readUInt16BE(offset);
        const frameLength = 2 + payloadLength;

        if (offset + frameLength > buffer.length) break;

        const discriminator = buffer.readUInt16BE(offset + 2);
        const appMessage = buffer.subarray(offset + 4, offset + frameLength);

        frames.push({ discriminator, appMessage });
        offset += frameLength;
    }

    return {
        frames,
        rest: buffer.subarray(offset),
    };
}

function decodePosManagementData(buf) {
    const chars = buf.toString('ascii');
    const b1 = chars[0] || 'N';
    const b2 = chars[1] || 'N';
    const b3 = chars[2] || 'N';

    const updateStatusMap = {
        S: 'close day scheduled',
        L: 'download scheduled',
        R: 'restart scheduled',
        N: 'unknown',
    };

    const traceStatusMap = {
        T: 'trace upload in progress',
        N: 'unknown',
    };

    const cardAcceptanceMap = {
        A: 'no general configuration',
        B: 'no bank configuration',
        C: 'invalid local time',
        D: 'disabled',
        E: 'card acceptance enabled',
        I: 'IDL/DIS receive timeout',
        J: 'job is active',
        L: 'no loyalty configuration',
        N: 'unknown',
    };

    return {
        raw: chars,
        updateStatusCode: b1,
        updateStatus: updateStatusMap[b1] || `unknown(${b1})`,
        traceStatusCode: b2,
        traceStatus: traceStatusMap[b2] || `unknown(${b2})`,
        cardAcceptanceCode: b3,
        cardAcceptance: cardAcceptanceMap[b3] || `unknown(${b3})`,
    };
}

function decodeStageId(stageId) {
    const map = {
        1: 'insert card',
        3: 'swipe card',
        4: 'enter PIN',
        8: 'remove card',
        18: 'scan QR',
        101: 'tap card',
        102: 'please wait',
    };

    return map[stageId] || `stage_${stageId}`;
}

function tlvsToObject(tlvs) {
    const obj = {};

    for (const { tag, value } of tlvs) {
        switch (tag) {
            case 0x01:
                obj.messageName = value.toString('ascii');
                break;
            case 0x03:
                obj.operationNumber = value.toString('ascii');
                break;
            case 0x04:
                obj.amount = value.toString('ascii');
                break;
            case 0x05:
                obj.keepalive = value.toString('ascii');
                break;
            case 0x06:
                obj.operationTimeout = value.toString('ascii');
                break;
            case 0x07:
                obj.eventName = value.toString('ascii');
                break;
            case 0x08:
                obj.eventNumber = value.toString('ascii');
                break;
            case 0x09:
                obj.productId = value.toString('ascii');
                break;
            case 0x0f:
                obj.productName = value.toString('ascii');
                break;
            case 0x10:
                obj.posManagementData = value;
                obj.posManagement = decodePosManagementData(value);
                break;
            case 0x11:
                obj.localTime = value.toString('ascii');
                break;
            case 0x12:
                obj.systemInformation = value.toString('ascii');
                break;
            case 0x13:
                obj.receipt = value.toString('utf8');
                break;
            case 0x1c:
                obj.stageId = Number(value.toString('ascii'));
                obj.stageText = decodeStageId(obj.stageId);
                break;
            case 0x1d:
                obj.panHash = value.toString('hex');
                break;
            default:
                if (!obj.unknown) obj.unknown = [];
                obj.unknown.push({ tag, hex: value.toString('hex') });
        }
    }

    return obj;
}

function formatMessage(msg) {
    const short = { ...msg };
    if (short.posManagementData) delete short.posManagementData;
    return short;
}

class VtkClient extends EventEmitter {
    constructor({
                    host,
                    port = 62801,
                    keepaliveSec = 10,
                    operationTimeoutSec = 60,
                    waitStaBeforeVrp = false,
                    debug = true,
                    reconnectDelayMs = 5000,
                }) {
        super();

        this.host = host;
        this.port = port;
        this.keepaliveSec = keepaliveSec;
        this.operationTimeoutSec = operationTimeoutSec;
        this.waitStaBeforeVrp = waitStaBeforeVrp;
        this.debug = debug;
        this.reconnectDelayMs = reconnectDelayMs;

        this.socket = null;
        this.rxBuffer = Buffer.alloc(0);

        this.operationNumber = 0;
        this.eventNumber = 0;

        this.keepaliveTimer = null;
        this.connected = false;
        this.handshaked = false;
        this.reconnectTimer = null;
        this.isConnecting = false;
        this.manualClose = false;
    }

    log(...args) {
        if (this.debug) {
            console.log(new Date().toISOString(), '[Vendotek]', ...args);
        }
    }

    async start() {
        this.manualClose = false;
        await this.connect();
        await this.handshake();
        this.emitStatus('ready');
    }

    connect() {
        if (this.connected || this.isConnecting) {
            return Promise.resolve();
        }

        this.isConnecting = true;

        return new Promise((resolve, reject) => {
            const socket = net.createConnection(
                { host: this.host, port: this.port },
                () => {
                    this.socket = socket;
                    this.connected = true;
                    this.handshaked = false;
                    this.isConnecting = false;
                    this.emitStatus('tcp_connected');
                    resolve();
                }
            );

            socket.on('data', (chunk) => {
                this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
                const { frames, rest } = parseFrames(this.rxBuffer);
                this.rxBuffer = rest;

                for (const frame of frames) {
                    try {
                        this.handleFrame(frame);
                    } catch (err) {
                        this.emit('error', err);
                    }
                }
            });

            socket.on('error', (err) => {
                this.log('TCP error:', err.message);
                this.emitStatus('tcp_error', { message: err.message });

                if (this.isConnecting) {
                    this.isConnecting = false;
                    reject(err);
                } else {
                    this.emit('error', err);
                }
            });

            socket.on('close', () => {
                this.log('TCP closed');
                this.connected = false;
                this.handshaked = false;
                this.isConnecting = false;
                this.stopKeepalive();
                this.emitStatus('tcp_closed');
                this.emit('close');

                if (!this.manualClose) {
                    this.scheduleReconnect();
                }
            });
        });
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;

        this.emitStatus('reconnecting', { delayMs: this.reconnectDelayMs });

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;

            try {
                await this.start();
            } catch (err) {
                this.log('Reconnect failed:', err.message);
                this.scheduleReconnect();
            }
        }, this.reconnectDelayMs);
    }

    close() {
        this.manualClose = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.stopKeepalive();

        if (this.socket) {
            this.socket.end();
            this.socket.destroy();
            this.socket = null;
        }

        this.connected = false;
        this.handshaked = false;
    }

    emitStatus(type, extra = {}) {
        this.emit('status', {
            type,
            connected: this.connected,
            handshaked: this.handshaked,
            ...extra,
        });
    }

    startKeepalive() {
        this.stopKeepalive();

        this.keepaliveTimer = setInterval(() => {
            try {
                if (this.connected && this.handshaked) {
                    this.sendIdl();
                }
            } catch (err) {
                this.emit('error', err);
            }
        }, this.keepaliveSec * 1000);
    }

    stopKeepalive() {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
    }

    handleFrame(frame) {
        if (frame.discriminator !== POS_DISCRIMINATOR) {
            throw new Error(`Unexpected discriminator: 0x${frame.discriminator.toString(16)}`);
        }

        const tlvs = decodeTlvs(frame.appMessage);
        const msg = tlvsToObject(tlvs);

        if (msg.operationNumber && !Number.isNaN(Number(msg.operationNumber))) {
            this.operationNumber = Number(msg.operationNumber);
        }

        if (msg.eventNumber && !Number.isNaN(Number(msg.eventNumber))) {
            this.eventNumber = Number(msg.eventNumber);
        }

        if (msg.keepalive && Number(msg.keepalive) > 0) {
            this.keepaliveSec = Number(msg.keepalive);
            this.startKeepalive();
        }

        if (msg.operationTimeout && Number(msg.operationTimeout) > 0) {
            this.operationTimeoutSec = Number(msg.operationTimeout);
        }

        const cleanMsg = formatMessage(msg);

        this.log('RX:', cleanMsg);
        this.emit('message', cleanMsg);
        this.emit('raw', { direction: 'rx', payload: cleanMsg });

        if (msg.messageName === 'STA') this.emit('sta', cleanMsg);
        if (msg.messageName === 'INF') this.emit('info', cleanMsg);
        if (msg.messageName === 'MFR') this.emit('mfr', cleanMsg);
        if (msg.messageName === 'PRS') this.emit('prs', cleanMsg);

        if (msg.messageName === 'IDL') {
            this.emit('idleState', cleanMsg);
            this.emitStatus('idle', { pos: cleanMsg.posManagement || null });
        }

        if (msg.messageName === 'DIS') {
            this.emit('idleState', cleanMsg);
            this.emitStatus('disabled', { pos: cleanMsg.posManagement || null });
        }

        if (msg.messageName === 'VRP') {
            const approvedAmount = Number(msg.amount || '0');

            if (approvedAmount > 0) {
                this.emitStatus('approved', {
                    operationNumber: msg.operationNumber,
                    amountMinor: approvedAmount,
                });
            } else {
                this.emitStatus('declined', {
                    operationNumber: msg.operationNumber,
                    amountMinor: 0,
                });
            }
        }

        if (msg.messageName === 'FIN') {
            this.emitStatus('finalized', {
                operationNumber: msg.operationNumber,
                amountMinor: Number(msg.amount || '0'),
            });
        }
    }

    sendTlvMessage(tlvs, label = 'UNKNOWN') {
        if (!this.socket || !this.connected) {
            throw new Error('Socket is not connected');
        }

        const frame = buildMessage(VMC_DISCRIMINATOR, tlvs);
        this.socket.write(frame);
        this.log('TX:', label);
        this.emit('raw', { direction: 'tx', label });
    }

    sendIdl(extraTlvs = []) {
        const tlvs = [
            encodeTlv(0x01, encodeAscii('IDL')),
            encodeTlv(0x03, encodeAscii(String(this.operationNumber))),
        ];

        if (this.eventNumber > 0) {
            tlvs.push(encodeTlv(0x08, encodeAscii(String(this.eventNumber))));
        }

        tlvs.push(...extraTlvs);
        this.sendTlvMessage(tlvs, 'IDL');
    }

    sendDis() {
        this.sendTlvMessage([
            encodeTlv(0x01, encodeAscii('DIS')),
            encodeTlv(0x03, encodeAscii(String(this.operationNumber))),
        ], 'DIS');
    }

    sendAbr() {
        this.sendTlvMessage([
            encodeTlv(0x01, encodeAscii('ABR')),
            encodeTlv(0x03, encodeAscii(String(this.operationNumber))),
        ], 'ABR');
    }

    sendVrp({ amountMinor, productId, productName }) {
        this.operationNumber += 1;

        const tlvs = [
            encodeTlv(0x01, encodeAscii('VRP')),
            encodeTlv(0x03, encodeAscii(String(this.operationNumber))),
            encodeTlv(0x04, encodeAscii(String(amountMinor))),
        ];

        if (typeof productId !== 'undefined' && productId !== null) {
            tlvs.push(encodeTlv(0x09, encodeAscii(String(productId))));
        }

        if (typeof productName !== 'undefined' && productName !== null) {
            tlvs.push(encodeTlv(0x0f, encodeAscii(String(productName))));
        }

        this.sendTlvMessage(
            tlvs,
            `VRP amount=${amountMinor}, op=${this.operationNumber}`
        );

        return this.operationNumber;
    }

    sendFin({ amountMinor, productId, productName }) {
        const tlvs = [
            encodeTlv(0x01, encodeAscii('FIN')),
            encodeTlv(0x03, encodeAscii(String(this.operationNumber))),
            encodeTlv(0x04, encodeAscii(String(amountMinor))),
        ];

        if (typeof productId !== 'undefined' && productId !== null) {
            tlvs.push(encodeTlv(0x09, encodeAscii(String(productId))));
        }

        if (typeof productName !== 'undefined' && productName !== null) {
            tlvs.push(encodeTlv(0x0f, encodeAscii(String(productName))));
        }

        this.sendTlvMessage(
            tlvs,
            `FIN amount=${amountMinor}, op=${this.operationNumber}`
        );
    }

    waitForMessage(predicate, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout after ${timeoutMs} ms`));
            }, timeoutMs);

            const onMessage = (msg) => {
                try {
                    if (predicate(msg)) {
                        cleanup();
                        resolve(msg);
                    }
                } catch (err) {
                    cleanup();
                    reject(err);
                }
            };

            const onError = (err) => {
                cleanup();
                reject(err);
            };

            const cleanup = () => {
                clearTimeout(timer);
                this.off('message', onMessage);
                this.off('error', onError);
            };

            this.on('message', onMessage);
            this.on('error', onError);
        });
    }

    async handshake() {
        this.sendIdl();

        const resp = await this.waitForMessage(
            (msg) => msg.messageName === 'IDL' || msg.messageName === 'DIS',
            15000
        );

        this.handshaked = true;
        this.startKeepalive();
        this.emitStatus('handshake_ok', { hello: resp });
        return resp;
    }

    async waitForSta(timeoutMs = 30000) {
        this.log('Waiting for STA/MFR/PRS/INF...');

        return this.waitForMessage(
            (msg) => {
                if (msg.messageName === 'STA') return true;
                if (msg.messageName === 'MFR') return true;
                if (msg.messageName === 'PRS') return true;
                if (msg.messageName === 'INF' && typeof msg.stageId === 'number') return true;
                return false;
            },
            timeoutMs
        );
    }

    async startPayment({ amountMinor, productId, productName }) {
        if (!this.connected || !this.handshaked) {
            throw new Error('Vendotek is not ready');
        }

        if (this.waitStaBeforeVrp) {
            try {
                const trigger = await this.waitForSta(30000);
                this.log('Start trigger from POS:', trigger);
            } catch (err) {
                this.log('No STA/trigger received, trying VRP anyway...');
            }
        }

        const op = this.sendVrp({ amountMinor, productId, productName });

        this.emitStatus('payment_requested', {
            operationNumber: String(op),
            amountMinor,
            productId: productId ?? null,
            productName: productName ?? null,
        });

        const response = await this.waitForMessage(
            (msg) =>
                msg.messageName === 'VRP' &&
                String(msg.operationNumber || '') === String(op),
            this.operationTimeoutSec * 1000
        );

        const approvedAmount = Number(response.amount || '0');

        if (approvedAmount === 0) {
            this.sendIdl();
        }

        return {
            operationNumber: op,
            approved: approvedAmount > 0,
            approvedAmount,
            response,
        };
    }

    async finalizeSuccess(amountMinor, productId, productName) {
        if (!this.connected || !this.handshaked) {
            throw new Error('Vendotek is not ready');
        }

        this.sendFin({ amountMinor, productId, productName });

        const response = await this.waitForMessage(
            (msg) =>
                msg.messageName === 'FIN' &&
                String(msg.operationNumber || '') === String(this.operationNumber),
            this.operationTimeoutSec * 1000
        );

        this.sendIdl();

        return response;
    }

    getState() {
        return {
            host: this.host,
            port: this.port,
            connected: this.connected,
            handshaked: this.handshaked,
            operationNumber: this.operationNumber,
            eventNumber: this.eventNumber,
            keepaliveSec: this.keepaliveSec,
            operationTimeoutSec: this.operationTimeoutSec,
            waitStaBeforeVrp: this.waitStaBeforeVrp,
        };
    }
}

module.exports = { VtkClient };