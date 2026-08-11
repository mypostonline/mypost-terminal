const { startBackend } = require('./bootstrap');

const main = async options => {
    const backend = await startBackend(options);
    let isShuttingDown = false;

    const shutdown = async signal => {
        if (isShuttingDown) {
            return;
        }

        isShuttingDown = true;
        console.log(
            new Date().toISOString(),
            `Received ${signal}, shutting down`
        );

        try {
            await backend.stop();
        }
        catch (error) {
            console.error(
                new Date().toISOString(),
                'Backend shutdown failed:',
                error.message
            );
            process.exitCode = 1;
        }
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    return backend;
};

const run = options => main(options).catch(error => {
    console.error(
        new Date().toISOString(),
        'Backend startup failed:',
        error
    );
    process.exitCode = 1;
});

if (require.main === module) {
    run();
}

module.exports = { main, run };
