import { createPinia } from 'pinia';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePropertyStore } from './propertyStore.js';

vi.mock('@/functions/mqtt.js', () => ({
    subscribeMqtt: vi.fn(() => Promise.resolve()),
}));

let store;
const propertyData = () => ({
    id: 1,
    programs: [
        { id: 1, price: 1600, included_addons: [{ id: 10 }], excluded_addons: [{ id: 20 }] },
        { id: 2, price: 1600, included_addons: [], excluded_addons: [] },
        { id: 3, price: 1600, included_addons: [{ id: 30 }], excluded_addons: [] },
    ],
    addons: [
        { id: 10, price: 150, options: [{ id: 1 }] },
        { id: 20, price: 800, options: [{ id: 2 }] },
        { id: 30, price: 900, options: [{ id: 1 }, { id: 2 }] },
    ],
    posts: [],
});

beforeEach(() => {
    store = usePropertyStore(createPinia());
    store.property = propertyData();
});

const addon = id => store.property.addons.find(item => item.id === id);

it('enforces included and excluded addons, then clears their locks for another program', () => {
    store.setProgram(1);
    expect(addon(10).isActive).toBe(true);
    expect(addon(10).isIncluded).toBe(true);
    expect(addon(20).isExcluded).toBe(true);
    expect(addon(30).isExcluded).toBe(true);

    for (const id of [10, 20, 30]) store.selectAddon(addon(id));
    expect(store.order.total_amount).toBe(1600);
    expect(store.order.addons).toEqual([]);

    store.setProgram(2);
    expect(addon(10).isIncluded).toBe(false);
    expect(addon(20).isExcluded).toBe(false);
    expect(addon(30).isExcluded).toBe(false);
    for (const id of [10, 20]) store.selectAddon(addon(id));
    expect(store.order.total_amount).toBe(2550);
    expect(store.order.addons).toEqual([{ id: 10, quantity: 1 }, { id: 20, quantity: 1 }]);

    store.setProgram(1);
    expect(store.order.total_amount).toBe(1600);
    expect(store.order.addons).toEqual([]);
});

it('charges only the bundle while keeping separately selected options available afterward', () => {
    store.setProgram(2);
    store.selectAddon(addon(10));
    store.selectAddon(addon(20));
    store.selectAddon(addon(30));
    expect(addon(10).isComposite).toBe(true);
    expect(addon(20).isComposite).toBe(true);
    expect(store.order.total_amount).toBe(2500);
    expect(store.order.addons).toEqual([{ id: 30, quantity: 1 }]);

    store.selectAddon(addon(30));
    expect(addon(10).isComposite).toBe(false);
    expect(addon(20).isComposite).toBe(false);
    expect(store.order.total_amount).toBe(2550);
    expect(store.order.addons).toEqual([{ id: 10, quantity: 1 }, { id: 20, quantity: 1 }]);
});

it('keeps every part of an included bundle active and free until another program is chosen', () => {
    store.setProgram(3);
    expect(addon(30).isIncluded).toBe(true);
    expect(addon(10).isComposite).toBe(true);
    expect(addon(20).isComposite).toBe(true);
    expect(store.order.total_amount).toBe(1600);
    expect(store.order.addons).toEqual([]);

    store.setProgram(2);
    expect(addon(30).isActive).toBe(false);
    expect(addon(10).isComposite).toBe(false);
    expect(addon(20).isComposite).toBe(false);
    store.selectAddon(addon(20));
    expect(store.order.total_amount).toBe(2400);
    expect(store.order.addons).toEqual([{ id: 20, quantity: 1 }]);
});

it('preserves user selection through a property refresh and reapplies program restrictions', () => {
    store.setProgram(2);
    store.selectAddon(addon(20));
    store.setProperty(propertyData());
    expect(addon(20).isActive).toBe(true);
    expect(store.order.addons).toEqual([{ id: 20, quantity: 1 }]);

    const refreshed = propertyData();
    refreshed.programs[1].excluded_addons = [{ id: 20 }];
    store.setProperty(refreshed);
    expect(addon(20).isExcluded).toBe(true);
    expect(addon(20).isActive).toBe(false);
    expect(store.order.addons).toEqual([]);

    store.setProperty(propertyData());
    expect(addon(20).isExcluded).toBe(false);
    expect(addon(20).isActive).toBe(false);
    expect(store.order.addons).toEqual([]);
});
