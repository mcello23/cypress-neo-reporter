const { basename, dirname, join } = require('path');
const { renameSync } = require('fs');
const { defineConfig } = require('cypress');
const { neoReporter } = require('cypress-neo-reporter/plugin');

module.exports = defineConfig({
  video: true,
  e2e: {
    setupNodeEvents(on, config) {
      on('after:screenshot', details => {
        const name = basename(details.path);
        if (!name.startsWith('flaky -- ')) return details;
        const renamed = join(dirname(details.path), name.slice('flaky -- '.length).replace(' (failed)', ''));
        renameSync(details.path, renamed);
        return { path: renamed };
      });
      neoReporter(on, config, { reportName: 'e2e', history: false });
      return config;
    }
  }
});
