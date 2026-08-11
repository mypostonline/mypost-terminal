import { describe, expect, it } from 'vitest';
import { isPostAcceptingOrders } from './postAvailability.js';

describe('post availability', () => {
    it.each([ 'online', 'busy', 'BUSY' ])(
        'accepts new orders when the post status is %s',
        status => {
            expect(isPostAcceptingOrders({ status })).toBe(true);
        }
    );

    it.each([ 'offline', 'maintenance', '', null ])(
        'rejects new orders when the post status is %s',
        status => {
            expect(isPostAcceptingOrders({ status })).toBe(false);
        }
    );

    it('rejects a missing post', () => {
        expect(isPostAcceptingOrders(null)).toBe(false);
    });
});
