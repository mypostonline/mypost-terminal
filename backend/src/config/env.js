const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../../.env');

const readNumber = (env, key, fallback, { min } = {}) => {
    const rawValue = env[key];
    const value = rawValue === undefined || rawValue === ''
        ? fallback
        : Number(rawValue);

    if (!Number.isFinite(value) || (min !== undefined && value < min)) {
        throw new Error(`Invalid numeric environment variable ${key}`);
    }

    return value;
};

const readNumberList = (env, key, fallback) => {
    const rawValue = env[key];
    const values = rawValue === undefined || rawValue === ''
        ? fallback
        : String(rawValue).split(',');
    const numbers = values.map(value => Number(String(value).trim()));

    if (
        numbers.length === 0 ||
        numbers.some(value => !Number.isFinite(value) || value <= 0)
    ) {
        throw new Error(`Invalid numeric list environment variable ${key}`);
    }

    return [ ...new Set(numbers) ];
};

const loadConfig = ({
    env = process.env,
    envFile = DEFAULT_ENV_FILE,
} = {}) => {
    if (envFile) {
        dotenv.config({ path: envFile, quiet: true });
    }

    return {
        server: {
            port: readNumber(env, 'PORT', 3001, { min: 1 }),
            corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
        },
        debug: env.DEBUG === 'true',
        vendotek: {
            enabled: env.VENDETEK_ENABLED !== 'false',
            host: env.VTK_HOST || '192.168.1.1',
            port: readNumber(env, 'VTK_PORT', 62801, { min: 1 }),
            paymentWaitSec: readNumber(
                env,
                'PAYMENT_WAIT_SEC',
                60,
                { min: 1 }
            ),
        },
        billAcceptor: {
            mode: env.BILL_ACCEPTOR_MODE || 'disabled',
            gpioChip: env.BILL_ACCEPTOR_GPIO_CHIP || 'gpiochip0',
            gpioLine: env.BILL_ACCEPTOR_GPIO_LINE || '17',
            rubPerPulse: readNumber(
                env,
                'BILL_ACCEPTOR_RUB_PER_PULSE',
                50,
                { min: 1 }
            ),
            debounceMs: readNumber(
                env,
                'BILL_ACCEPTOR_DEBOUNCE_MS',
                70,
                { min: 0 }
            ),
            packetGapMs: readNumber(
                env,
                'BILL_ACCEPTOR_PACKET_GAP_MS',
                1200,
                { min: 1 }
            ),
            maxPacketTimeMs: readNumber(
                env,
                'BILL_ACCEPTOR_MAX_PACKET_TIME_MS',
                3000,
                { min: 1 }
            ),
            validAmountsRub: readNumberList(
                env,
                'BILL_ACCEPTOR_VALID_AMOUNTS',
                [ 50, 100, 500, 1000 ]
            ),
            gpiomonCommand:
                env.BILL_ACCEPTOR_GPIOMON_COMMAND || 'gpiomon',
        },
        cashPayment: {
            allowOverpayment: env.CASH_ALLOW_OVERPAYMENT !== 'false',
            timeoutSec: readNumber(
                env,
                'CASH_PAYMENT_TIMEOUT_SEC',
                300,
                { min: 1 }
            ),
            changeCreditUrlTemplate:
                env.CASH_CHANGE_CREDIT_URL_TEMPLATE || '',
            changeCreditTokenSecret:
                env.CASH_CHANGE_TOKEN_SECRET || '',
            changeCreditTokenTtlSec: readNumber(
                env,
                'CASH_CHANGE_TOKEN_TTL_SEC',
                86400,
                { min: 1 }
            ),
        },
    };
};

module.exports = {
    DEFAULT_ENV_FILE,
    loadConfig,
    readNumber,
    readNumberList,
};
