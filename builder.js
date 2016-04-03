'use strict';

class Builder {
    
    constructor () {
        
        process.on('message', message => {
            
            let result = this[message.method].apply(this, message.arguments);

            if (result && typeof result.then === 'function') {

                result.then((data) => {

                    process.send({ id: message.id, data: data, hasError: false })

                }).catch((error) => {

                    process.send({ id: message.id, data: error, hasError: false })

                });

            } else {

                process.send({ id: message.id, data: result })

            }
            
        });
        
    }
    
    init () {


        try {

            this._invalidateParentModule('jspm');

        } catch(e) {

            

        }

        this._jspm = require('./test-project/node_modules/jspm');

        this._builder = new this._jspm.Builder() 
        
    }
    
    bundle (event) {

        return this._builder.bundle(event.input, event.output, event.options);
        
    }
    
    trace (traceTarget) {

        return this._builder.trace(traceTarget);
        
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

let builder = new Builder();