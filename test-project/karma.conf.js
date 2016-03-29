// Karma configuration

module.exports = function(config) {
  config.set({

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',

    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['mocha', 'chai', 'source-map-support'],

    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: ['Chrome'],

    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['mocha'],

    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: false,

    autoWatch: true,

    // enable / disable colors in the output (reporters and logs)
    colors: true,

    // list of files / patterns to load in the browser

    files: [
      {
        pattern: 'client/jspm_packages/system.js',
        watched: false
      },
      {
        pattern: 'client/jspm_packages/system.js.map',
        included: false,
        watched: false
      },
      {
        pattern: 'jspm.config.js',
        watched: false
      },
      {
        pattern: 'dist/unit-tests.js',
        watched: false,
        nochache: true
      },
      {
        pattern: 'dist/unit-tests.js.map',
        included: false,
        watched: false,
        nochache: true
      }
    ],

    proxies: {
      // '/jspm_packages': '/base/jspm_packages',
      // '/jspm.config.js': '/base/jspm.config.js'
    },

    // list of files to exclude
    exclude: [],

    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO

  });
};
