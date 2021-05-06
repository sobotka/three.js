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
					console.warn( `THREE.MaterialXLoader: Unsupported material input, "${ inputDef.getAttribute( 'name' ) }".` );

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

	/**
	 * Reference:
	 * - https://github.com/materialx/MaterialX/tree/main/libraries/stdlib/osl
	 * - https://github.com/materialx/MaterialX/blob/main/libraries/stdlib/osl/mx_funcs.h
	 * - https://github.com/donmccurdy/three-shadenodeloader/tree/master/nodes
	 * - https://www.materialx.org/assets/MaterialX.v1.38D1.Spec.pdf
	 */
	parseNode( nodeDef, nodeGraphName ) {

		let node = this.nodeCache.get( nodeDef );
		if ( node ) return node;

		//

		const inputs = this.parseInputs( nodeDef, nodeGraphName );

		if ( inputs.disable ) {

			// TODO: If node is disabled, skip other inputs.
			return inputs.defaultinput || inputs.default;

		}

		//

		switch ( nodeDef.nodeName ) {

			// BASIC

			case 'output': {

				const sourceName = nodeDef.getAttribute( 'nodename' );
				const sourceDef = this.nodeGraphDefs[ nodeGraphName ].querySelector(`[name=${sourceName}]`);
				node = this.parseNode( sourceDef, nodeGraphName );

			} break;


			// PROCEDURAL

			case 'constant':

				node = inputs.value;
				break;

			case 'ramplr':
			case 'ramptb':
			case 'splitlr':
			case 'splittb':
			case 'noise2d':
			case 'noise3d':
			case 'fractal3d':
			case 'cellnoise2d':
			case 'cellnoise3d':
			case 'worleynoise2d':
			case 'worleynoise3d':

				console.warn( `THREE.MaterialXLoader: Unsupported procedural node, "${ nodeDef.nodeName }".` );
				break;


			// GEOMETRY

			case 'position':

				node = new Nodes.PositionNode( inputs.space === 'world' ? Nodes.PositionNode.WORLD : undefined );
				break;

			case 'normal':

				node = new Nodes.NormalNode( inputs.space === 'world' ? Nodes.PositionNode.WORLD : undefined );
				break;

			case 'tangent':

				node = new Nodes.AttributeNode( 'tangent', 'vec4' );
				break;

			case 'texcoord':

				node = new Nodes.UVNode( inputs.index );
				break;

			case 'geomcolor':

				node = new Nodes.ColorsNode( inputs.index )
				break;

			case 'geompropvalue':

				node = new Nodes.AttributeNode( inputs.geomprop, /* TODO: type */ );
				break;

			case 'bitangent':

				console.warn( `THREE.MaterialXLoader: Unsupported geometry node, "${ nodeDef.nodeName }".` );
				break;


			// TEXTURE

			case 'image':
			case 'tiledimage':

				node = this.parseTexture( nodeDef, nodeGraphName, inputs );
				break;


			// GLOBAL

			case 'ambientocclusion':

				console.warn( `THREE.MaterialXLoader: Unsupported global node, "${ nodeDef.nodeName }".` );
				break;


			// APPLICATION

			case 'frame':
			case 'time':
			case 'viewdirection':
			case 'updirection':

				console.warn( `THREE.MaterialXLoader: Unsupported application node, "${ nodeDef.nodeName }".` );
				break;


			// MATH

			case 'multiply':

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.MUL );
				break;

			case 'divide':

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.DIV );
				break;

			case 'add':

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.ADD );
				break;

			case 'subtract':

				node = new Nodes.OperatorNode( inputs.in1, inputs.in2, Nodes.OperatorNode.SUB );
				break;

			case 'modulo':

				node = new Nodes.MathNode( inputs.in1, inputs.in2, Nodes.MathNode.MOD );
				break;

			case 'absval':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.ABS );
				break;

			case 'sign':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.SIGN );
				break;

			case 'floor':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.FLOOR );
				break;

			case 'ceil':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.CEIL );
				break;

			case 'round':

				console.warn( `THREE.MaterialXLoader: Unsupported math node, "${ nodeDef.nodeName }".` );
				break;

			case 'power':

				node = new Nodes.MathNode( inputs.in1, inputs.in2, Nodes.MathNode.POW );
				break;

			case 'sin':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.SIN );
				break;

			case 'cos':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.COS );
				break;

			case 'tan':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.TAN );
				break;

			case 'asin':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.ASIN );
				break;

			case 'acos':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.ACOS );
				break;

			case 'atan2':

				// TODO: Does not quite match MathNode.ARCTAN.
				console.warn( `THREE.MaterialXLoader: Unsupported math node, "${ nodeDef.nodeName }".` );
				break;

			case 'sqrt':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.SQRT );
				break;

			case 'ln':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.LOG );
				break;

			case 'exp':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.EXP );
				break;

			case 'clamp':

				node = new Nodes.MathNode( inputs.in, inputs.low, inputs.high, Nodes.MathNode.CLAMP );
				break;

			case 'min':

				node = new Nodes.MathNode( inputs.in1, inputs.in2, Nodes.MathNode.MIN );
				break;

			case 'max':

				node = new Nodes.MathNode( inputs.in1, inputs.in2, Nodes.MathNode.MAX );
				break;

			case 'normalize':

				node = new Nodes.MathNode( inputs.in, Nodes.MathNode.NORMALIZE );
				break;

			case 'magnitude':

				console.warn( `THREE.MaterialXLoader: Unsupported math node, "${ nodeDef.nodeName }".` );
				break;

			case 'dotproduct':

				node = new Nodes.MathNode( inputs.in1, inputs.in2, Nodes.MathNode.DOT );
				break;

			case 'crossproduct':
			case 'transformpoint':
			case 'transformvector':
			case 'transformnormal':
			case 'transformmatrix':
			case 'normalmap':
			case 'transpose':
			case 'determinant':
			case 'invertmatrix':
			case 'rotate2d':
			case 'rotate3d':
			case 'arrayappend':
			case 'dot':

				console.warn( `THREE.MaterialXLoader: Unsupported math node, "${ nodeDef.nodeName }".` );
				break;


			// ADJUSTMENT

			case 'remap':

				// TODO: Defaults should match type of given parameters.
				node = new Nodes.RemapNode(
					inputs.in,
					inputs.inlow || new Nodes.FloatNode( 0 ),
					inputs.inhigh || new Nodes.FloatNode( 1 ),
					inputs.outlow || new Nodes.FloatNode( 0 ),
					inputs.outhigh || new Nodes.FloatNode( 1 ),
				);
				break;

			case 'smoothstep':
			case 'curveadjust':
			case 'curvelookup':
			case 'luminance':
			case 'rgbtohsv':
			case 'hsvtorgb':
			case 'contrast': // Supplemental.
			case 'range': // Supplemental.
			case 'saturate': // Supplemental.
			case 'hsvadjust': // Supplemental.

				console.warn( `THREE.MaterialXLoader: Unsupported adjustment node, "${ nodeDef.nodeName }".` );
				break;


			// COMPOSITING

			case 'premult':
			case 'unpremult':
			case 'plus':
			case 'minus':
			case 'difference':
			case 'burn':
			case 'dodge':
			case 'screen':
			case 'overlay':

				console.warn( `THREE.MaterialXLoader: Unsupported blend node, "${ nodeDef.nodeName }".` );
				break;

			case 'disjointover':
			case 'in':
			case 'mask':
			case 'matte':
			case 'out':
			case 'over':

				console.warn( `THREE.MaterialXLoader: Unsupported merge node, "${ nodeDef.nodeName }".` );
				break;

			case 'inside':
			case 'outside':

				console.warn( `THREE.MaterialXLoader: Unsupported masking node, "${ nodeDef.nodeName }".` );
				break;

			case 'mix':

				node = new Nodes.MathNode( inputs.bg, inputs.fg, inputs.mix, Nodes.MathNode.MIX );
				break;


			// CONDITIONAL

			case 'ifgreater':

				node = new Nodes.CondNode( inputs.value1, inputs.value2, inputs.in1, inputs.in2, Nodes.CondNode.GREATER );
				break;

			case 'ifgreatereq':

				node = new Nodes.CondNode( inputs.value1, inputs.value2, inputs.in1, inputs.in2, Nodes.CondNode.GREATER_EQUAL );
				break;

			case 'ifequal':

				node = new Nodes.CondNode( inputs.value1, inputs.value2, inputs.in1, inputs.in2, Nodes.CondNode.EQUAL );
				break;

			case 'switch':

				console.warn( `THREE.MaterialXLoader: Unsupported conditional node, "${ nodeDef.nodeName }".` );
				break;


			// CHANNEL

			case 'convert':
			case 'swizzle':
			case 'combine2':
			case 'combine3':
			case 'combine4':

				console.warn( `THREE.MaterialXLoader: Unsupported channel node, "${ nodeDef.nodeName }".` );
				break;


			// CONVOLUTION

			case 'blur':

				console.warn( `THREE.MaterialXLoader: Unsupported convolution node, "${ nodeDef.nodeName }".` );
				break;

			case 'heighttonormal':

				node = new Nodes.BumpMapNode( inputs.in, inputs.scale );
				node.toNormalMap = true;
				break;

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

		const textureNode = new Nodes.TextureNode( texture );

		for ( const inputName in inputs ) {

			const inputValue = inputs[ inputName ];

			switch ( inputName ) {

				case 'texcoord':

					textureNode.uv = inputValue;
					break;

				case 'uvtiling':
				case 'uaddressmode':
				case 'vaddressmode':
				case 'default':
				case 'layer':

					console.warn( `THREE.MaterialXLoader: Unsupported texture input, "${ inputName }".` );

			}
		}

		return textureNode;

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

		case 'color4':

			return new Nodes.Vector4Node( ... split( value ) );

		case 'filename':

			return value;

		default:

			throw new Error( `THREE.MaterialXLoader: Unexpected input type, "${ type }".` );

	}

}

export { MaterialXLoader };
