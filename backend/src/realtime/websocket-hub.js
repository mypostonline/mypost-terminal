const WebSocket = require('ws');

const createWebSocketHub = ({
    server,
    path = '/ws',
    getInitialMessages = () => [],
}) => {
    const wss = new WebSocket.Server({ server, path });

    const broadcast = data => {
        const message = JSON.stringify(data);

        for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    };

    wss.on('connection', client => {
        for (const message of getInitialMessages()) {
            client.send(JSON.stringify(message));
        }
    });

    const close = () => new Promise(resolve => {
        for (const client of wss.clients) {
            client.terminate();
        }

        wss.close(() => resolve());
    });

    return {
        broadcast,
        close,
        server: wss,
    };
};

module.exports = { createWebSocketHub };
