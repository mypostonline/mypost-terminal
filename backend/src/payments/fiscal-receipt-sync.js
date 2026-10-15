const fs = require('node:fs');
const path = require('node:path');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MATCH_WINDOW_MS = 5 * 60 * 1000;
const DELIVERED_AGE_MS = 24 * 60 * 60 * 1000;

function parseFiscalQr(qr, timezoneOffsetMinutes) {
    if (typeof qr !== 'string' || qr.length > 512) return null;
    const params = new URLSearchParams(qr);
    const keys = [ 't', 's', 'fn', 'i', 'fp', 'n' ];
    if ([ ...params.keys() ].length !== keys.length ||
        keys.some(key => params.getAll(key).length !== 1)) return null;
    const [ time, sum, fn, documentNumber, sign, operationType ] =
        keys.map(key => params.get(key));
    if (!/^\d{8}T\d{4}(?:\d{2})?$/.test(time) ||
        !/^\d{1,9}\.\d{2}$/.test(sum) ||
        !/^\d{16}$/.test(fn) ||
        !/^\d{1,10}$/.test(documentNumber) ||
        !/^\d{1,10}$/.test(sign) ||
        !/^[1-4]$/.test(operationType)) return null;
    const amountMinor = Number(sum.replace('.', ''));
    const fiscalAt = Date.UTC(
        Number(time.slice(0, 4)), Number(time.slice(4, 6)) - 1,
        Number(time.slice(6, 8)), Number(time.slice(9, 11)),
        Number(time.slice(11, 13)), Number(time.slice(13, 15) || 0)
    ) - timezoneOffsetMinutes * 60_000;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
        !Number.isFinite(fiscalAt)) return null;
    return { qr, amountMinor, fiscalAt, fn, documentNumber, sign };
}

class FiscalReceiptSync {
    constructor ({ terminal, cashPayments, cardPayments, config, logger = console,
        fetchImpl = global.fetch, now = () => Date.now() }) {
        this.terminal = terminal;
        this.cashPayments = cashPayments;
        this.cardPayments = cardPayments;
        this.config = config || {};
        this.logger = logger;
        this.fetchImpl = fetchImpl;
        this.now = now;
        this.candidates = [];
        this.pendingQr = [];
        this.outbox = [];
        this.delivered = [];
        this.flushing = false;
        this.timer = null;
        this.enabled = Boolean(this.config.apiUrl);
        this.onCash = event => this.handlePayment('cash', event);
        this.onCard = event => this.handlePayment('card', event);
        this.onMessage = message => this.handleMessage(message);
    }

    start () {
        if (!this.enabled) {
            this.logger.log(new Date().toISOString(),
                '[Fiscal receipt sync] disabled: configure FISCAL_RECEIPT_API_URL');
            return;
        }
        if (!/^https?:\/\//.test(this.config.apiUrl)) {
            throw new Error('FISCAL_RECEIPT_API_URL must be an HTTP(S) URL');
        }
        this.loadOutbox();
        this.matchPending();
        this.terminal.on('message', this.onMessage);
        this.cashPayments.on('event', this.onCash);
        this.cardPayments.on('event', this.onCard);
        this.timer = setInterval(() => void this.flush(), 30_000);
        this.timer.unref?.();
        void this.flush();
    }

    stop () {
        if (this.timer) clearInterval(this.timer);
        this.terminal.off('message', this.onMessage);
        this.cashPayments.off('event', this.onCash);
        this.cardPayments.off('event', this.onCard);
    }

