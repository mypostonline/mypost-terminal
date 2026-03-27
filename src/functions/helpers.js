import { DateTime } from "luxon";

export const wordEnd = (number, forms = ['проходов', 'проход', 'прохода'], zeroForm = null) => {
    if (number === 0 && zeroForm !== null) {
        return zeroForm;
    }

    const n = Math.floor(Number(number));
    const remainder100 = n % 100;
    const remainder10 = n % 10;

    if (remainder100 >= 11 && remainder100 <= 19) return forms[0];
    if (remainder10 === 1) return forms[1];
    if (remainder10 >= 2 && remainder10 <= 4) return forms[2];
    return forms[0];
}

export const wordEndPasses = (number) => {
    return number + ' ' + wordEnd(number, ['проходов', 'проход', 'прохода']);
}

export const getNumber = (number = 0) => {
    return parseFloat(number.toFixed(2)).toLocaleString('ru-RU');
}

export const getPercent = (number) => {
    return getNumber(number) + ' %';
}

export const getPrice = (number) => {
    return getNumber(number) + ' ₽';
}

export const getNo = (number) => {
    return '№ ' + number;
}
