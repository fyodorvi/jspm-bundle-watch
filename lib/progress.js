'use strict';

var fs = require('fs-extra');
var path = require('path');
var ProgressBar = require('progress');
var timestamp = require('time-stamp');
var chalk = require('chalk');
var fancyLog = require('fancy-log');

class Progress {

    constructor () {

        process.on('message', message => {

            let result = this[message.method].apply(this, message.arguments);

            if (result && typeof result.then === 'function') {

                result.then((data) => {

                    process.send({
                        id: message.id,
                        data: data,
                        hasError: false
                    })

                }).catch((error) => {

                    process.send({
                        id: message.id,
                        data: error,
                        hasError: false
                    })

                });

            } else {

                process.send({
                    id: message.id,
                    data: result
                })

            }

        });

        this._fs = fs;
        this._path = path;

        this._getStats();

    }

    _getTimestamp () {
        return '['+chalk.grey(timestamp('HH:mm:ss'))+']';
    }

    _getKey (options) {

        return options.input + ',app:' + options.app;

    }

    _getStats () {

        try {

            this._progressInfo = JSON.parse(this._fs.readFileSync(this._path.normalize(__dirname + '/.progress-info')));

        }
        catch (e) {

            this._progressInfo = {};

        }

        //this._debug('Progress info is', this._progressInfo);

    }

    terminate () {

        if (this._progressBar && !this._progressBar.complete) {

            this._progressBar.update(100);
            clearInterval(this._progressBarInterval);

        }

    }

    init (options) {

        this._conf = options;

    }

    end (executionTime) {

        this.terminate();

        this._progressInfo[this._getKey(this._options)] = executionTime;

        if (executionTime > 0) {

            try {

                fs.writeFile(this._path.normalize(__dirname + '/.progress-info'), JSON.stringify(this._progressInfo), "utf8");

            }
            catch (e) {

                // this._debug('Progress info write failed', e);

            }

        }

    }

    start (options) {

        this._options = options;

        let baseExecutionTime = this._progressInfo[this._getKey(options)];

        if (baseExecutionTime > 0) {

            let executionStart = new Date().getTime();

            this._progressBar = new ProgressBar(this._getTimestamp() + ' ' + this._conf.logPrefix + options.progressTemplate, {
                complete: '=',
                incomplete: ' ',
                width: 20,
                total: 100
            });

            this._progressBarInterval = setInterval(() => {

                let percent = (new Date().getTime() - executionStart) / baseExecutionTime;

                if (percent && !this._progressBar.complete) {

                    this._progressBar.update(Math.min(0.99, percent));

                } else {

                    clearInterval(this._progressBarInterval);

                }

            }, 100);

        } else {

            this._log(options.defaultMessage);

        }

    }

    _log (message) {

        fancyLog(chalk.blue(this._conf.logPrefix) + message);

    }

}

let progress = new Progress();
