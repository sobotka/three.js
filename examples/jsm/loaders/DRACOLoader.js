/**
 * @author Don McCurdy / https://www.donmccurdy.com
 */

import {
	BufferAttribute,
	BufferGeometry,
	FileLoader,
	Loader
} from "../../../build/three.module.js";
import { TaskManager, DefaultTaskManager } from '../utils/TaskManager.js';

var DRACOLoader = function ( loadingManager, taskManager ) {

	Loader.call( this, loadingManager );

	this.taskManager = taskManager || DefaultTaskManager;

	this.decoderPath = '';
	this.decoderConfig = {};
	this.decoderBinary = null;
	this.decoderPending = null;

	this.defaultAttributeIDs = {
		position: 'POSITION',
		normal: 'NORMAL',
		color: 'COLOR',
		uv: 'TEX_COORD'
	};
	this.defaultAttributeTypes = {
		position: 'Float32Array',
		normal: 'Float32Array',
		color: 'Float32Array',
		uv: 'Float32Array'
	};

};

DRACOLoader.prototype = Object.assign( Object.create( Loader.prototype ), {

	constructor: DRACOLoader,

	setDecoderPath: function ( path ) {

		this.decoderPath = path;

		return this;

	},

	setDecoderConfig: function ( config ) {

		this.decoderConfig = config;

		return this;

	},

	/** @deprecated */
	setVerbosity: function () {

		console.warn( 'THREE.DRACOLoader: The .setVerbosity() method has been removed.' );

	},

	/** @deprecated */
	setDrawMode: function () {

		console.warn( 'THREE.DRACOLoader: The .setDrawMode() method has been removed.' );

	},

	/** @deprecated */
	setSkipDequantization: function () {

		console.warn( 'THREE.DRACOLoader: The .setSkipDequantization() method has been removed.' );

	},

	load: function ( url, onLoad, onProgress, onError ) {

		var loader = new FileLoader( this.manager );

		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );

		if ( this.crossOrigin === 'use-credentials' ) {

			loader.setWithCredentials( true );

		}

		loader.load( url, ( buffer ) => {

			var taskConfig = {
				attributeIDs: this.defaultAttributeIDs,
				attributeTypes: this.defaultAttributeTypes,
				useUniqueIDs: false
			};

			this.decodeGeometry( buffer, taskConfig )
				.then( onLoad )
				.catch( onError );

		}, onProgress, onError );

	},

	/** @deprecated Kept for backward-compatibility with previous DRACOLoader versions. */
	decodeDracoFile: function ( buffer, callback, attributeIDs, attributeTypes ) {

		var taskConfig = {
			attributeIDs: attributeIDs || this.defaultAttributeIDs,
			attributeTypes: attributeTypes || this.defaultAttributeTypes,
			useUniqueIDs: !! attributeIDs
		};

		this.decodeGeometry( buffer, taskConfig ).then( callback );

	},

	decodeGeometry: function ( buffer, taskConfig ) {

		// TODO: For backward-compatibility, support 'attributeTypes' objects containing
		// references (rather than names) to typed array constructors. These must be
		// serialized before sending them to the worker.
		for ( var attribute in taskConfig.attributeTypes ) {

			var type = taskConfig.attributeTypes[ attribute ];

			if ( type.BYTES_PER_ELEMENT !== undefined ) {

				taskConfig.attributeTypes[ attribute ] = type.name;

			}

		}

		//

		var taskKey = JSON.stringify( taskConfig );

		// Check for an existing task using this buffer. A transferred buffer cannot be transferred
		// again from this thread.
		if ( DRACOLoader.taskCache.has( buffer ) ) {

			var cachedTask = DRACOLoader.taskCache.get( buffer );

			if ( cachedTask.key === taskKey ) {

				return cachedTask.promise;

			} else if ( buffer.byteLength === 0 ) {

				// Technically, it would be possible to wait for the previous task to complete,
				// transfer the buffer back, and decode again with the second configuration. That
				// is complex, and I don't know of any reason to decode a Draco buffer twice in
				// different ways, so this is left unimplemented.
				throw new Error(

					'THREE.DRACOLoader: Unable to re-decode a buffer with different ' +
					'settings. Buffer has already been transferred.'

				);

			}

		}

		//

		var geometryPending = this._initDecoder()
			.then( () => this.taskManager.run( 'draco', { buffer, ...taskConfig }, buffer.byteLength, [ buffer ] ) )
			.then( ( geometryData ) => this._createGeometry( geometryData ) );

		// Cache the task result.
		DRACOLoader.taskCache.set( buffer, {

			key: taskKey,
			promise: geometryPending

		} );

		return geometryPending;

	},

	_createGeometry: function ( geometryData ) {

		var geometry = new BufferGeometry();

		if ( geometryData.index ) {

			geometry.setIndex( new BufferAttribute( geometryData.index.array, 1 ) );

		}

		for ( var i = 0; i < geometryData.attributes.length; i ++ ) {

			var attribute = geometryData.attributes[ i ];
			var name = attribute.name;
			var array = attribute.array;
			var itemSize = attribute.itemSize;

			geometry.setAttribute( name, new BufferAttribute( array, itemSize ) );

		}

		return geometry;

	},

	_loadLibrary: function ( url, responseType ) {

		var loader = new FileLoader( this.manager );
		loader.setPath( this.decoderPath );
		loader.setResponseType( responseType );

		return new Promise( ( resolve, reject ) => {

			loader.load( url, resolve, undefined, reject );

		} );

	},

	preload: function () {

		this._initDecoder();

		return this;

	},

	_initDecoder: function () {

		if ( this.decoderPending ) return this.decoderPending;

		var useJS = typeof WebAssembly !== 'object' || this.decoderConfig.type === 'js';
		var librariesPending = [];

		if ( useJS ) {

			librariesPending.push( this._loadLibrary( 'draco_decoder.js', 'text' ) );

		} else {

			librariesPending.push( this._loadLibrary( 'draco_wasm_wrapper.js', 'text' ) );
			librariesPending.push( this._loadLibrary( 'draco_decoder.wasm', 'arraybuffer' ) );

		}

		this.decoderPending = Promise.all( librariesPending )
			.then( ( libraries ) => {

				var jsContent = libraries[ 0 ];

				if ( ! useJS ) {

					this.decoderConfig.wasmBinary = libraries[ 1 ];

				}

				this.taskManager
					.addScript( jsContent )
					.register( 'draco', DracoTask, [ this.decoderConfig ] );

			} );

		return this.decoderPending;

	},

	dispose: function () {}

} );

