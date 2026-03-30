import mqtt from 'mqtt';

let client;
const topics = new Map();

export const connectMqtt = () => new Promise((resolve, reject) => {
    if (client !== undefined) {
        return resolve(client);
    }
    client = mqtt.connect(import.meta.env.VITE_MQTT_URL);
    client.on('connect', () => {
        resolve(client);
        client.on('message', (topic, payload) => {
            const data = JSON.parse(payload.toString());
            console.log('mqtt message', data);
            if (topics.has(topic)) {
                topics.get(topic)(data);
            }
        });
    });
    client.on('error', (error) => reject(error));
});

export const subscribeMqtt = (topic, callback) => {
    connectMqtt().then(client => {
        client.subscribe(topic, (err) => {
            if (!err) {
                topics.set(topic, callback);
            }
        });
    });
}

export const publishMqtt = (topic, message) => {
    connectMqtt().then(client => {
        client.publish(topic, JSON.stringify(message));
    });
}