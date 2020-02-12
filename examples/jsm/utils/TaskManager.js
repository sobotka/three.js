class TaskManager {

	constructor () {

		this.tasks = [];
		this.tasksInitialized = null;

		this.workerLimit = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency;
		this.workerPool = [];
		this.workerNextTaskID = 1;
		this.workerSourceURL = '';

	}

	setWorkerLimit ( workerLimit ) {

		if ( workerLimit === 0 ) {

			console.warn( 'THREE.TaskManager: workerLimit=0 not implemented.' );

		}

		this.workerLimit = workerLimit;

		return this;

	}

	register ( type, impl, dependencies ) {

		dependencies = dependencies || Promise.resolve( {} );

		this.tasks.push( { type, impl, dependencies } );

		return this;

	}

	_init () {

		if ( this.tasksInitialized ) return this.tasksInitialized;

		var dependencies = this.tasks.map( ( t ) => t.dependencies );

		this.tasksInitialized = new Promise( ( resolve ) => {

			var body = TaskWorker.toString();

			body = body.substring( body.indexOf( '{' ) + 1, body.lastIndexOf( '}' ) );

			var implBody = '';

			for ( var i = 0; i < this.tasks.length; i ++ ) {

				var task = this.tasks[ i ];

				implBody += [
					task.type + ': {',
					'scope: {},',
					'init: ' + task.impl.init.toString() + ',',
					'run: ' + task.impl.run.toString(),
					'},'
				].join( '\n' );

			}

			body = body.replace( 'placeholder: \'placeholder\'', implBody );

			this.workerSourceURL = URL.createObjectURL( new Blob( [ body ] ) );

			Promise.all( dependencies ).then( resolve );

		} );

		return this.tasksInitialized;

	}

	run ( type, config, cost, transfer ) {

		var taskID = this.workerNextTaskID ++;

		var worker;

		var taskPending = this._getWorker( taskID, cost )
			.then( ( _worker ) => {

				worker = _worker;

				return new Promise( ( resolve, reject ) => {

					worker._callbacks[ taskID ] = { resolve, reject };

					worker.postMessage( {

						type: 'run',
						task: type,
						id: taskID,
						config: config

					}, transfer );

					// this.debug();

				} );

			} );

		taskPending
			.finally( () => {

				if ( worker && taskID ) {

					this._releaseTask( worker, taskID );

					// this.debug();

				}

			} );

		return taskPending;

	}

	_getWorker ( taskID, taskCost ) {

		return this._init().then( ( dependencies ) => {

			if ( this.workerPool.length < this.workerLimit ) {

				var worker = new Worker( this.workerSourceURL );

				worker._callbacks = {};
				worker._taskCosts = {};
				worker._taskLoad = 0;

				for ( var i = 0; i < this.tasks.length; i ++ ) {

					worker.postMessage( {

						type: 'init',
						task: this.tasks[ i ].type,
						dependencies: dependencies[ i ]

					} );

				}

				worker.onmessage = function ( e ) {

					var message = e.data;

					switch ( message.type ) {

						case 'complete':
							worker._callbacks[ message.id ].resolve( message.result );
							break;

						case 'error':
							worker._callbacks[ message.id ].reject( message.error );
							break;

						default:
							console.error( 'THREE.TaskManager: Unexpected message, "' + message.type + '"' );

					}

				};

				this.workerPool.push( worker );

			} else {

				this.workerPool.sort( function ( a, b ) {

					return a._taskLoad > b._taskLoad ? - 1 : 1;

				} );

			}

			var worker = this.workerPool[ this.workerPool.length - 1 ];
			worker._taskCosts[ taskID ] = taskCost;
			worker._taskLoad += taskCost;
			return worker;

		} );

	}

	_releaseTask ( worker, taskID ) {

		worker._taskLoad -= worker._taskCosts[ taskID ];
		delete worker._callbacks[ taskID ];
		delete worker._taskCosts[ taskID ];

	}

	debug () {

		console.log( 'Task load: ', this.workerPool.map( ( worker ) => worker._taskLoad ) );

	}

	dispose () {

		for ( var i = 0; i < this.workerPool.length; ++ i ) {

			this.workerPool[ i ].terminate();

		}

		this.workerPool.length = 0;

		return this;

	}

}

function TaskWorker () {

	// TODO(donmccurdy): This feels fragile.
	var tasks = { placeholder: 'placeholder' };

	onmessage = ( e ) => {

		var message = e.data;
		var task = tasks[ message.task ];

		switch ( message.type ) {

			case 'init':
				task.init( task.scope, message.dependencies );
				break;

			case 'run':
				task
					.run( task.scope, message.config )
					.then( ( [ result, transfer ] ) => {

						self.postMessage( { type: 'complete', id: message.id, result }, transfer );

					} )
					.catch( ( e ) => {

						self.postMessage( { type: 'error', id: message.id, error: e.message } );

					} );
				break;

			default:
				throw new Error( 'THREE.TaskManager: Unknown message type: ' + message.type );

		}

	};

}

const DefaultTaskManager = new TaskManager();

export { DefaultTaskManager, TaskManager };
