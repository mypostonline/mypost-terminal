const sendServiceError = (res, error, fallbackCode) => {
    const statusCode = Number(error.statusCode) || 500;

    res.status(statusCode).json({
        ok: false,
        error: error.code || fallbackCode,
        message: error.message,
    });
};

module.exports = { sendServiceError };
