import mqtt from 'mqtt';

let client = null;
let connectionPromise = null;
let hasConnected = false;
const topics = new Map();

const subscribeClient = (mqttClient, topic) => {
    return new Promise((resolve, reject) => {
        mqttClient.subscribe(topic, error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
};

const createClient = () => {
    const mqttClient = mqtt.connect(import.meta.env.VITE_MQTT_URL);

    mqttClient.on('connect', () => {
        if (hasConnected) {
            topics.forEach((callback, topic) => {
                subscribeClient(mqttClient, topic).catch(error => {
                    console.error(
                        `Failed to restore MQTT subscription ${topic}`,
                        error
                    );
                });
            });
        }
        hasConnected = true;
    });

    mqttClient.on('message', (topic, payload) => {
        try {
            const data = JSON.parse(payload.toString());
            const callback = topics.get(topic);
            if (callback) {
                Promise.resolve(callback(data)).catch(error => {
                    console.error(
                        `MQTT callback failed on ${topic}`,
                        error
                    );
                });
            }
        }
        catch (error) {
            console.error(`Invalid MQTT message on ${topic}`, error);
        }
    });

    mqttClient.on('error', error => {
        console.error('MQTT connection error', error);
    });

    return mqttClient;
};

export const connectMqtt = () => {
    if (!client) {
        client = createClient();
    }

    if (client.connected) {
        return Promise.resolve(client);
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    connectionPromise = new Promise((resolve, reject) => {
        const onConnect = () => {
            cleanup();
            resolve(client);
        };
        const onError = error => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            client.off('connect', onConnect);
            client.off('error', onError);
        };

        client.once('connect', onConnect);
        client.once('error', onError);
    }).finally(() => {
        connectionPromise = null;
    });

    return connectionPromise;
};

export const subscribeMqtt = async (topic, callback) => {
    if (!topic || typeof callback !== 'function') {
        throw new Error('MQTT topic and callback are required');
    }

    topics.set(topic, callback);
    const mqttClient = await connectMqtt();
    await subscribeClient(mqttClient, topic);

    return () => {
        topics.delete(topic);
        mqttClient.unsubscribe(topic);
    };
};

export const publishMqtt = async (topic, message) => {
    const mqttClient = await connectMqtt();
    return new Promise((resolve, reject) => {
        mqttClient.publish(topic, JSON.stringify(message), error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
};
