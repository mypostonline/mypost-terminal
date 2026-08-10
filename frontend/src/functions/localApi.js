export class LocalApiError extends Error {
    constructor (
        message,
        {
            status = 0,
            code = 'local_api_error',
            data = null,
            cause,
        } = {}
    ) {
        super(message, cause ? { cause } : undefined);
        this.name = 'LocalApiError';
        this.status = status;
        this.code = code;
        this.data = data;
    }
}

export const localApi = async (
    url,
    {
        method = 'GET',
        data,
        timeoutMs = 5_000,
        signal,
    } = {}
) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });

    const headers = {
        Accept: 'application/json',
    };
    const init = {
        method,
        headers,
        cache: 'no-store',
        signal: controller.signal,
    };

    if (data !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(url, init);
        const responseData = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new LocalApiError(
                responseData.message ||
                    responseData.error ||
                    `HTTP ${response.status}`,
                {
                    status: response.status,
                    code: responseData.error || 'http_error',
                    data: responseData,
                }
            );
        }

        return responseData;
    }
    catch (error) {
        if (error instanceof LocalApiError) {
            throw error;
        }
        if (error?.name === 'AbortError') {
            throw new LocalApiError(
                signal?.aborted
                    ? 'Запрос отменён'
                    : 'Локальный сервис не отвечает',
                {
                    code: signal?.aborted
                        ? 'request_aborted'
                        : 'request_timeout',
                    cause: error,
                }
            );
        }

        throw new LocalApiError('Локальный сервис недоступен', {
            code: 'network_error',
            cause: error,
        });
    }
    finally {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', abortFromCaller);
    }
};

export default localApi;
