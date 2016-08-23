'use strict';
const path = require('path');
const jspm = require(path.join(process.cwd(), 'node_modules', 'jspm'));
const ipc = require('node-ipc');

class JspmWorker {

    constructor () {

        if (!process.argv[2]) {

            throw new Error('No IPC id provided');

        }

        ipc.config.id = process.argv[2];
        ipc.config.retry = 1500;
        ipc.config.silent = true;

        ipc.serve(() => {

                ipc.server.on('execute', this._executeHandler.bind(this));

            }
        );

        ipc.server.start();

        this._builder = new jspm.Builder();

    }

    invalidate (options) {

        return this._builder.invalidate(options.moduleName).length > 0;

    }

    bundle (options) {

        return this._builder.bundle(options.input, options.output, options.buildOptions);

    }

    trace (options) {

        return this._builder.trace(options.target);

    }

    _sendResult(socket, data) {

        ipc.server.emit(socket, 'result', data);

    }

    _executeHandler (message, socket) {

        let res;

        try {

            res = this[message.cmd](message.args);

        } catch (error) {


            this._sendResult(socket, {
                uuid: message.uuid,
                hasError: true,
                result: error
            });

            return false;

        }

        if (typeof res.then === 'function') {

            res.then(data => {

                let result;

                if (message.cmd == 'trace') {

                    // avoid sending big data over socket
                    result = {};

                    for (var name in data) {

                        result[name] = {
                            path: data[name].path
                        }

                    }

                }

                this._sendResult(socket, {
                    uuid: message.uuid,
                    result: message.cmd == 'trace' ? result : true
                });

            }).catch(error => {

                this._sendResult(socket, {
                    uuid: message.uuid,
                    hasError: true,
                    result: error.toString()
                });

            })

        } else {

            this._sendResult(socket, {
                uuid: message.uuid,
                result: res
            })

        }

    }

}

let worker = new JspmWorker();