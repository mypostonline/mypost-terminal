const path = require('path');
require('dotenv').config({
    path: path.resolve(__dirname, '.env'),
});

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { VtkClient } = require('./vendotek-client');

const VTK_HOST = process.env.VTK_HOST || '192.168.1.1';
const VTK_PORT = Number(process.env.VTK_PORT || 62801);

const app = express();

app.use(cors({
    origin: 'http://localhost:5173',
    methods: [ 'GET', 'POST', 'OPTIONS' ],
    credentials: true,
}));

app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const vendotek = new VtkClient({
    host: VTK_HOST,
    port: VTK_PORT,
    waitStaBeforeVrp: false,
    debug: true,
});

vendotek.on('status', (event) => {
    console.log(new Date().toISOString(), '[Vendotek status]', event);
    broadcast({ channel: 'vendotek-status', payload: event });
});

vendotek.on('raw', (event) => {
    console.log(new Date().toISOString(), '[Vendotek raw]', event);
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
    console.error(new Date().toISOString(), '[Vendotek error]', err);
    broadcast({
        channel: 'vendotek-error',
        payload: { message: err.message },
    });
});

function broadcast (data) {
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
        const amountMinor = Number(req.body.amountMinor);
        const productId = req.body.productId ?? 1;
        const productName = req.body.productName ?? 'WASH';

        if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
            return res.status(400).json({
                ok: false,
                error: 'amountMinor must be positive integer',
            });
        }

        const paymentResult = await vendotek.startPayment({
            amountMinor,
            productId,
            productName,
        });
        console.log(new Date().toISOString(), 'paymentResult', paymentResult);

        if (!paymentResult.approved) {
            return res.json({
                ok: true,
                payment: paymentResult
            });
        }

        const finResult = await vendotek.finalizeSuccess(
            paymentResult.approvedAmount,
            productId,
            productName,
        );
        console.log(new Date().toISOString(), 'finResult', finResult);

        res.json({
            ok: true,
            payment: paymentResult,
            fin: finResult
        });
    }
    catch (err) {
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
    console.log(new Date().toISOString(), 'Server started on http://127.0.0.1:3001');

    try {
        await vendotek.start();
        console.log(new Date().toISOString(), 'Vendotek ready');
    }
    catch (err) {
        console.error(new Date().toISOString(), 'Vendotek start failed:', err.message);
    }
});