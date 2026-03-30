const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { VtkClient } = require('./vendotek-client');

const app = express();

app.use(cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
}));

app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const vendotek = new VtkClient({
    host: '192.168.3.29',
    port: 62801,
    waitStaBeforeVrp: false,
    debug: true,
});

vendotek.on('status', (event) => {
    console.log('[Vendotek status]', event);
    broadcast({ channel: 'vendotek-status', payload: event });
});

vendotek.on('raw', (event) => {
    console.log('[Vendotek raw]', event);
    broadcast({ channel: 'vendotek-raw', payload: event });
});

vendotek.on('info', (msg) => {
    if (typeof msg.stageId === 'number') {
        broadcast({
            channel: 'vendotek-stage',
            payload: {
                stageId: msg.stageId,
                stageText: msg.stageText,
            },
        });
    }
});

vendotek.on('error', (err) => {
    console.error('[Vendotek error]', err);
    broadcast({
        channel: 'vendotek-error',
        payload: { message: err.message },
    });
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}

app.get('/api/status', (req, res) => {
    res.json({ ok: true, status: 'backend works' });
});

app.post('/api/pay', async (req, res) => {
    try {

        //const delay = ms => new Promise(res => setTimeout(res, ms));
        //await delay(5000);

        /*
        res.json({
            ok: true,
            result: {
                operationNumber: 5,
                approved: true,
                approvedAmount: 500,
                response: {
                    messageName: "VRP",
                    operationNumber: "5",
                    amount: "500"
                }
            }
        });
        */

        /*
        res.json({
            ok: true,
            result: {
                operationNumber: 5,
                approved: false,
                approvedAmount: 0,
                response: {
                    messageName: "VRP",
                    operationNumber: "5",
                    amount: "0"
                }
            }
        });
        return;
        */


        const amountMinor = Number(req.body.amountMinor);
        const productId = req.body.productId ?? 1;
        const productName = req.body.productName ?? 'WASH';

        if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
            return res.status(400).json({
                ok: false,
                error: 'amountMinor must be positive integer',
            });
        }

        const result = await vendotek.startPayment({
            amountMinor,
            productId,
            productName,
        });

        res.json({
            ok: true,
            result,
        });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err.message,
        });
    }
});

app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

server.listen(3001, async () => {
    console.log('Server started on http://0.0.0.0:3001');

    try {
        await vendotek.start();
        console.log('Vendotek ready');
    } catch (err) {
        console.error('Vendotek start failed:', err.message);
    }
});