import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import api, { ApiError } from './api.js';

describe('api', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('rejects a non-success HTTP response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                error: 'order_update_failed',
                message: 'Order was not updated',
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            })
        ));

        await expect(api('/orders/1/paid')).rejects.toMatchObject({
            name: 'ApiError',
            status: 500,
            code: 'order_update_failed',
        });
    });

    it('returns parsed JSON for a successful response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ id: 42 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ));

        await expect(api('/orders/42')).resolves.toEqual({ id: 42 });
    });

    it('uses a typed error for network failures', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new TypeError('connection failed'))
        );

        await expect(api('/orders/42')).rejects.toBeInstanceOf(ApiError);
        await expect(api('/orders/42')).rejects.toMatchObject({
            code: 'network_error',
        });
    });
});
