const path = require('path');
const { loadConfig } = require('../src/config/env');
const { run } = require('../src/server');

const config = loadConfig({
    envFile: path.resolve(__dirname, '../.env.mock.example'),
});

run({ config });
