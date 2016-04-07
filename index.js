'use strict';

var chokidar = require('chokidar');
var globby = require('globby');
var fs = require('fs-extra');
var _ = require('lodash');
var path = require('path');
var fancyLog = require('fancy-log');
var chalk = require('chalk');
var events = require('events');
var minimatch = require('minimatch');
var format = require('string-format');
var cp = require('child_process');

format.extend(String.prototype, {});

//fixes issue with too many listeners warning on jspm config change
process.setMaxListeners(Infinity);

class Watcher {

    constructor (options) {

        this._logPrefix = 'JSPM Watch: ';

        this._messages = {

            jspmError: 'Error managing JSPM module!',
            jspmConfigChanged: 'JSPM config was changed.',
            nothingToBuild: 'Nothing to build, check your configuration!',
            nothingToWatch: 'Nothing to watch, check your configuration!',
            tracingError: 'Oops! Tracing error happened. A process restart is required now.',

            app: {
                buildingAll: 'Building entire app...',
                buildingProgressTemplate: 'Building entire app: [:bar] :percent',
                buildingAfterError: 'Building after an error...',
                buildingModules: 'Building app ({changes})...',
                moduleChanged: 'Module \'{moduleName}\' was {event}.',
                moduleNoBundle: 'Module \'{moduleName}\' was {event}, but it\'s not in the build cache (not imported in the application).',
                buildSuccess: 'App build finished successfully in {time}.',
                buildFail: 'App build failed\n{error}'
            },
            tests: {
                buildingAll: 'Building all unit tests...',
                buildingProgressTemplate: 'Building all unit tests: [:bar] :percent',
                buildingAfterError: 'Building unit tests after an error...',
                buildingModules: 'Building unit tests ({changes})...',
                moduleChanged: 'Module \'{moduleName}\' was {event}.',
                moduleNoBundle: 'Module \'{moduleName}\' was {event}, but it\'s not in the build cache (not covered by unit tests).',
                buildSuccess: 'Unit tests build finished successfully in {time}.',
                buildFail: 'Unit tests build failed\n{error}'
            }

        };

        this._eventQueue = [];
        this.emitter = new events.EventEmitter();
        this._path = this._path || path;
        this._globby = this._globby || globby;
        this._fs = this._fs || fs;
        this._isDebugEnabled = options.debug;
        this._jspmConf = this._getJspmPackageJson();

        this._conf = {
            app: {},
            tests: {}
        };

        this._setupOptions(options.app, this._conf.app);

        this._watchExpression = [this._jspmConf.configFile, '!' + this._jspmConf.packages + '/**/*'];

        if (!this._conf.app.watch) {

            this._debug('No custom watch for app supplied, using trace to get files to watch');
            this._useTrace = true;

        } else {

            this._watchExpression.concat(this._conf.app.watch);

        }

        this._buildBatchDelay = options.batchDelay || 250;
        this._jspmConfigBuildDelay = 2000;

        this._setupOptions(options.tests, this._conf.tests);

        if (!this._conf.tests.skipBuild) {

            this._watchExpression = this._watchExpression.concat(this._conf.tests.watch);

        }

        this._watchIgnored = [];

        if (!this._conf.tests.skipBuild) {

            this._watchIgnored.push(this._conf.tests.input, this._conf.tests.output);

        }

        if (!this._conf.app.skipBuild) {

            this._watchIgnored.push(this._conf.app.output);

        }

        this._debug('Contructred with conf:', this._conf);
        this._debug('Batch delay is ' + this._buildBatchDelay);
        this._debug('JSPM config change delay is ' + this._jspmConfigBuildDelay);
        this._debug('JSPM Config:', this._jspmConf);
        this._debug('WatchExpression:', this._watchExpression);
        this._debug('Ignored:', this._watchIgnored);

        this._progressPromiseStorage = {};

        process.on('exit', this._removeTestsImportFile.bind(this));

    }

