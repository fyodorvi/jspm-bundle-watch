import angular from 'angular';
import 'angular-ui-router';
import Common from './common/common';
import Components from './components/components';
import AppComponent from './app.component';
import 'normalize.css';
import React from 'react';

let appModule = angular.module('app', [
	'ui.router',
	Common.name,
	Components.name
])
.directive('app', AppComponent);

/*
 * As we are using ES6 with Angular 1.x we can't use ng-app directive
 * to bootstrap the application as modules are loaded asynchronously.
 * Instead, we need to bootstrap the application manually
 */
var container = document.getElementById('app-container');

angular.element(document).ready(() => {
	angular.bootstrap(container, [appModule.name]), {
		strictDi: true
	}
});