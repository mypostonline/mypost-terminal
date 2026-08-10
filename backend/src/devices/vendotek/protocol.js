'use strict';

const VMC_DISCRIMINATOR = 0x96fb;
const POS_DISCRIMINATOR = 0x97fb;

function encodeAscii(value) {
    return Buffer.from(String(value), 'ascii');
}

function validateAscii(value, fieldName) {
    const stringValue = String(value);

    if (!/^[\x20-\x7e]*$/.test(stringValue)) {
        throw new Error(`${fieldName} must contain ASCII characters only`);
    }

    return stringValue;
}

function encodeTlv(tag, valueBuffer) {
    if (!Buffer.isBuffer(valueBuffer)) {
        throw new Error('valueBuffer must be Buffer');
    }

    const len = valueBuffer.length;

    if (len < 0x80) {
        return Buffer.concat([
            Buffer.from([ tag ]),
            Buffer.from([ len ]),
            valueBuffer,
        ]);
    }

    if (len <= 0xff) {
        return Buffer.concat([
            Buffer.from([ tag, 0x81, len ]),
            valueBuffer,
        ]);
    }

    if (len <= 0xffff) {
        const lengthBuffer = Buffer.alloc(2);
        lengthBuffer.writeUInt16BE(len, 0);

        return Buffer.concat([
            Buffer.from([ tag, 0x82 ]),
            lengthBuffer,
            valueBuffer,
        ]);
    }

    throw new Error('TLV too long');
}

function appendProductTlvs(tlvs, { productId, productName }) {
    if (productId !== undefined && productId !== null) {
        const safeProductId = validateAscii(productId, 'productId');
        tlvs.push(encodeTlv(0x09, encodeAscii(safeProductId)));
    }

    if (productName !== undefined && productName !== null) {
        const safeProductName = validateAscii(productName, 'productName');
        tlvs.push(encodeTlv(0x0f, encodeAscii(safeProductName)));
    }
}

function decodeTlvs(buffer) {
    const items = [];
    let offset = 0;

    while (offset < buffer.length) {
        const tag = buffer[offset++];

        if (offset >= buffer.length) {
            throw new Error('TLV has no length field');
        }

        let len = buffer[offset++];

        if (len & 0x80) {
            const lenBytes = len & 0x7f;

            if (lenBytes < 1 || lenBytes > 2) {
                throw new Error(
                    `Unsupported BER length bytes count: ${lenBytes}`
                );
            }

            if (offset + lenBytes > buffer.length) {
                throw new Error('Invalid BER length');
            }

            len = 0;

            for (let i = 0; i < lenBytes; i += 1) {
                len = (len << 8) | buffer[offset++];
            }
        }

        if (offset + len > buffer.length) {
            throw new Error('TLV overruns buffer');
        }

        const value = buffer.subarray(offset, offset + len);
        offset += len;

        items.push({ tag, value });
    }

    return items;
}

function buildMessage(discriminator, tlvList) {
    const appMessage = Buffer.concat(tlvList);
    const payloadLength = 2 + appMessage.length;

    const header = Buffer.alloc(4);
    header.writeUInt16BE(payloadLength, 0);
    header.writeUInt16BE(discriminator, 2);

    return Buffer.concat([ header, appMessage ]);
}

function parseFrames(buffer) {
    const frames = [];
    let offset = 0;

    while (offset + 4 <= buffer.length) {
        const payloadLength = buffer.readUInt16BE(offset);
        const frameLength = 2 + payloadLength;

        if (payloadLength < 2) {
            throw new Error(`Invalid VTK payload length: ${payloadLength}`);
        }

        if (offset + frameLength > buffer.length) {
            break;
        }

        const discriminator = buffer.readUInt16BE(offset + 2);
        const appMessage = buffer.subarray(offset + 4, offset + frameLength);

        frames.push({ discriminator, appMessage });
        offset += frameLength;
    }

    return {
        frames,
        rest: buffer.subarray(offset),
    };
}

function decodePosManagementData(buffer) {
    const chars = buffer.toString('ascii');
    const updateCode = chars[0] || 'N';
    const traceCode = chars[1] || 'N';
    const acceptanceCode = chars[2] || 'N';

    const updateStatusMap = {
        S: 'close day scheduled',
        L: 'download scheduled',
        R: 'restart scheduled',
        N: 'unknown',
    };
    const traceStatusMap = {
        T: 'trace upload in progress',
        N: 'unknown',
    };
    const cardAcceptanceMap = {
        A: 'no general configuration',
        B: 'no bank configuration',
        C: 'invalid local time',
        D: 'disabled',
        E: 'card acceptance enabled',
        I: 'IDL/DIS receive timeout',
        J: 'job is active',
        L: 'no loyalty configuration',
        N: 'unknown',
    };

    return {
        raw: chars,
        updateStatusCode: updateCode,
        updateStatus:
            updateStatusMap[updateCode] || `unknown(${updateCode})`,
        traceStatusCode: traceCode,
        traceStatus: traceStatusMap[traceCode] || `unknown(${traceCode})`,
        cardAcceptanceCode: acceptanceCode,
        cardAcceptance:
            cardAcceptanceMap[acceptanceCode] ||
            `unknown(${acceptanceCode})`,
    };
}

function decodeStageId(stageId) {
    const map = {
        1: 'insert card',
        3: 'swipe card',
        4: 'enter PIN',
        8: 'remove card',
        18: 'scan QR',
        101: 'tap card',
        102: 'please wait',
    };

    return map[stageId] || `stage_${stageId}`;
}

function tlvsToObject(tlvs) {
    const result = {};

    for (const { tag, value } of tlvs) {
        switch (tag) {
            case 0x01:
                result.messageName = value.toString('ascii');
                break;
            case 0x03:
                result.operationNumber = value.toString('ascii');
                break;
            case 0x04:
                result.amount = value.toString('ascii');
                break;
            case 0x05:
                result.keepalive = value.toString('ascii');
                break;
            case 0x06:
                result.operationTimeout = value.toString('ascii');
                break;
            case 0x07:
                result.eventName = value.toString('ascii');
                break;
            case 0x08:
                result.eventNumber = value.toString('ascii');
                break;
            case 0x09:
                result.productId = value.toString('ascii');
                break;
            case 0x0f:
                result.productName = value.toString('ascii');
                break;
            case 0x10:
                result.posManagementData = value;
                result.posManagement = decodePosManagementData(value);
                break;
            case 0x11:
                result.localTime = value.toString('ascii');
                break;
            case 0x12:
                result.systemInformation = value.toString('ascii');
                break;
            case 0x13:
                result.receipt = value.toString('utf8');
                break;
            case 0x1c:
                result.stageId = Number(value.toString('ascii'));
                result.stageText = decodeStageId(result.stageId);
                break;
            case 0x1d:
                result.panHash = value.toString('hex');
                break;
            default:
                if (!result.unknown) {
                    result.unknown = [];
                }

                result.unknown.push({
                    tag,
                    hex: value.toString('hex'),
                });
        }
    }

    return result;
}

function formatMessage(message) {
    const shortMessage = { ...message };
    delete shortMessage.posManagementData;
    return shortMessage;
}

module.exports = {
    POS_DISCRIMINATOR,
    VMC_DISCRIMINATOR,
    appendProductTlvs,
    buildMessage,
    decodePosManagementData,
    decodeStageId,
    decodeTlvs,
    encodeAscii,
    encodeTlv,
    formatMessage,
    parseFrames,
    tlvsToObject,
    validateAscii,
};
