const test = require('node:test');
const assert = require('node:assert/strict');
const {
    VMC_DISCRIMINATOR,
    buildMessage,
    decodeTlvs,
    encodeAscii,
    encodeTlv,
    parseFrames,
    tlvsToObject,
} = require('./protocol');

test('encodes and decodes a Vendotek application message', () => {
    const frame = buildMessage(VMC_DISCRIMINATOR, [
        encodeTlv(0x01, encodeAscii('IDL')),
        encodeTlv(0x03, encodeAscii('17')),
    ]);
    const parsed = parseFrames(frame);
    const message = tlvsToObject(decodeTlvs(parsed.frames[0].appMessage));

    assert.equal(parsed.rest.length, 0);
    assert.equal(parsed.frames[0].discriminator, VMC_DISCRIMINATOR);
    assert.deepEqual(message, {
        messageName: 'IDL',
        operationNumber: '17',
    });
});

test('keeps an incomplete frame for the next TCP chunk', () => {
    const frame = buildMessage(VMC_DISCRIMINATOR, [
        encodeTlv(0x01, encodeAscii('STA')),
    ]);
    const firstChunk = frame.subarray(0, frame.length - 1);
    const parsed = parseFrames(firstChunk);

    assert.deepEqual(parsed.frames, []);
    assert.deepEqual(parsed.rest, firstChunk);
});

test('supports BER lengths larger than one byte', () => {
    const value = Buffer.alloc(200, 0x41);
    const encoded = encodeTlv(0x13, value);
    const decoded = decodeTlvs(encoded);

    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].tag, 0x13);
    assert.deepEqual(decoded[0].value, value);
});