    loadOutbox () {
        try {
            const state = JSON.parse(fs.readFileSync(this.config.outboxFile, 'utf8'));
            if (Array.isArray(state)) {
                this.outbox = state;
            } else if (state && Array.isArray(state.outbox) &&
                Array.isArray(state.candidates) && Array.isArray(state.pendingQr)) {
                this.outbox = state.outbox;
                this.candidates = state.candidates;
                this.pendingQr = state.pendingQr;
                this.delivered = Array.isArray(state.delivered) ? state.delivered : [];
            } else {
                throw new Error('invalid fiscal receipt sync state');
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    saveOutbox () {
        const file = this.config.outboxFile;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({
            outbox: this.outbox,
            candidates: this.candidates,
            pendingQr: this.pendingQr,
            delivered: this.delivered,
        }, null, 2));
        fs.renameSync(temporary, file);
    }

    handlePayment (method, event) {
        if (!this.enabled || event.event !== 'completed') return;
        const session = event.session;
        if (method === 'cash' && session?.fiscalization?.state !== 'completed') return;
        const number = method === 'cash'
            ? session?.fiscalization?.eventNumber : session?.operationNumber;
        const amountMinor = method === 'cash'
            ? session?.fiscalization?.amountMinor : session?.approvedAmountMinor;
        if (!session?.id || !/^\d+$/.test(String(session.orderId)) ||
            !/^\d+$/.test(String(number)) || !Number.isInteger(Number(amountMinor)) ||
            Number(amountMinor) <= 0) return;
        this.candidates = this.candidates.filter(candidate => candidate.sessionId !== session.id);
        this.candidates.push({
            orderId: Number(session.orderId), sessionId: session.id,
            method, number: String(number), amountMinor: Number(amountMinor),
            acceptedAmountMinor: method === 'cash'
                ? Number(session.acceptedAmountMinor || amountMinor)
                : Number(amountMinor),
            completedAt: Date.parse(session.completedAt) || this.now(),
        });
        this.persistState();
        this.matchPending();
    }

    handleMessage (message) {
        if (!this.enabled || !message?.fiscalQr) return;
        const receipt = parseFiscalQr(message.fiscalQr, this.config.timezoneOffsetMinutes);
        if (!receipt) {
            this.logger.error('[Fiscal receipt sync] invalid Vendotek QR', message.fiscalQr);
            return;
        }
        const key = `${receipt.fn}:${receipt.documentNumber}`;
        if (this.delivered.some(item => item.key === key) ||
            this.outbox.some(job => job.key === key) ||
            this.pendingQr.some(item => item.key === key)) return;
        this.pendingQr.push({ key, receipt, message, receivedAt: this.now() });
        this.persistState();
        this.matchPending();
    }

    persistState () {
        try {
            this.saveOutbox();
        } catch (error) {
            this.logger.error('[Fiscal receipt sync] state write failed', error);
        }
    }

    matchPending () {
        const cutoff = this.now() - MAX_AGE_MS;
        this.candidates = this.candidates.filter(item => item.completedAt >= cutoff);
        this.pendingQr = this.pendingQr.filter(item => item.receivedAt >= cutoff);
        this.delivered = this.delivered.filter(item =>
            item.at >= this.now() - DELIVERED_AGE_MS);
        for (const item of [ ...this.pendingQr ]) {
            const matches = this.candidates.filter(candidate =>
                candidate.amountMinor === item.receipt.amountMinor &&
                Math.abs(candidate.completedAt - item.receipt.fiscalAt) <= MATCH_WINDOW_MS &&
                (candidate.method === 'cash'
                    ? String(item.message.eventNumber ?? '') === candidate.number
                    : String(item.message.operationNumber ?? '') === candidate.number)
            );
            if (matches.length !== 1) {
                if (matches.length > 1) {
                    this.logger.error('[Fiscal receipt sync] ambiguous receipt match',
                        { key: item.key, orderIds: matches.map(match => match.orderId) });
                }
                continue;
            }
            const match = matches[0];
            const body = {
                qr: item.receipt.qr,
                payment_method: match.method,
                terminal_session_id: match.sessionId,
                accepted_amount_minor: match.acceptedAmountMinor,
                ...(match.method === 'cash'
                    ? { vendotek_event_number: match.number }
                    : { vendotek_operation_number: match.number }),
            };
            this.outbox.push({ key: item.key, orderId: match.orderId, body });
            this.pendingQr = this.pendingQr.filter(pending => pending !== item);
            this.candidates = this.candidates.filter(candidate => candidate !== match);
            this.persistState();
            this.logger.log('[Fiscal receipt sync] queued',
                { orderId: match.orderId, qr: item.receipt.qr });
            void this.flush();
        }
    }

    async flush () {
        if (!this.enabled || this.flushing) return;
        this.flushing = true;
        try {
            for (const job of [ ...this.outbox ]) {
                try {
                    const base = this.config.apiUrl.replace(/\/+$/, '');
                    const response = await this.fetchImpl(
                        `${base}/orders/${job.orderId}/fiscal-receipt`, {
                            method: 'POST',
                            headers: {
                                'content-type': 'application/json',
                            },
                            body: JSON.stringify(job.body),
                            signal: AbortSignal.timeout(10_000),
                        }
                    );
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    this.outbox = this.outbox.filter(item => item !== job);
                    this.delivered.push({ key: job.key, at: this.now() });
                    this.persistState();
                    this.logger.log('[Fiscal receipt sync] saved',
                        { orderId: job.orderId, key: job.key });
                } catch (error) {
                    this.logger.error('[Fiscal receipt sync] delivery failed',
                        { orderId: job.orderId, key: job.key, error: error.message });
                }
            }
        } finally {
            this.flushing = false;
        }
    }
}

module.exports = { FiscalReceiptSync, parseFiscalQr };
