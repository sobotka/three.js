import {
	Color,
	Loader,
	FileLoader,
	TextureLoader
} from '../../../build/three.module.js';

import * as Nodes from '../nodes/Nodes.js';

class MaterialXLoader extends Loader {

	constructor( manager ) {

		super( manager );

	}

	load( url, onLoad, onProgress, onError ) {

		const scope = this;

		const loader = new FileLoader( scope.manager );
		loader.setPath( scope.path );
		loader.load( url, function ( text ) {

			console.time('MaterialXLoader.parse');

			const result = scope.parse( text );

			console.timeEnd('MaterialXLoader.parse');

			onLoad( result ); // TODO: Await dependencies.

		}, onProgress, onError );

		return this;

	}

	parse( text ) {

		return new MaterialXParser( this.manager, this.path ).parse( text );

	}

}

class MaterialXParser {

	constructor( manager, path ) {

		this.manager = manager;
		this.path = path;
		this.resourcePath = '';

		this.textureLoader = new TextureLoader( manager );

		this.nodeGraphDefs = {};
		this.surfaceShaderDefs = {};

		this.nodeCache = new WeakMap();

	}

	parse( text ) {

		const scope = this;
		const dom = new DOMParser().parseFromString( text, 'application/xml' );

		console.log( dom.documentElement );

		const filePrefix = dom.documentElement.getAttribute( 'fileprefix' );
		this.resourcePath = filePrefix ? new URL( filePrefix, this.path ).href : this.path;
		this.textureLoader.setPath( this.resourcePath );

		//

		const materialDefs = [];

		for ( const nodeDef of dom.documentElement.children ) {

			const name = nodeDef.getAttribute( 'name' );
			const nodeName = nodeDef.nodeName;
			const nodeType = nodeDef.getAttribute( 'type' )

			if ( nodeType === 'material' ) {

				materialDefs.push( nodeDef );

			} else if ( nodeType === 'surfaceshader' ) {

				this.surfaceShaderDefs[ name ] = nodeDef;

			} else if ( nodeName === 'nodegraph' ) {

				this.nodeGraphDefs[ name ] = nodeDef;

			} else {

				console.warn( `THREE.MaterialXLoader: Unexpected root node type, "${ nodeName }".` );

			}

		}

		//

		const materials = {};

		for ( const surfaceMaterialDef of materialDefs ) {

			const material = this.parseSurfaceMaterial( surfaceMaterialDef );

			materials[ material.name ] = material;

		}

		return { materials };

	}

	parseSurfaceMaterial( surfaceMaterialDef ) {

		const materialName = surfaceMaterialDef.getAttribute( 'name' );

		let surfaceShaderDef;

		for ( const inputDef of surfaceMaterialDef.children ) {

			// Only support surface shaders.
			if ( inputDef.getAttribute( 'type' ) !== 'surfaceshader' ) continue;

			// Only support Standard Surface BRDF.
			const nodeDef = this.surfaceShaderDefs[ inputDef.getAttribute( 'nodename' ) ]
			if ( nodeDef.nodeName !== 'standard_surface' ) continue;

			surfaceShaderDef = nodeDef;
			break;

		}

		if ( ! surfaceShaderDef ) {

			console.warn( `THREE.MaterialXLoader: No supported surface shader found for "${ materialName }".` );
			return null;

		}

		const material = this.parseStandardSurface( surfaceShaderDef );
		material.name = materialName;

		return material;

	}

	parseStandardSurface( standardSurfaceDef ) {

		const material = new Nodes.MeshStandardNodeMaterial();

		for ( const inputDef of standardSurfaceDef.children ) {

			switch ( inputDef.getAttribute( 'name' ) ) {

				case 'base_color':
					material.color = this.parseInput( inputDef );
					break;

				case 'opacity':
					material.opacity = this.parseInput( inputDef );
					break;

				case 'diffuse_roughness':
				case 'specular_roughness':
					material.roughness = this.parseInput( inputDef );
					break;

				case 'metalness':
					material.metalness = this.parseInput( inputDef );
					break;

				case 'emission_color': {
					const emissionColor = this.parseInput( inputDef );
					material.emissive = material.emissive
						? Nodes.MultiplyNode( material.emissive, emissionColor )
						: emissionColor;
				} break;

				case 'base':
				case 'specular':
				case 'specular_color':
				case 'specular_IOR':
				case 'specular_anisotropy':
				case 'specular_rotation':
				case 'transmission':
				case 'transmission_color':
				case 'transmission_depth':
				case 'transmission_scatter':
				case 'transmission_scatter_anisotropy':
				case 'transmission_dispersion':
				case 'transmission_extra_roughness':
				case 'subsurface':
				case 'subsurface_color':
				case 'subsurface_radius':
				case 'subsurface_scale':
				case 'subsurface_anisotropy':
				case 'sheen':
				case 'sheen_color':
				case 'sheen_roughness':
				case 'thin_walled':
				case 'coat':
				case 'coat_color':
				case 'coat_roughness':
				case 'coat_anisotropy':
				case 'coat_rotation':
				case 'coat_IOR':
				case 'coat_affect_color':
				case 'coat_affect_roughness':
				case 'thin_film_thickness':
				case 'thin_film_IOR':
				case 'emission':

					// TODO
					console.warn( `THREE.MaterialXLoader: Unsupported material property, "${ inputDef.getAttribute( 'name' ) }".` );

			}

		}

		return material;

	}

