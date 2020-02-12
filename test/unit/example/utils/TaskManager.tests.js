/**
 * @author Don McCurdy / https://www.donmccurdy.com
 */
/* global QUnit */

import { TaskManager } from '../../../../examples/jsm/utils/TaskManager';

export default QUnit.module( 'Utils', () => {

	QUnit.module( 'TaskManager', () => {

		QUnit.test( 'serialization - worker', ( assert ) => {

			testSerialization( assert, 2 );

		} );

		QUnit.test( 'serialization - main', ( assert ) => {

			testSerialization( assert, 0 );

		} );

		function testSerialization ( assert, workerLimit ) {

			var done = assert.async();

			var TestTask = {

				init: ( scope, dependencies ) => {

					scope.dependencies = dependencies;
					scope.testData = 123;

				},

				run: ( scope, config ) => {

					return Promise.resolve( [ {
						sum: config.a + config.b,
						testData: scope.testData,
						dependencies: scope.dependencies
					} ] );

				}

			};

			var manager = new TaskManager()
				.setWorkerLimit( workerLimit )
				.register( 'test', TestTask, [ 'my-dependencies' ] );

			manager
				.run( 'test', { a: 3, b: 5 }, 0, [] )
				.then( ( result ) => {

					assert.equal( result.sum, 8, 'run result' );
					assert.equal( result.testData, 123, 'init dynamic data' );
					assert.smartEqual( result.dependencies, [ 'my-dependencies' ], 'init dependencies' );

					manager.dispose();

					done();

				} );

		}

	} );

} );
