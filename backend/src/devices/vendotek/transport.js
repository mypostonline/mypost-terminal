'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const { parseFrames } = require('./protocol');

class VendotekTransport extends EventEmitter {
    constructor({
        host,
        port = 62801,
        createConnection = net.createConnection,
    }) {
        super();

        if (!host) {
            throw new Error('Vendotek host is required');
        }

        const normalizedPort = Number(port);
        if (
            !Number.isInteger(normalizedPort) ||
            normalizedPort < 1 ||
            normalizedPort > 65535
        ) {
            throw new Error('port must be an integer between 1 and 65535');
        }
        if (typeof createConnection !== 'function') {
            throw new Error('createConnection must be a function');
        }

        this.host = host;
        this.port = normalizedPort;
        this.createConnection = createConnection;

        this.socket = null;
        this.rxBuffer = Buffer.alloc(0);
        this.connected = false;
        this.isConnecting = false;
        this.connectPromise = null;
    }

    connect() {
        if (this.connected) {
            return Promise.resolve();
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.isConnecting = true;
        this.connectPromise = new Promise((resolve, reject) => {
            let settled = false;
            const socket = this.createConnection({
                host: this.host,
                port: this.port,
            });

            this.socket = socket;
            this.rxBuffer = Buffer.alloc(0);

            socket.setNoDelay(true);
            socket.setKeepAlive(true, 10000);

            socket.once('connect', () => {
                if (this.socket !== socket) {
                    if (!settled) {
                        settled = true;
                        reject(new Error('TCP connection was superseded'));
                    }
                    socket.destroy();
                    return;
                }

                settled = true;
                this.connected = true;
                this.isConnecting = false;
                this.emit('connect');
                resolve();
            });

            socket.on('data', chunk => {
                if (this.socket !== socket) {
                    return;
                }

                try {
                    this.rxBuffer = Buffer.concat([
                        this.rxBuffer,
                        chunk,
                    ]);

                    const { frames, rest } = parseFrames(this.rxBuffer);
                    this.rxBuffer = rest;

                    for (const frame of frames) {
                        this.emit('frame', frame);
                    }
                }
                catch (error) {
                    this.emit('protocolError', error);
                    socket.destroy();
                }
            });

            socket.on('error', error => {
                if (this.socket !== socket) {
                    return;
                }

                const beforeConnect = !settled;
                this.emit('socketError', { error, beforeConnect });

                if (beforeConnect) {
                    settled = true;
                    this.isConnecting = false;
                    reject(error);
                }
            });

            socket.on('close', () => {
                if (this.socket !== socket) {
                    return;
                }

                const beforeConnect = !settled;
                if (beforeConnect) {
                    settled = true;
                    reject(new Error('TCP connection closed before connect'));
                }

                this.connected = false;
                this.isConnecting = false;
                this.socket = null;
                this.rxBuffer = Buffer.alloc(0);
                this.emit('close', { beforeConnect });
            });
        }).finally(() => {
            this.connectPromise = null;
        });

        return this.connectPromise;
    }

    send(frame) {
        if (!this.socket || this.socket.destroyed) {
            throw new Error('Socket is not connected');
        }

        this.socket.write(frame);
    }

    destroy() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
        }
    }

    close() {
        const socket = this.socket;

        if (socket) {
            socket.end();
            socket.destroy();
        }
        else {
            this.rxBuffer = Buffer.alloc(0);
        }

        this.connected = false;
        this.isConnecting = false;
    }
}

module.exports = { VendotekTransport };