	parseNode( nodeDef, nodeGraphName ) {

		let node = this.nodeCache.get( nodeDef );
		if ( node ) return node;

		//

		const inputs = this.parseInputs( nodeDef, nodeGraphName );

		switch ( nodeDef.nodeName ) {

			// BASIC

			case 'constant': {

				node = inputs.value;

			} break;

			case 'output': {

				const sourceName = nodeDef.getAttribute( 'nodename' );
				const sourceDef = this.nodeGraphDefs[ nodeGraphName ].querySelector(`[name=${sourceName}]`);
				node = this.parseNode( sourceDef, nodeGraphName );

			} break;


			// GEOMETRY

			case 'position': {

				node = new Nodes.PositionNode();

			} break;


			// TEXTURE

			case 'tiledimage': {

				this.beginResourceScope( nodeGraphName );
				console.log('texture', inputs, nodeDef); // TODO: Include UVNode.
				node = new Nodes.TextureNode( this.textureLoader.load( inputs.file ) );
				this.endResourceScope( nodeGraphName );

			} break;


			// MATH

			case 'mix': {

				node = new Nodes.MathNode( inputs.bg, inputs.fg, inputs.mix, Nodes.MathNode.MIX );

			} break;


			case 'dotproduct': {

				node = new Nodes.MathNode( inputs.in1, inputs.in2, Nodes.MathNode.DOT );

			} break;

			case 'sin': {

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.SIN );

			} break;

			case 'cos': {

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.COS );

			} break;

			case 'power': {

				node = new Nodes.MathNode( inputs.in1, inputs.in2, Nodes.MathNode.POW );

			} break;


			// OPERATOR

			case 'multiply': {

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.MUL );

			} break;

			case 'divide': {

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.DIV );

			} break;

			case 'add': {

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.ADD );

			} break;

			case 'subtract': {

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.SUB );

			} break;


			// NOISE

			case 'fractal3d': {

				// TODO: Use the right noise.
				// TODO: Support 'parameters'.
				node = new Nodes.NoiseNode( inputs.position );

			} break;

		}

		//

		if ( ! node ) {

			console.info( nodeDef ); // TODO: Clean up.

			throw new Error( `THREE.MaterialXLoader: Unexpected node graph element, "${ nodeDef.nodeName }".` );

		}

		//

		this.nodeCache.set( nodeDef, node );
		return node;

	}

	parseInputs( nodeDef, nodeGraphName ) {

		const inputs = {};

		for ( const inputDef of nodeDef.children ) {

			const inputName = inputDef.getAttribute( 'name' );
			inputs[ inputName ]  = this.parseInput( inputDef, nodeGraphName );

		}

		return inputs;

	}

	parseInput( inputDef, nodeGraphName = '' ) {

		//

		const otherNodeGraphName = inputDef.getAttribute('nodegraph');
		if ( otherNodeGraphName ) {

			const sourceName = inputDef.getAttribute( 'output' );
			const sourceDef = this.nodeGraphDefs[ otherNodeGraphName ].querySelector(`output[name=${sourceName}]`);
			return this.parseNode( sourceDef, otherNodeGraphName );

		}

		//

		const nodeName = inputDef.getAttribute('nodename');
		if ( nodeName ) {

			const sourceDef = this.nodeGraphDefs[ nodeGraphName ].querySelector(`[name=${nodeName}]`);
			return this.parseNode( sourceDef, nodeGraphName );

		}

		//

		const type = inputDef.getAttribute( 'type' );
		const value = inputDef.getAttribute( 'value' );
		return formatValue( type, value );

	}

	beginResourceScope( name ) {

		const nodeGraphDef = this.nodeGraphDefs[ name ];
		const filePrefix = nodeGraphDef.getAttribute( 'fileprefix' );

		if ( filePrefix ) {

			this.textureLoader.setPath( new URL( filePrefix, this.resourcePath ).href );

		}

	}

	endResourceScope( name ) {

		const nodeGraphDef = this.nodeGraphDefs[ name ];
		const filePrefix = nodeGraphDef.getAttribute( 'fileprefix' );

		if ( filePrefix ) {

			this.textureLoader.setPath( this.resourcePath );

		}

	}

}

function split( text ) {

	const values = [];

	for ( const c of text.split( ',' ) ) {

		values.push( Number( c.trim() ) );

	}

	return values;

}

function formatValue( type, value ) {

	console.log( `${value} -> ${type}` );

	switch ( type ) {

		case 'float':

			return new Nodes.FloatNode( Number( value ) );

		case 'integer':

			return new Nodes.IntNode( Number( value ) );

		case 'vector2':

			return new Nodes.Vector2Node( ... split( value ) );

		case 'vector3':

			return new Nodes.Vector3Node( ... split( value ) );

		case 'vector3':

			return new Nodes.Vector4Node( ... split( value ) );

		case 'color3':

			return new Nodes.ColorNode( new Color( ... split( value ) ) );

		case 'filename':

			return value;

		default:

			throw new Error( `THREE.MaterialXLoader: Unexpected input type, "${ type }".` );

	}

}

export { MaterialXLoader };
