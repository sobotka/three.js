/**
 * @author Don McCurdy / https://www.donmccurdy.com
 */
/* global QUnit */

import { TaskManager } from '../../../../examples/jsm/utils/TaskManager';

export default QUnit.module( 'TaskManager', () => {

	QUnit.test( 'init - worker', ( assert ) => {

		testInit( assert, 2 );

	} );

	QUnit.test( 'init - main', ( assert ) => {

		testInit( assert, 0 );

	} );

	QUnit.test( 'run - worker', ( assert ) => {

		testRun( assert, 2 );

	} );

	QUnit.test( 'run - main', ( assert ) => {

		testRun( assert, 0 );

	} );

	function testInit ( assert, workerLimit ) {

		var done = assert.async();

		const TestTask = {

			init: ( scope, dependencies ) => {

				scope.testData = 123;
				scope.dependencies = dependencies;

			},

			run: ( scope, config ) => {

				return Promise.resolve( scope );

			}

		};

		var manager = new TaskManager()
			.setWorkerLimit( workerLimit )
			.register( 'test', TestTask, [ 'my-dependencies' ] )
			.run( 'test', {}, 0, [] )
			.then( ( result ) => {

				assert.equal( result.testData, 123, 'dynamic data available' );
				assert.equal( result.dependencies, 123, 'dependencies available' );

				done();

			} );

	}

	function testRun ( assert, workerLimit ) {

		assert.equal( true, false, 'not implemented' );

	}

} );