/* WEB WORKER */

var DracoTask = {

	init: function ( scope, dependencies ) {

		scope.decoderConfig = dependencies[ 0 ];
		scope.decodeGeometry = decodeGeometry;
		scope.decoderPending = new Promise( function ( resolve ) {

			scope.decoderConfig.onModuleLoaded = function ( draco ) {

				// Module is Promise-like. Wrap before resolving to avoid loop.
				resolve( { draco: draco } );

			};

			DracoDecoderModule( scope.decoderConfig );

		} );

		function decodeGeometry ( draco, decoder, decoderBuffer, taskConfig ) {

			var attributeIDs = taskConfig.attributeIDs;
			var attributeTypes = taskConfig.attributeTypes;

			var dracoGeometry;
			var decodingStatus;

			var geometryType = decoder.GetEncodedGeometryType( decoderBuffer );

			if ( geometryType === draco.TRIANGULAR_MESH ) {

				dracoGeometry = new draco.Mesh();
				decodingStatus = decoder.DecodeBufferToMesh( decoderBuffer, dracoGeometry );

			} else if ( geometryType === draco.POINT_CLOUD ) {

				dracoGeometry = new draco.PointCloud();
				decodingStatus = decoder.DecodeBufferToPointCloud( decoderBuffer, dracoGeometry );

			} else {

				throw new Error( 'THREE.DRACOLoader: Unexpected geometry type.' );

			}

			if ( ! decodingStatus.ok() || dracoGeometry.ptr === 0 ) {

				throw new Error( 'THREE.DRACOLoader: Decoding failed: ' + decodingStatus.error_msg() );

			}

			var geometry = { index: null, attributes: [] };

			// Gather all vertex attributes.
			for ( var attributeName in attributeIDs ) {

				var attributeType = self[ attributeTypes[ attributeName ] ];

				var attribute;
				var attributeID;

				// A Draco file may be created with default vertex attributes, whose attribute IDs
				// are mapped 1:1 from their semantic name (POSITION, NORMAL, ...). Alternatively,
				// a Draco file may contain a custom set of attributes, identified by known unique
				// IDs. glTF files always do the latter, and `.drc` files typically do the former.
				if ( taskConfig.useUniqueIDs ) {

					attributeID = attributeIDs[ attributeName ];
					attribute = decoder.GetAttributeByUniqueId( dracoGeometry, attributeID );

				} else {

					attributeID = decoder.GetAttributeId( dracoGeometry, draco[ attributeIDs[ attributeName ] ] );

					if ( attributeID === - 1 ) continue;

					attribute = decoder.GetAttribute( dracoGeometry, attributeID );

				}

				geometry.attributes.push( decodeAttribute( draco, decoder, dracoGeometry, attributeName, attributeType, attribute ) );

			}

			// Add index.
			if ( geometryType === draco.TRIANGULAR_MESH ) {

				// Generate mesh faces.
				var numFaces = dracoGeometry.num_faces();
				var numIndices = numFaces * 3;
				var index = new Uint32Array( numIndices );
				var indexArray = new draco.DracoInt32Array();

				for ( var i = 0; i < numFaces; ++ i ) {

					decoder.GetFaceFromMesh( dracoGeometry, i, indexArray );

					for ( var j = 0; j < 3; ++ j ) {

						index[ i * 3 + j ] = indexArray.GetValue( j );

					}

				}

				geometry.index = { array: index, itemSize: 1 };

				draco.destroy( indexArray );

			}

			draco.destroy( dracoGeometry );

			return geometry;

		}

		function decodeAttribute ( draco, decoder, dracoGeometry, attributeName, attributeType, attribute ) {

			var numComponents = attribute.num_components();
			var numPoints = dracoGeometry.num_points();
			var numValues = numPoints * numComponents;
			var dracoArray;

			var array;

			switch ( attributeType ) {

				case Float32Array:
					dracoArray = new draco.DracoFloat32Array();
					decoder.GetAttributeFloatForAllPoints( dracoGeometry, attribute, dracoArray );
					array = new Float32Array( numValues );
					break;

				case Int8Array:
					dracoArray = new draco.DracoInt8Array();
					decoder.GetAttributeInt8ForAllPoints( dracoGeometry, attribute, dracoArray );
					array = new Int8Array( numValues );
					break;

				case Int16Array:
					dracoArray = new draco.DracoInt16Array();
					decoder.GetAttributeInt16ForAllPoints( dracoGeometry, attribute, dracoArray );
					array = new Int16Array( numValues );
					break;

				case Int32Array:
					dracoArray = new draco.DracoInt32Array();
					decoder.GetAttributeInt32ForAllPoints( dracoGeometry, attribute, dracoArray );
					array = new Int32Array( numValues );
					break;

				case Uint8Array:
					dracoArray = new draco.DracoUInt8Array();
					decoder.GetAttributeUInt8ForAllPoints( dracoGeometry, attribute, dracoArray );
					array = new Uint8Array( numValues );
					break;

				case Uint16Array:
					dracoArray = new draco.DracoUInt16Array();
					decoder.GetAttributeUInt16ForAllPoints( dracoGeometry, attribute, dracoArray );
					array = new Uint16Array( numValues );
					break;

				case Uint32Array:
					dracoArray = new draco.DracoUInt32Array();
					decoder.GetAttributeUInt32ForAllPoints( dracoGeometry, attribute, dracoArray );
					array = new Uint32Array( numValues );
					break;

				default:
					throw new Error( 'THREE.DRACOLoader: Unexpected attribute type.' );

			}

			for ( var i = 0; i < numValues; i ++ ) {

				array[ i ] = dracoArray.GetValue( i );

			}

			draco.destroy( dracoArray );

			return {
				name: attributeName,
				array: array,
				itemSize: numComponents
			};

		}

	},

	run: function ( scope, taskConfig ) {

		var buffer = taskConfig.buffer;

		return scope.decoderPending.then( ( module ) => {

			var draco = module.draco;
			var decoder = new draco.Decoder();
			var decoderBuffer = new draco.DecoderBuffer();
			decoderBuffer.Init( new Int8Array( buffer ), buffer.byteLength );

			try {

				var geometry = scope.decodeGeometry( draco, decoder, decoderBuffer, taskConfig );

				var buffers = geometry.attributes.map( ( attr ) => attr.array.buffer );

				if ( geometry.index ) buffers.push( geometry.index.array.buffer );

				return [ geometry, buffers ];

			} finally {

				draco.destroy( decoderBuffer );
				draco.destroy( decoder );

			}

		} );

	}

};


DRACOLoader.taskCache = new WeakMap();

/** Deprecated static methods */

/** @deprecated */
DRACOLoader.setDecoderPath = function () {

	console.warn( 'THREE.DRACOLoader: The .setDecoderPath() method has been removed. Use instance methods.' );

};

/** @deprecated */
DRACOLoader.setDecoderConfig = function () {

	console.warn( 'THREE.DRACOLoader: The .setDecoderConfig() method has been removed. Use instance methods.' );

};

/** @deprecated */
DRACOLoader.releaseDecoderModule = function () {

	console.warn( 'THREE.DRACOLoader: The .releaseDecoderModule() method has been removed. Use instance methods.' );

};

/** @deprecated */
DRACOLoader.getDecoderModule = function () {

	console.warn( 'THREE.DRACOLoader: The .getDecoderModule() method has been removed. Use instance methods.' );

};

export { DRACOLoader };
