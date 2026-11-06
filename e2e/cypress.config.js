const { defineConfig } = require('cypress');
const { neoReporter } = require('cypress-neo-reporter/plugin');

module.exports = defineConfig({
  video: true,
  e2e: {
    setupNodeEvents(on, config) {
      neoReporter(on, config, { reportName: 'e2e', history: false });
      return config;
    }
  }
});
