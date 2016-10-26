'use strict';

const Q = require('q');
const path = require('path');
const shortId = require('short-id');
const exec = require('child_process').exec;
const ipc = require('node-ipc');

class JspmWorkerOrchestrator {

    constructor () {

        this._promises = {};

        ipc.config.retry = 250;
        ipc.config.silent = true;

    }

    start () {

        let defer = Q.defer();
        this._workerId = 'jspmWorker_' + shortId.generate();

        if (this._child) {

            this._child.kill();

        }

        this._child = exec(`node "${path.join(__dirname, 'jspm-worker.js')}" ${this._workerId}`);

        this._child.stderr.on('data', error => {

            //immediate death
            throw new Error(error);

        });

        ipc.connectTo(this._workerId, () => {

            ipc.of[this._workerId].on('connect', () => {

                defer.resolve();

            });

            ipc.of[this._workerId].on('result', this._resultHandler.bind(this));

        });

        return defer.promise;

    }

    _resultHandler (message) {

        let uuid = message.uuid;

        if (message.hasError) {

            this._promises[uuid].reject(message.result);

        } else {

            this._promises[uuid].resolve(message.result);

        }

    }

    execute (cmd, args) {
        
        let uuid = shortId.generate();

        this._promises[uuid] = Q.defer();

        ipc.of[this._workerId].emit('execute', {
            cmd: cmd,
            uuid: uuid,
            args: args
        });

        return this._promises[uuid].promise;

    }

}

module.exports = JspmWorkerOrchestrator;
