import { describe, expect, it } from 'vitest';
import {
    createBalanceCreditPayload,
    createCashBillPayload,
} from './cashOrderApi.js';

const bill = {
    id: 'bill-1',
    sequence: 1,
    amountMinor: 5_000,
    acceptedAt: '2026-08-13T10:00:00.000Z',
};

describe('cash order API payloads', () => {
    it('links every bill to its cash session', () => {
        expect(createCashBillPayload({
            sessionId: 'session-1',
            bill,
        })).toEqual({
            cash_session_id: 'session-1',
            bill_id: 'bill-1',
            sequence: 1,
            amount: 50,
            accepted_at: '2026-08-13T10:00:00.000Z',
        });
    });

    it('includes the accepted bills in a balance credit request', () => {
        expect(createBalanceCreditPayload({
            session: {
                id: 'session-1',
                acceptedAmountMinor: 5_000,
                bills: [ bill ],
            },
        })).toEqual({
            cash_session_id: 'session-1',
            amount: 50,
            bills: [ {
                cash_session_id: 'session-1',
                bill_id: 'bill-1',
                sequence: 1,
                amount: 50,
                accepted_at: '2026-08-13T10:00:00.000Z',
            } ],
        });
    });
});