    start (options) {

        this._progressProcess = cp.fork(`${__dirname}/lib/progress.js`);

        this._progressProcess.on('message', this._processProgressMessage.bind(this));

        this._progressCall('init', {
            logPrefix: chalk.blue(this._logPrefix),
            template: this._messages.progressTemplate
        });

        if (options && options.appOnly) {

            this._conf.tests.skipBuild = true;

        }

        if (options && options.testsOnly) {

            this._conf.app.skipBuild = true;

        }

        this._initBuilder();
        this._initWatch();

        if (this._useTrace && !this._conf.app.skipBuild) {

            this._updateFilesToWatch(this._conf.app, this._appBuildState);

        }

        return this;

    }

    on () {

        return this.emitter.on.apply(this.emitter, arguments);

    }

    once () {

        return this.emitter.once.apply(this.emitter, arguments);

    }

    _progressCall (method) {

        let promiseId = Math.random();

        let promise = new Promise((resolve, reject) => {

            this._progressPromiseStorage[promiseId] = {
                resolve: resolve,
                reject: reject
            }

        });

        this._progressProcess.send({
            id: promiseId,
            method: method,
            arguments: Array.prototype.slice.call(arguments, this._progressCall.length)
        });

        return promise;

    }

    _processProgressMessage (message) {

        if (message.id && this._progressPromiseStorage[message.id]) {

            let promise = this._progressPromiseStorage[message.id];

            if (!message.hasError) {

                promise.resolve(message.data);

            } else {

                promise.reject(message.error);

            }

        }

    }

    _initBuilder () {

        try {

            this._invalidateParentModule('jspm');
            this._jspm = module.parent.require('jspm');

        } catch (e) {

            throw new Error(this._messages.jspmError);

        }

        this._builder = new this._jspm.Builder();

        // initial build state
        this._appBuildState = {
            entireBuild: true,
            hasError: false,
            changedModules: [],
            tracedFiles: [],
            inProgress: false
        };

        this._testsBuildState = {
            entireBuild: true,
            hasError: false,
            changedModules: [],
            tracedFiles: [],
            importFile: '',
            shouldUpdateImportFile: true,
            inProgress: false
        };

        if (!this._conf.app.skipBuild) {

            this._bundleApp().then(() => {

                if (!_.get(this._conf, 'tests.skipBuild') && !this._appBuildState.hasError) {

                    this._bundleTests();

                }

            });

        } else if (!this._conf.tests.skipBuild) {

            this._bundleTests();

        } else {

            throw new Error(this._messages.nothingToBuild);

        }

    }

    _getNiceEventName (name) {

        switch (name) {
            case 'add':
                return 'added';
                break;
            case 'unlink':
                return 'deleted';
                break;
            default:
                return 'changed';
                break;
        }

    }

    _formatChangedModules (modulesChanged) {

        let counts = _.countBy(modulesChanged, 'event');
        let result = [];

        if (counts.add > 0) {

            result.push(counts.add + ' module' + ( counts.add > 1 ? 's were ' : ' was ') + 'added');

        }

        if (counts.unlink > 0) {

            result.push(counts.unlink + ' module' + ( counts.unlink > 1 ? 's were ' : ' was ') + 'deleted');

        }

        if (counts.change > 0) {

            result.push(counts.change + ' module' + ( counts.change > 1 ? 's were ' : ' was ') + 'changed');

        }

        return result.join(', ');

    }

    _addToChangedModules (destination, moduleName, event) {

        _.pull(destination, _.find(destination, { moduleName: moduleName }));
        destination.push({
            moduleName: moduleName,
            event: event
        });

    }

