import {
	Color,
	FileLoader,
	Loader,
	TextureLoader,
	RepeatWrapping,
	ClampToEdgeWrapping,
	MirroredRepeatWrapping,
} from '../../../build/three.module.js';
import * as Nodes from '../nodes/Nodes.js';

const UV_ADDRESS_MODE = {
	constant: ClampToEdgeWrapping, // TODO: Incorrect.
	clamp: ClampToEdgeWrapping,
	periodic: RepeatWrapping,
	mirror: MirroredRepeatWrapping
}

const SUPPORTED_SURFACE_SHADERS = [
	'standard_surface',
	'disney_brdf_2012',
	'disney_brdf_2015',
];

const SUPPORTED_DISPLACEMENT_SHADERS = [];

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

		return new MaterialXParser( this.manager, this.path ).parse( text );

	}

	async parseAsync( text ) {

		const parser = new MaterialXParser( this.manager, this.path );

		console.time('MaterialXLoader.parse');

		let result;

		try {

			result = parser.parse( text );

		} finally {

			console.timeEnd('MaterialXLoader.parse');

		}

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

		this.root = null;

		this.rootDefs = {};
		this.nodeGraphDefs = {};
		this.customNodeDefs = {};
		this.customNodeInterfaceValues = {};

		this.nodeCache = new WeakMap();

		this.pending = [];

	}

	parse( text ) {

		const scope = this;
		const dom = new DOMParser().parseFromString( text, 'application/xml' );

		this.root = dom.documentElement;

		const version = this.root.getAttribute( 'version' );
		if ( version !== '1.38' ) {

			console.warn( `THREE.MaterialXLoader: Expected MaterialX version v1.38, found v${version}.` );

		}

		console.log( this.root ); // TODO: Clean up.

		const filePrefix = this.root.getAttribute( 'fileprefix' );
		this.resourcePath = filePrefix ? new URL( filePrefix, this.path ).href : this.path;
		this.textureLoader.setPath( this.resourcePath );

		//

		const materialDefs = [];

		for ( const nodeDef of this.root.children ) {

			const name = nodeDef.getAttribute( 'name' );
			const nodeName = nodeDef.nodeName;
			const nodeType = nodeDef.getAttribute( 'type' );

			this.rootDefs[ name ] = nodeDef;

			if ( nodeType === 'material' ) {

				materialDefs.push( nodeDef );

			}

			if ( nodeName === 'nodegraph' ) {

				this.nodeGraphDefs[ name ] = nodeDef;

			} else if ( nodeName === 'nodedef' ) {

				this.customNodeDefs[ nodeDef.getAttribute( 'node' ) ] = nodeDef;
				this.parseCustomNodeDef( nodeDef );

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

	parseCustomNodeDef( nodeDef ) {

		const nodeDefName = nodeDef.getAttribute( 'name' );

		this.customNodeInterfaceValues[ nodeDefName ] = {};

		for ( const inputDef of nodeDef.children ) {

			const name = inputDef.getAttribute( 'name' );
			const type = inputDef.getAttribute( 'type' );
			const value = inputDef.getAttribute( 'value' );

			const inputNode = formatValue( type, value );

			inputNode.name = name;

			this.customNodeInterfaceValues[ nodeDefName ][ name ] = inputNode;

		}

	}

	parseSurfaceMaterial( surfaceMaterialDef ) {

		const materialName = surfaceMaterialDef.getAttribute( 'name' );

		let surfaceShaderDef;
		let displacementShaderDef;

		for ( const inputDef of surfaceMaterialDef.children ) {

			const inputType = inputDef.getAttribute( 'type' );
			const inputName = inputDef.getAttribute( 'nodename' );

			if ( inputType === 'surfaceshader' ) {

				const nodeDef = this.rootDefs[ inputName ];

				if ( ! SUPPORTED_SURFACE_SHADERS.includes( nodeDef.nodeName ) ) continue;

				surfaceShaderDef = nodeDef;

			} else if ( inputType === 'displacementshader' ) {

				const nodeDef = this.rootDefs[ inputName ];

				if ( ! SUPPORTED_DISPLACEMENT_SHADERS.includes( nodeDef.nodeName ) ) continue;

				displacementShaderDef = nodeDef;

			}

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

		} else if ( surfaceShaderDef.nodeName === 'disney_brdf_2012' ) {

			material = this.parseDisneyBRDF2015( surfaceShaderDef );

		} else {

			console.warn( `THREE.MaterialXLoader: Unsupported surface shader, "${ surfaceShaderDef.nodeName }".` );
			return null;

		}

		if ( displacementShaderDef ) {

			// material.position = ...
			// material.normal = ...
			console.warn( `THREE.MaterialXLoader: Displacement shader not yet implemented.` );

		}

		material.name = materialName;

		return material;

	}

	/**
	 * Reference: https://github.com/materialx/MaterialX/blob/main/libraries/bxdf/standard_surface.mtlx
	 */
	parseStandardSurface( surfaceDef ) {

		const material = new Nodes.MeshStandardNodeMaterial();

		material.color.set( 0.8, 0.8, 0.8 );
		material.roughness = 0.2;
		material.metalness = 0;
		material.opacity = 1;

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

				case 'diffuse_roughness':
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

				case 'subsurface': // Default 0.
				case 'specular': // Default 0.5.
				case 'specularTint': // Default 0.
				case 'anisotropic': // Default 0.
				case 'sheen': // Default 0.
				case 'sheenTint': // Default 0.5.
				case 'clearcoat': // Default 0.
				case 'clearcoatGloss': // Default 1.

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

				case 'anisotropic': // Default 0.
				case 'specularTint': // Default 0.
				case 'sheen': // Default 0.
				case 'sheenTint': // Default 0.5.
				case 'clearcoat': // Default 0.
				case 'clearcoatGloss': // Default 1.
				case 'specTrans': // Default 0.
				case 'ior': // Default 1.5.
				case 'scatterDistance': // Default 0, 0, 0.
				case 'flatness': // Default 0.
				case 'diffTrans': // Default 0.
				case 'thin': // Default false. (uniform)

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
	 * - https://www.materialx.org/assets/MaterialX.v1.38.Supplement.pdf
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

			case 'noise2d':

				node = new Nodes.Noise2DNode( inputs.texcoord, inputs.amplitude, inputs.pivot );
				break;

			case 'noise3d':

				node = new Nodes.Noise3DNode( inputs.position, inputs.amplitude, inputs.pivot );
				break;

			case 'fractal3d':

				node = new Nodes.Fractal3DNode(
					inputs.position,
					inputs.amplitude,
					inputs.octaves ? inputs.octaves.value : undefined,
					inputs.lacunarity ? inputs.lacunarity.value : undefined,
					inputs.diminish ? inputs.diminish.value : undefined
				);
				break;

			case 'ramplr':

				node = new Nodes.MathNode(
					inputs.valuel,
					inputs.valuer,
					new Nodes.SwitchNode( inputs.texcoord || new Nodes.UVNode(), 'x' ),
					Nodes.MathNode.MIX
				);
				break;

			case 'ramptb':

				node = new Nodes.MathNode(
					inputs.valueb,
					inputs.valuet,
					new Nodes.SwitchNode( inputs.texcoord || new Nodes.UVNode(), 'y' ),
					Nodes.MathNode.MIX
				);
				break;

			case 'splitlr':

				node = new Nodes.CondNode(
					new Nodes.SwitchNode( inputs.texcoord || new Nodes.UVNode(), 'x' ),
					inputs.center || new Nodes.FloatNode( 0.5 ).setReadonly( true ),
					Nodes.CondNode.LESS,
					inputs.valuel,
					inputs.valuer
				);
				break;

			case 'splittb':

				node = new Nodes.CondNode(
					new Nodes.SwitchNode( inputs.texcoord || new Nodes.UVNode(), 'y' ),
					inputs.center || new Nodes.FloatNode( 0.5 ).setReadonly( true ),
					Nodes.CondNode.LESS,
					inputs.valueb,
					inputs.valuet
				);
				break;

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

			case 'place2d': {

				// TODO: UVTransformNode does not accept offset/scale/rotate/pivot inputs.
				// TODO: Calibration material not working.
				node = new Nodes.UVTransformNode( inputs.texcoord );
				node.setUvTransform(
					inputs.offset instanceof Nodes.Vector2Node ? inputs.offset.value.x : 0,
					inputs.offset instanceof Nodes.Vector2Node ? inputs.offset.value.y : 0,
					inputs.scale instanceof Nodes.Vector2Node ? inputs.scale.value.x : 1,
					inputs.scale instanceof Nodes.Vector2Node ? inputs.scale.value.y : 1,
					inputs.rotate instanceof Nodes.FloatNode ? inputs.rotate.value : 0,
					inputs.pivot instanceof Nodes.Vector2Node ? inputs.pivot.value.x : 0,
					inputs.pivot instanceof Nodes.Vector2Node ? inputs.pivot.value.y : 0
				);

			} break;


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

				node = new Nodes.MathNode(
					inputs.in,
					inputs.low || new Nodes.FloatNode( 0.0 ).setReadonly( true ),
					inputs.high || new Nodes.FloatNode( 1.0 ).setReadonly( true ),
					Nodes.MathNode.CLAMP
				);
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

			case 'dot':
				node = inputs.in;
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

			case 'hsvtorgb':

				node = new Nodes.JoinNode(
					new Nodes.ColorAdjustmentNode( inputs.in, new Nodes.FloatNode( 0.0 ).setReadonly( true ), Nodes.ColorAdjustmentNode.HUE ),
					new Nodes.ColorAdjustmentNode( inputs.in, new Nodes.FloatNode( 0.0 ).setReadonly( true ), Nodes.ColorAdjustmentNode.SATURATION ),
					new Nodes.ColorAdjustmentNode( inputs.in, new Nodes.FloatNode( 0.0 ).setReadonly( true ), Nodes.ColorAdjustmentNode.VIBRANCE ),
				);
				break;

			case 'rgbtohsv': {

				// https://stackoverflow.com/questions/15095909/from-rgb-to-hsv-in-opengl-glsl
				const rgbtohsv = new Nodes.FunctionNode(`
vec3 rgb2hsv(vec3 c)
{
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
				`.trim());

				node = new Nodes.FunctionCallNode( rgbtohsv, [ inputs.in ] );

			} break;

			case 'smoothstep':
			case 'curveadjust':
			case 'curvelookup':
			case 'luminance':
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

			case 'combine2':
			case 'combine3':
			case 'combine4':

				node = new Nodes.JoinNode( inputs.in1, inputs.in2, inputs.in3, inputs.in4 );
				break;

			case 'swizzle':

				node = new Nodes.SwitchNode( inputs.in, inputs.channels );
				break;

			case 'convert':


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

		node.name = nodeDef.getAttribute( 'name' );

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

		const otherNodeGraphName = inputDef.getAttribute( 'nodegraph' );
		if ( otherNodeGraphName ) {

			const sourceName = inputDef.getAttribute( 'output' );
			const sourceDef = this.nodeGraphDefs[ otherNodeGraphName ].querySelector( `output[name=${sourceName}]` );
			return this.parseNode( sourceDef, otherNodeGraphName );

		}

		//

		const nodeName = inputDef.getAttribute( 'nodename' );
		if ( nodeName && nodeGraphName ) {

			const sourceDef = this.nodeGraphDefs[ nodeGraphName ].querySelector( `[name=${nodeName}]` );
			return this.parseNode( sourceDef, nodeGraphName );

		} else if ( nodeName ) {

			let sourceDef = this.rootDefs[ nodeName ];

			if ( sourceDef.nodeName in this.customNodeDefs ) {

				const customNodeDef = this.customNodeDefs[ sourceDef.nodeName ];
				const customNodeDefName = customNodeDef.getAttribute( 'name' );
				const customNodeGraph = this.root.querySelector( `nodegraph[nodedef=${customNodeDefName}]` );
				const customNodeGraphName = customNodeGraph.getAttribute( 'name' );

				const output = inputDef.getAttribute( 'output' );
				sourceDef = customNodeGraph.querySelector( `[name=${output}]` );

				this.customNodeInterfaceValues[ customNodeGraphName ] = this.customNodeInterfaceValues[ customNodeDefName ];

				return this.parseNode( sourceDef, customNodeGraphName );

			}

			debugger;

		}

		//

		const type = inputDef.getAttribute( 'type' );
		const value = inputDef.getAttribute( 'value' );

		if ( ! value ) {

			const interfaceName = inputDef.getAttribute( 'interfacename' );

			return this.customNodeInterfaceValues[ nodeGraphName ][ interfaceName ];

		}

		return formatValue( type, value );

	}

	parseTexture( nodeDef, nodeGraphName, inputs ) {

		this.beginResourceScope( nodeGraphName );

		let texture;

		this.pending.push( new Promise( ( resolve, reject ) => {

			texture = this.textureLoader.load( inputs.file, resolve, undefined, reject );
			texture.wrapS = texture.wrapT = RepeatWrapping;
			texture.flipY = false;

		} ) );

		this.endResourceScope( nodeGraphName );

		const textureNode = new Nodes.TextureNode( texture );

		for ( const inputName in inputs ) {

			const inputValue = inputs[ inputName ];

			switch ( inputName ) {

				case 'texcoord':

					textureNode.uv = inputValue;
					break;

				case 'uaddressmode':
					texture.wrapS = UV_ADDRESS_MODE[ inputValue ];
					break;

				case 'vaddressmode':
					texture.wrapT = UV_ADDRESS_MODE[ inputValue ];
					break;

				case 'uvtiling':
					textureNode.uv = new Nodes.OperatorNode( textureNode.uv, inputValue, Nodes.OperatorNode.MUL );
					break;

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

		case 'string':
		case 'filename':

			return value;

		default:

			throw new Error( `THREE.MaterialXLoader: Unexpected input type, "${ type }".` );

	}

}

export { MaterialXLoader };
