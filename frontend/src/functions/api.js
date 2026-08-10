const DEFAULT_TIMEOUT_MS = 15_000;

const configuredTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS);
const API_TIMEOUT_MS =
    Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
        ? configuredTimeoutMs
        : DEFAULT_TIMEOUT_MS;

export class ApiError extends Error {
    constructor (
        message,
        {
            status = 0,
            code = 'api_error',
            data = null,
            cause,
        } = {}
    ) {
        super(message, cause ? { cause } : undefined);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.data = data;
    }
}

const parseResponse = async response => {
    const text = await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    }
    catch {
        return { message: text };
    }
};

export const api = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
        Accept: 'application/json',
        ...options.headers,
    };
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs || API_TIMEOUT_MS);
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();

    options.signal?.addEventListener('abort', abortFromCaller, { once: true });

    const init = {
        method,
        headers,
        mode: 'cors',
        cache: 'no-cache',
        credentials: options.credentials || 'same-origin',
        signal: controller.signal,
    };

    const accessToken = localStorage.getItem('access_token');
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    let requestUrl = url;
    const data = options.data;

    if (method === 'GET' && data && Object.keys(data).length) {
        const searchParams = new URLSearchParams();
        Object.entries(data).forEach(([ key, value ]) => {
            if (value === undefined || value === null) {
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(item => searchParams.append(`${key}[]`, item));
            }
            else {
                searchParams.append(key, value);
            }
        });
        const query = searchParams.toString();
        if (query) {
            requestUrl += `${requestUrl.includes('?') ? '&' : '?'}${query}`;
        }
    }
    else if (method !== 'GET' && data !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(data);
    }

    const apiUrl = String(import.meta.env.VITE_API_URL || '')
        .replace(/\/$/, '');

    try {
        const response = await fetch(apiUrl + requestUrl, init);
        const responseData = await parseResponse(response);

        if (!response.ok || responseData?.ok === false) {
            throw new ApiError(
                responseData.message ||
                    responseData.error ||
                    `HTTP ${response.status}`,
                {
                    status: response.status,
                    code: responseData.code ||
                        responseData.error ||
                        'http_error',
                    data: responseData,
                }
            );
        }

        return responseData;
    }
    catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        if (error?.name === 'AbortError') {
            throw new ApiError(
                options.signal?.aborted
                    ? 'Запрос отменён'
                    : 'Превышено время ожидания ответа',
                {
                    code: options.signal?.aborted
                        ? 'request_aborted'
                        : 'request_timeout',
                    cause: error,
                }
            );
        }

        throw new ApiError('Не удалось связаться с сервером', {
            code: 'network_error',
            cause: error,
        });
    }
    finally {
        window.clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', abortFromCaller);
    }
};

export default api;