    _resolveModuleName (filepath, baseDir) {

        let moduleName = this._path.resolve(filepath).replace(baseDir, '').replace(/\\/g, '/').replace(/^\//, '');

        if (moduleName.endsWith('.html')) {

            moduleName += '!text';

        }

        if (moduleName.endsWith('.css')) {

            moduleName += '!css';

        }

        return moduleName;

    }

    // borrowed from karma-jspm
    _getJspmPackageJson () {

        var pjson = {};

        try {

            pjson = JSON.parse(fs.readFileSync(path.resolve('package.json')));

        }
        catch (e) {

            pjson = {};

        }

        if (pjson.jspm) {

            for (var p in pjson.jspm)
                pjson[p] = pjson.jspm[p];

        }

        pjson.directories = pjson.directories || {};

        if (pjson.directories.baseURL) {

            if (!pjson.directories.packages)
                pjson.directories.packages = path.join(pjson.directories.baseURL, 'jspm_packages');
            if (!pjson.configFile)
                pjson.configFile = path.join(pjson.directories.baseURL, 'config.js');

        }

        return {
            configFile: path.resolve(pjson.configFile),
            baseUrl: pjson.directories.baseURL,
            packages: path.resolve(pjson.directories.packages)
        };

    }

    _setupOptions (source, destination) {

        let watch = _.get(source, 'watch');

        if (watch) {

            destination.watch = (_.isArray(watch) ? watch : [watch]).map(pattern => this._path.resolve(pattern));

        }

        if (source && source.input && source.output) {

            destination.input = this._path.resolve(source.input);
            destination.inputDir = path.resolve(this._jspmConf.baseUrl) || this._path.dirname(destination.input);
            destination.output = this._path.resolve(source.output);
            destination.buildOptions = _.extend({
                minify: false,
                mangle: false,
                sourceMaps: true,
                lowResSourceMaps: true
            }, destination.buildOptions || {}, { sfx: false });
            destination.ignore = source.ignore;

        } else {

            destination.skipBuild = true;

        }

    }

    _debug (message) {

        if (this._isDebugEnabled) {

            fancyLog(chalk.blue(this._logPrefix) + '[DEBUG] ' + chalk.gray(message));

            let args = Array.prototype.slice.call(arguments, this._debug.length);

            if (args.length > 0) {

                args.forEach(prop => {

                    console.log(prop)

                });

            }

        }

    }

    _log (message) {

        fancyLog(chalk.blue(this._logPrefix) + message);

    }

    _logError (message) {

        fancyLog.error(chalk.red(this._logPrefix + message));

    }

    _updateFilesToWatch (options, state) {

        let traceTarget = this._resolveModuleName(options.input, options.inputDir);
        this._debug('Tracing ' + traceTarget);

        return this._builder.trace(traceTarget).then(tree => {

            let newTracedFiles = [];

            for (var name in tree) {

                let modulePath = tree[name].path;
                if (modulePath) {

                    newTracedFiles.push(this._path.resolve(options.inputDir, modulePath));

                }

            }

            this._processTracedFiles(newTracedFiles, state);

            this._debug('Trace complete');

        }).catch(error => {

            // ooops
            let failedModules = [];

            this._debug('Trace failed due to an error:', error);

            let match;
            let regExp = /Loading (.*)/g;

            do {

                match = regExp.exec(error.message);

                if (match) {

                    this._debug('Found module ' + match[1] + ' in the error');
                    failedModules.push(this._path.resolve(options.inputDir, match[1]));

                }

            } while (match);

            if (failedModules.length > 0) {

                this._processTracedFiles(failedModules, state, true)

            } else {

                if (this._appBuildState.tracedFiles.concat(this._testsBuildState.tracedFiles).length == 0) {

                    this._logError(this._messages.tracingError);

                }

            }

        });

    }

    _processTracedFiles (newTracedFiles, state, onlyAdd) {

        newTracedFiles = newTracedFiles.filter(file => {
            return file != this._conf.tests.input && minimatch(file, '!' + this._jspmConf.packages + '/**/*') && !this._isSpecFile(file);
        });

        _.difference(newTracedFiles, this._appBuildState.tracedFiles.concat(this._testsBuildState.tracedFiles)).forEach(file => {

            this._watcher.add(file);
            this._debug('Added ' + file + ' to watch list');

        });

        if (!onlyAdd) {

            _.difference(state.tracedFiles, newTracedFiles).forEach(file => {

                this._watcher.unwatch(file);
                this._debug('Removed ' + file + ' from watch list');

            });

        }

        state.tracedFiles = newTracedFiles;

    }

    _isSpecFile (filepath) {

        if (!this._conf.tests.watch || !this._conf.tests.watch.length) {

            return false;

        }

        let result = true;

        _.forEach(this._conf.tests.watch, pattern => {

            if (!minimatch(filepath, pattern)) {

                result = false;

            }

        });

        return result;

    }

    _initWatch () {

        this._watcher = chokidar.watch(this._watchExpression, {
                ignoreInitial: true,
                persistent: true,
                ignored: (filepath) => {

                    return _.includes(this._watchIgnored, this._path.resolve(filepath));

                }
            })
            .on('all', (event, filepath) => {

                this._debug('Received chokidar event: ' + event + ', filepath: ' + filepath);

                if (['add', 'unlink', 'change'].indexOf(event) > -1) {

                    if (this._jspmConf.processingChange || (!this._appBuildState.inProgress && !this._testsBuildState.inProgress)) {

                        this._processEvent(event, filepath);

                    } else {

                        this._debug('Build in progress, queuing event...');

                        this._eventQueue.push({
                            filepath: filepath,
                            event: event
                        });

                    }

                }

            });

        this._debug('Chokidar initialized');

    }

    _processEventQueue () {

        if (this._eventQueue.length > 0) {

            this._debug('Processing event queue, size: ' + this._eventQueue.length);

            this._eventQueue.forEach(item => {

                this._processEvent(item.event, item.filepath);

            });

            this._eventQueue = [];

        }

    }

    _processEvent (event, filepath) {

        this._debug('Processing file event: ' + event + ', filepath: ' + filepath);

        let moduleEvent;
        let moduleName;

        if (this._jspmConf.processingChange || (filepath == this._jspmConf.configFile)) {

            // need to do full build after config was changed, ANY next event will delay it
            this._debug('JSPM config change detected, queuing full rebuild...');

            this._jspmConf.processingChange = true;

            if (this._buildTimeout) {

                // we should wait for some time for all files to come before we actually do the build
                clearTimeout(this._buildTimeout);

            }

            this._buildTimeout = setTimeout(() => {

                this._jspmConf.processingChange = false;
                this._log(this._messages.jspmConfigChanged);
                this._initBuilder();

            }, this._jspmConfigBuildDelay);

            return false;

        }

        let isSpecFile = this._isSpecFile(filepath);

        if (this._conf.tests.skipBuild && isSpecFile) {

            this._debug('File is unit test, unit test build is disabled, skipping bundle');
            return false;

        }

        if (!this._conf.tests.skipBuild && isSpecFile) {

            moduleName = this._resolveModuleName(filepath, this._conf.tests.inputDir);

            //spec file was changed, should build tests or build
            if (event === 'add' || event === 'unlink') {

                this._testsBuildState.shouldUpdateImportFile = true;

            }

            this._invalidate(moduleName); //always invalidate spec files

            moduleEvent = {
                moduleName: moduleName,
                event: event,
                buildState: this._testsBuildState,
                bundleType: this._appBuildState.changedModules.length > 0 ? 'app' : 'tests',
                shouldBundle: true,
                messages: this._messages.tests
            };

        } else if (this._conf.app.skipBuild) {

            moduleName = this._resolveModuleName(filepath, this._conf.tests.inputDir);

            //should build just tests when watching tests
            moduleEvent = {
                moduleName: moduleName,
                event: event,
                bundleType: 'tests',
                buildState: this._testsBuildState,
                shouldBundle: this._invalidate(moduleName) || this._appBuildState.hasError,
                messages: this._messages.tests
            };

        } else {

            moduleName = this._resolveModuleName(filepath, this._conf.app.inputDir);

            //build all
            moduleEvent = {
                moduleName: moduleName,
                event: event,
                bundleType: 'app',
                buildState: this._appBuildState,
                shouldBundle: this._invalidate(moduleName) || this._appBuildState.hasError,
                messages: this._messages.app
            };

        }

        this._processModuleEvent(moduleEvent);

    }

    _processModuleEvent (moduleEvent) {

        this._debug('Processing module event:', moduleEvent);

        let niceEventName = this._getNiceEventName(moduleEvent.event);

        if (!moduleEvent.shouldBundle) {

            this._log(moduleEvent.messages.moduleNoBundle.format({
                moduleName: chalk.cyan(moduleEvent.moduleName),
                event: niceEventName
            }));

        } else {

            this._log(moduleEvent.messages.moduleChanged.format({
                moduleName: chalk.cyan(moduleEvent.moduleName),
                event: niceEventName
            }));

            if (this._buildTimeout) {

                // we should wait for some time for all files to come before we actually do the build
                clearTimeout(this._buildTimeout);

            }

            if (moduleEvent.bundleType === 'app') {

                this._addToChangedModules(moduleEvent.buildState.changedModules, moduleEvent.moduleName, moduleEvent.event);

                let mergedChangedModules = _.unionBy(this._testsBuildState.changedModules, this._appBuildState.changedModules, 'moduleName');

                //there are already some app modules changes pending, so triggering app bundle first, unit tests later
                this._buildTimeout = setTimeout(() => {

                    this._bundleApp().then(() => {

                        if (!this._conf.tests.skipBuild && !this._appBuildState.hasError) {

                            //may proceed with unit tests build if there's no error
                            this._testsBuildState.changedModules = mergedChangedModules;
                            this._bundleTests();

                        }

                    });

                }, this._buildBatchDelay);

            } else {

                this._addToChangedModules(this._testsBuildState.changedModules, moduleEvent.moduleName, moduleEvent.event);
                this._buildTimeout = setTimeout(() => this._bundleTests(), this._buildBatchDelay);

            }

        }

    }

    _generateTestsImportFile () {

        if (this._testsBuildState.shouldUpdateImportFile) {

            this._removeTestsImportFile();

            this._invalidate(this._resolveModuleName(this._conf.tests.input, this._conf.tests.inputDir));

            this._debug('Generating tests import file');

            let importFile = '';

            let specFilesPattern = this._conf.tests.watch.concat(['!' + this._jspmConf.packages + '/**/*']);

            this._debug('Tests search pattern is ', specFilesPattern);

            let files = this._globby.sync(specFilesPattern);

            files.forEach(file => {

                importFile += "import './" + this._path.relative(this._path.dirname(this._conf.tests.input), file).replace(/\\/g, '/') + "';\n";

            });

            this._debug('Tests import file is', importFile);

            this._testsBuildState.shouldUpdateImportFile = false;

            this._fs.writeFileSync(this._conf.tests.input, importFile);
            this._debug('Written tests import file to ' + this._conf.tests.input);

        }

    }

    _removeTestsImportFile () {

        try {

            this._fs.unlinkSync(this._conf.tests.input);

        } catch (e) {

        }

    }

    _bundleTests () {

        this.emitter.emit('beforeBuild', {
            type: 'tests',
            state: this._testsBuildState
        });

        this._generateTestsImportFile();

        return this._bundle(this._conf.tests, this._testsBuildState, this._messages.tests).then(() => {

            if (!this._testsBuildState.hasError) {

                this._fs.appendFileSync(this._conf.tests.output, "\n System.import('" + this._path.relative(this._conf.tests.inputDir, this._conf.tests.input).replace(/\\/g, '/') + "');");

            }

            if (this._useTrace) {

                this._updateFilesToWatch(this._conf.tests, this._testsBuildState);

            }

            this.emitter.emit('change', {
                type: 'tests',
                hasError: this._testsBuildState.hasError
            });

            if (!this._started) {

                this.emitter.emit('started');
                this._started = true;

            }

            this._processEventQueue();

        });

    }

    _bundleApp () {

        this.emitter.emit('beforeBuild', {
            type: 'app',
            state: this._appBuildState
        });

        return this._bundle(this._conf.app, this._appBuildState, this._messages.app).then(() => {

            this.emitter.emit('change', {
                type: 'app',
                hasError: this._appBuildState.hasError
            });

            if (!this._started && this._conf.tests.skipBuild) {

                this.emitter.emit('started');
                this._started = true;

            }

            if (this._conf.tests.skipBuild || this._appBuildState.hasError) {

                //should not process event queue if unit tests build is enabled,
                //cause it will eventually trigger queue processing (if app build has no error)

                this._processEventQueue();

                if (this._useTrace) {

                    this._updateFilesToWatch(this._conf.app, this._appBuildState);

                }

            }

        });

    }

    _bundle (options, state, messages) {

        if (!state.entireBuild) {

            this._log(messages.buildingModules.format({
                changes: this._formatChangedModules(state.changedModules)
            }));

        }

        state.inProgress = true;
        let buildStart = new Date().getTime();
        let progressOptions = {
            input: options.input,
            app: !this._conf.app.skipBuild,
            defaultMessage: messages.buildingAll,
            progressTemplate: messages.buildingProgressTemplate
        };

        if (state.entireBuild) {

            this._progressCall('start', progressOptions);

        }

        return this._builder.bundle(this._resolveModuleName(options.input, options.inputDir), options.output, options.buildOptions)
            .then(() => {

                let executionTime = new Date().getTime() - buildStart;

                let notifySuccess = () => {

                    this._log(messages.buildSuccess.format({ time: chalk.magenta(((executionTime ) / 1000).toFixed(2) + ' s') }));

                };

                state.hasError = false;
                state.changedModules = []; // all built, may clear changed modules list now

                if (state.entireBuild) {

                    return this._progressCall('end', executionTime).then(notifySuccess);

                } else {

                    notifySuccess();

                }

            })
            .catch((error) => {

                state.hasError = true;
                this._logError(messages.buildFail.format({ error: chalk.red(error) }));

                if (state.entireBuild) {

                    return this._progressCall('end');

                }

            }).finally(() => {

                state.entireBuild = false;
                state.inProgress = false;

            });

    }

    _invalidate (moduleName) {

        if (!this._builder) {

            return false;

        }

        let invalidated = this._builder.invalidate(moduleName).length > 0;

        this._debug('Invalidating module from cache: ' + moduleName + ' ' + (invalidated ? 'SUCCESS' : 'FAIL'));

        return invalidated;

    }

    // Warning - impending hyper hacks. Buckle up!
    // http://stackoverflow.com/questions/9210542/node-js-require-cache-possible-to-invalidate
    /**
     * Removes a module from the cache
     */
    _invalidateParentModule (moduleName) {

        // Run over the cache looking for the files
        // loaded by the specified module name
        this._searchModuleCache(moduleName, mod => {

            delete require.cache[mod.id];

        });

        // Remove cached paths to the module.
        // Thanks to @bentael for pointing this out.
        Object.keys(module.constructor._pathCache).forEach(cacheKey => {

            if (cacheKey.indexOf(moduleName) > 0) {

                delete module.constructor._pathCache[cacheKey];

            }

        });

    };

    /**
     * Runs over the cache to search for all the cached
     * files
     */
    _searchModuleCache (moduleName, callback) {

        // Resolve the module identified by the specified name
        var mod = require.resolve(path.normalize(process.cwd() + '/node_modules/' + moduleName));

        // Check if the module has been resolved and found within
        // the cache
        if (mod && ((mod = require.cache[mod]) !== undefined)) {
            // Recursively go over the results
            (function run (mod) {
                // Go over each of the module's children and
                // run over it
                mod.children.forEach(child => {
                    run(child);
                });

                // Call the specified callback providing the
                // found module
                callback(mod);

            })(mod);

        }

    };

}

module.exports = Watcher;
