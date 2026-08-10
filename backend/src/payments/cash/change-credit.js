const {
    createHmac,
    timingSafeEqual,
} = require('crypto');

const TOKEN_VERSION = 1;

class CashChangeCreditService {
    constructor ({
        urlTemplate = '',
        tokenSecret = '',
        tokenTtlSec = 24 * 60 * 60,
        now = () => Date.now(),
    } = {}) {
        if (
            !Number.isFinite(Number(tokenTtlSec)) ||
            Number(tokenTtlSec) <= 0
        ) {
            throw new Error('tokenTtlSec must be positive');
        }

        this.urlTemplate = String(urlTemplate).trim();
        this.tokenSecret = String(tokenSecret);
        this.tokenTtlSec = Number(tokenTtlSec);
        this.now = now;
    }

    isConfigured () {
        return Boolean(this.urlTemplate && this.tokenSecret);
    }

    sign (encodedPayload) {
        return createHmac('sha256', this.tokenSecret)
            .update(encodedPayload)
            .digest('base64url');
    }

    buildUrl (token) {
        const encodedToken = encodeURIComponent(token);

        if (this.urlTemplate.includes('{token}')) {
            return this.urlTemplate.replaceAll('{token}', encodedToken);
        }

        const separator = this.urlTemplate.includes('?') ? '&' : '?';
        return `${this.urlTemplate}${separator}token=${encodedToken}`;
    }

    createClaim ({ sessionId, orderId, amountMinor }) {
        const normalizedAmount = Number(amountMinor);
        if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
            throw new Error('Change amount must be a positive integer');
        }

        if (!this.isConfigured()) {
            return {
                status: 'configuration_required',
                amountMinor: normalizedAmount,
                qrPayload: null,
                expiresAt: null,
            };
        }

        const issuedAt = Math.floor(this.now() / 1000);
        const expiresAt = issuedAt + this.tokenTtlSec;
        const payload = {
            version: TOKEN_VERSION,
            type: 'cash_change',
            sessionId: String(sessionId),
            orderId: String(orderId),
            amountMinor: normalizedAmount,
            issuedAt,
            expiresAt,
        };
        const encodedPayload = Buffer.from(JSON.stringify(payload))
            .toString('base64url');
        const token = `${encodedPayload}.${this.sign(encodedPayload)}`;

        return {
            status: 'pending',
            amountMinor: normalizedAmount,
            qrPayload: this.buildUrl(token),
            expiresAt: new Date(expiresAt * 1000).toISOString(),
        };
    }

    verifyToken (token) {
        if (!this.isConfigured()) {
            throw new Error('Cash change credit is not configured');
        }

        const [ encodedPayload, signature, ...rest ] = String(token).split('.');
        if (!encodedPayload || !signature || rest.length > 0) {
            throw new Error('Invalid cash change token');
        }

        const expectedSignature = this.sign(encodedPayload);
        const actualBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSignature);
        if (
            actualBuffer.length !== expectedBuffer.length ||
            !timingSafeEqual(actualBuffer, expectedBuffer)
        ) {
            throw new Error('Invalid cash change token signature');
        }

        let payload;
        try {
            payload = JSON.parse(
                Buffer.from(encodedPayload, 'base64url').toString('utf8')
            );
        }
        catch {
            throw new Error('Invalid cash change token payload');
        }

        if (
            payload.version !== TOKEN_VERSION ||
            payload.type !== 'cash_change' ||
            !Number.isInteger(payload.amountMinor) ||
            payload.amountMinor <= 0
        ) {
            throw new Error('Invalid cash change token payload');
        }
        if (Number(payload.expiresAt) <= Math.floor(this.now() / 1000)) {
            throw new Error('Cash change token expired');
        }

        return payload;
    }
}

module.exports = { CashChangeCreditService };
