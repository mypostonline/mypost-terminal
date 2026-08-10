'use strict';

const {
    appendProductTlvs,
    encodeAscii,
    encodeTlv,
} = require('./protocol');

const createIdl = ({
    operationNumber,
    eventNumber = 0,
    extraTlvs = [],
}) => {
    const tlvs = [
        encodeTlv(0x01, encodeAscii('IDL')),
        encodeTlv(0x03, encodeAscii(String(operationNumber))),
    ];

    if (eventNumber > 0) {
        tlvs.push(
            encodeTlv(0x08, encodeAscii(String(eventNumber)))
        );
    }

    tlvs.push(...extraTlvs);
    return { label: 'IDL', tlvs };
};

const createDis = ({ operationNumber }) => ({
    label: 'DIS',
    tlvs: [
        encodeTlv(0x01, encodeAscii('DIS')),
        encodeTlv(0x03, encodeAscii(String(operationNumber))),
    ],
});

const createAbr = ({ operationNumber }) => ({
    label: `ABR op=${operationNumber}`,
    tlvs: [
        encodeTlv(0x01, encodeAscii('ABR')),
        encodeTlv(0x03, encodeAscii(String(operationNumber))),
    ],
});

const createVrp = ({
    operationNumber,
    amountMinor,
    productId,
    productName,
}) => {
    const amount = Number(amountMinor);

    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('amountMinor must be a positive integer');
    }

    const tlvs = [
        encodeTlv(0x01, encodeAscii('VRP')),
        encodeTlv(0x03, encodeAscii(String(operationNumber))),
        encodeTlv(0x04, encodeAscii(String(amount))),
    ];
    appendProductTlvs(tlvs, { productId, productName });

    return {
        label: `VRP amount=${amount}, op=${operationNumber}`,
        tlvs,
    };
};

const createFin = ({
    operationNumber,
    amountMinor,
    productId,
    productName,
}) => {
    const amount = Number(amountMinor);

    if (!Number.isInteger(amount) || amount < 0) {
        throw new Error(
            'FIN amountMinor must be a non-negative integer'
        );
    }

    const tlvs = [
        encodeTlv(0x01, encodeAscii('FIN')),
        encodeTlv(0x03, encodeAscii(String(operationNumber))),
        encodeTlv(0x04, encodeAscii(String(amount))),
    ];
    appendProductTlvs(tlvs, { productId, productName });

    return {
        label: `FIN amount=${amount}, op=${operationNumber}`,
        tlvs,
    };
};

module.exports = {
    createAbr,
    createDis,
    createFin,
    createIdl,
    createVrp,
};
