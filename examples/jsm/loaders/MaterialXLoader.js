import {
	Color,
	FileLoader,
	Loader,
	TextureLoader
} from '../../../build/three.module.js';
import * as Nodes from '../nodes/Nodes.js';

class MaterialXLoader extends Loader {

	constructor( manager ) {

		super( manager );

	}

	load( url, onLoad, onProgress, onError ) {

		const scope = this;

		new FileLoader( scope.manager )
			.setPath( scope.path )
			.load( url, async function ( text ) {

				try {

					onLoad( await scope.parseAsync( text ) );

				} catch ( e ) {

					onError( e );

				}

			}, onProgress, onError );

		return this;

	}

	parse( text ) {

		const parser = new MaterialXParser( this.manager, this.path );

		console.time('MaterialXLoader.parse');

		const result = parser.parse( text );

		console.timeEnd('MaterialXLoader.parse');

		//

		return result;

	}

	async parseAsync( text ) {

		const parser = new MaterialXParser( this.manager, this.path );

		console.time('MaterialXLoader.parse');

		const result = parser.parse( text );

		console.timeEnd('MaterialXLoader.parse');

		//

		await Promise.all( parser.pending );

		return result;

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

		this.pending = [];

	}

	parse( text ) {

		const scope = this;
		const dom = new DOMParser().parseFromString( text, 'application/xml' );

		const version = dom.documentElement.getAttribute( 'version' );
		if ( version !== '1.38' ) {

			console.warn( `THREE.MaterialXLoader: Expected MaterialX version v1.38, found v${version}.` );

		}

		console.log( dom.documentElement ); // TODO

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

		//

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

		//

		let material;

		if ( surfaceShaderDef.nodeName === 'standard_surface' ) {

			material = this.parseStandardSurface( surfaceShaderDef );

		} else if ( surfaceShaderDef.nodeName === 'disney_brdf_2012' ) {

			material = this.parseDisneyBRDF2012( surfaceShaderDef );

		} else if ( surfaceShaderDef.nodeName === 'disney_bsdf_2015' ) {

			material = this.parseDisneyBRDF2015( surfaceShaderDef );

		} else {

			console.warn( `THREE.MaterialXLoader: Unsupported surface shader, "${ surfaceShaderDef.nodeName }".` );

		}

		material.name = materialName;

		return material;

	}

	/**
	 * Reference: https://github.com/materialx/MaterialX/blob/main/libraries/bxdf/standard_surface.mtlx
	 */
	parseStandardSurface( surfaceDef ) {

		const material = new Nodes.MeshStandardNodeMaterial();

		for ( const inputDef of surfaceDef.children ) {

			switch ( inputDef.getAttribute( 'name' ) ) {

				case 'base':
				case 'base_color': {
					material.color = ( material.color && material.color.isNode )
						? new Nodes.OperatorNode( material.color, this.parseInput( inputDef ), Nodes.OperatorNode.MUL )
						: this.parseInput( inputDef );
				} break;

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

				case 'emission':
				case 'emission_color': {
					material.emissive = ( material.emissive && material.emissive.isNode )
						? new Nodes.OperatorNode( material.emissive, this.parseInput( inputDef ), Nodes.OperatorNode.MUL )
						: this.parseInput( inputDef );
				} break;

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

					// TODO
					console.warn( `THREE.MaterialXLoader: Unsupported material property, "${ inputDef.getAttribute( 'name' ) }".` );

			}

		}

		return material;

	}

	/**
	 * Reference: https://github.com/materialx/MaterialX/blob/main/libraries/bxdf/disney_brdf_2012.mtlx
	 */
	parseDisneyBRDF2012( surfaceDef ) {

		const material = new Nodes.MeshStandardNodeMaterial();

		for ( const inputDef of surfaceDef.children ) {

			switch ( inputDef.getAttribute( 'name' ) ) {

				case 'baseColor': // TODO: Default 0.16, 0.16, 0.16.
					material.color = this.parseInput( inputDef );
					break;

				case 'metallic': // TODO: Default 0.
					material.metalness = this.parseInput( inputDef );
					break;

				case 'roughness': // TODO: Default 0.5.
					material.roughness = this.parseInput( inputDef );
					break;

				case 'subsurface': // TODO: Default 0.
				case 'specular': // TODO: Default 0.5.
				case 'specularTint': // TODO: Default 0.
				case 'anisotropic': // TODO: Default 0.
				case 'sheen': // TODO: Default 0.
				case 'sheenTint': // TODO: Default 0.5.
				case 'clearcoat': // TODO: Default 0.
				case 'clearcoatGloss': // TODO: Default 1.

					console.warn( `THREE.MaterialXLoader: Unsupported material property, "${ inputDef.getAttribute( 'name' ) }".` );

			}

		}

		return material;

	}

	/**
	 * Reference: https://github.com/materialx/MaterialX/blob/main/libraries/bxdf/disney_brdf_2015.mtlx
	 */
	parseDisneyBRDF2015( surfaceDef ) {

		const material = new Nodes.MeshStandardNodeMaterial();

		for ( const inputDef of surfaceDef.children ) {

			switch ( inputDef.getAttribute( 'name' ) ) {

				case 'baseColor': // TODO: Default 0.16, 0.16, 0.16.
					material.color = this.parseInput( inputDef );
					break;

				case 'metallic': // TODO: Default 0.
					material.metalness = this.parseInput( inputDef );
					break;

				case 'roughness': // TODO: Default 0.5.
					material.roughness = this.parseInput( inputDef );
					break;

				case 'anisotropic': // TODO: Default 0.
				case 'specularTint': // TODO: Default 0.
				case 'sheen': // TODO: Default 0.
				case 'sheenTint': // TODO: Default 0.5.
				case 'clearcoat': // TODO: Default 0.
				case 'clearcoatGloss': // TODO: Default 1.
				case 'specTrans': // TODO: Default 0.
				case 'ior': // TODO: Default 1.5.
				case 'scatterDistance': // TODO: Default 0, 0, 0.
				case 'flatness': // TODO: Default 0.
				case 'diffTrans': // TODO: Default 0.
				case 'thin': // TODO: Default false. (uniform)

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

				node = this.parseTexture( nodeDef, nodeGraphName, inputs );

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

		// TODO: Try to warn somehow if an input isn't used?

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

	parseTexture( nodeDef, nodeGraphName, inputs ) {

		this.beginResourceScope( nodeGraphName );
		console.log('texture', inputs, nodeDef ); // TODO: Include UVNode.

		let texture;

		this.pending.push( new Promise( ( resolve, reject ) => {

			texture = this.textureLoader.load( inputs.file, resolve, undefined, reject );

		} ) );

		this.endResourceScope( nodeGraphName );

		return new Nodes.TextureNode( texture );

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
