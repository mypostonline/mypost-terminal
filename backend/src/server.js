const { startBackend } = require('./bootstrap');

const main = async () => {
    const backend = await startBackend();
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

const run = () => main().catch(error => {
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
