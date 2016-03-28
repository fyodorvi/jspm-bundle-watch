import angular from 'angular';
import 'angular-ui-router';
import aboutComponent from './about.component';

let aboutModule = angular.module('about', [
	'ui.router'
])
.config(($stateProvider)=>{
	$stateProvider
		.state('about', {
			url: '/about',
			template: '<aboutx></aboutx>'
		});
})
.directive('about', aboutComponent);

export default aboutModule;