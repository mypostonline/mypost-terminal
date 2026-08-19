const QR_SVG_PATH = '/qr/svg';

export const createQrImageUrl = ({ text, apiUrl }) => {
    const normalizedText = String(text ?? '').trim();

    if (!normalizedText) {
        return '';
    }

    const normalizedApiUrl = String(apiUrl ?? '').trim().replace(/\/+$/, '');
    const searchParams = new URLSearchParams({ text: normalizedText });

    return `${normalizedApiUrl}${QR_SVG_PATH}?${searchParams.toString()}`;
};

export const getQrImageUrl = text => createQrImageUrl({
    text,
    apiUrl: import.meta.env.VITE_API_URL,
});
