var gulp = require('gulp'),
    path = require('path'),
    jspm = require('jspm'),
    rename = require('gulp-rename'),
    template = require('gulp-template'),
    uglify = require('gulp-uglify'),
    htmlreplace = require('gulp-html-replace'),
    ngAnnotate = require('gulp-ng-annotate'),
    browserSync = require('browser-sync'),
    yargs = require('yargs').argv,
    rimraf = require('rimraf'),
    fs = require('fs-extra'),
    JspmWatcher = require('../index.js');
    KarmaServer = require('karma').Server;

var root = 'client';

// helper method to resolveToApp paths
var resolveTo = function (resolvePath) {
    return function (glob) {
        glob = glob || '';
        return path.resolve(path.join(root, resolvePath, glob));
    }
};

var resolveToApp = resolveTo('app'); // app/{glob}
var resolveToComponents = resolveTo('app/components'); // app/components/{glob}

// map of all our paths
var paths = {
    css: resolveToApp('**/*.css'),
    js: resolveToApp('**/*.js'),
    spec: resolveToApp('**/*.spec.js'),
    html: resolveToApp('**/*.html'),
    blankTemplates: path.join(__dirname, 'generator', 'component/**/*.**'),
    dist: path.join(__dirname, 'dist/')
};

var watcher = new JspmWatcher({
    app: {
        input: resolveToApp('app.js'),
        output: path.join(paths.dist + '/app/app.js')
    },
    tests: {
        watch: [paths.spec],
        input: resolveToApp('unit-tests.js'),
        output: path.join(paths.dist + 'unit-tests.js')
    }
});

gulp.task('tdd', function (done) {
    rimraf.sync(path.join(paths.dist, '*'));
    watcher.start({ testsOnly: true }).once('started', function () {
        var karma = new KarmaServer({
            configFile: __dirname + '/karma.conf.js'
        }, done);
        karma.start();
        watcher.on('change', function(event) {
            if (event.type == 'tests' && !event.hasError) {
                karma.refreshFiles();
            }
        })
    })

});

gulp.task('watch', function (done) {
    rimraf.sync(path.join(paths.dist, '*'));
    fs.copySync(path.join(root, 'index.html'), paths.dist+'index.html');
    watcher.start({ appOnly: true }).once('started', function() {
        done();
        gulp.start('serve');
        watcher.on('change', function(event) {
            if (event.type == 'app' && !event.hasError) {
                browserSync.reload();
            }
        })
    });
});

gulp.task('watch-and-tdd', function (done) {
    rimraf.sync(path.join(paths.dist, '*'));
    fs.copySync(path.join(root, 'index.html'), paths.dist+'index.html');

    watcher.start().once('started', function() {
        var karma = new KarmaServer({
            configFile: __dirname + '/karma.conf.js'
        }, done);
        karma.start();
        karma.once('run_complete', function() {
            gulp.start('serve');
        });
        watcher.on('change', function(event) {
            if (event.type == 'app' && !event.hasError) {
                browserSync.reload();
            }
            if (event.type == 'tests' && !event.hasError) {
                karma.refreshFiles();
            }
        })
    });
});

gulp.task('serve', function () {
    'use strict'
    browserSync.init({
        port: process.env.PORT || 3000,
        open: false,
        server: {
            baseDir: paths.dist,
            // serve our jspm dependencies with the client folder
            routes: {
                '/client': './client',
                '/jspm.config.js': './jspm.config.js',
                '/jspm_packages': './client/jspm_packages'
            }
        }
    });
});

gulp.task('build', function () {
    var dist = path.join(paths.dist + 'app.js');
    rimraf.sync(path.join(paths.dist, '*'));
    // Use JSPM to bundle our app
    return jspm.bundleSFX(resolveToApp('app'), dist, {})
        .then(function () {
            // Also create a fully annotated minified copy
            return gulp.src(dist)
                .pipe(ngAnnotate())
                .pipe(uglify())
                .pipe(rename('app.min.js'))
                .pipe(gulp.dest(paths.dist))
        })
        .then(function () {
            // Inject minified script into index
            return gulp.src('client/index.html')
                .pipe(htmlreplace({
                    'js': 'app.min.js'
                }))
                .pipe(gulp.dest(paths.dist));
        });
});

gulp.task('component', function () {
    var cap = function (val) {
        return val.charAt(0).toUpperCase() + val.slice(1);
    };

    var name = yargs.name;
    var parentPath = yargs.parent || '';
    var destPath = path.join(resolveToComponents(), parentPath, name);

    return gulp.src(paths.blankTemplates)
        .pipe(template({
            name: name,
            upCaseName: cap(name)
        }))
        .pipe(rename(function (path) {
            path.basename = path.basename.replace('temp', name);
        }))
        .pipe(gulp.dest(destPath));
});

gulp.task('default', ['serve'])
