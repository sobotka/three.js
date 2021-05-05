import {
	Color,
	Loader,
	FileLoader,
	TextureLoader
} from '../../../build/three.module.js';

import * as Nodes from '../nodes/Nodes.js';

console.log( Nodes );

class MaterialXLoader extends Loader {

	constructor( manager ) {

		super( manager );

	}

	load( url, onLoad, onProgress, onError ) {

		const scope = this;

		const loader = new FileLoader( scope.manager );
		loader.setPath( scope.path );
		loader.load( url, function ( text ) {

			onLoad( scope.parse( text ) );

		}, onProgress, onError );

		return this;

	}

	parse( text ) {

		const scope = this;
		const parser = new DOMParser();
		const dom = parser.parseFromString( text, 'application/xml' );

		console.log( dom.documentElement );

		const filePrefix = dom.documentElement.getAttribute( 'fileprefix' );
		const resourcePath = filePrefix ? new URL( filePrefix, this.path ).href : this.path;
		const textureLoader = new TextureLoader( scope.manager ).setPath( resourcePath );

		const nodeGraphOutputs = {};
		const surfaceShaders = {};
		const materials = {};

		for ( const nodeDef of dom.documentElement.children ) {

			if ( nodeDef.nodeName === 'surfacematerial' ) {

				parseSurfaceMaterial( nodeDef );

			} else if ( nodeDef.nodeName === 'standard_surface' ) {

				parseStandardSurface( nodeDef );

			} else if ( nodeDef.nodeName === 'nodegraph' ) {

				parseNodeGraph( nodeDef );

			} else {

				console.warn( `THREE.MaterialXLoader: Unexpected root node type, "${ nodeDef.nodeName }".` );

			}

		}

		function parseNodeGraph( nodeGraphDef ) {

			const filePrefix = nodeGraphDef.getAttribute( 'fileprefix' );

			if ( filePrefix ) {

				textureLoader.setPath( new URL( filePrefix, resourcePath ).href );

			}

			const nodes = {};
			const outputs = {};

			let nodeDef;

			for ( const nodeDef of nodeGraphDef.children ) {

				const name = nodeDef.getAttribute( 'name' );

				switch ( nodeDef.nodeName ) {

					case 'tiledimage':
						nodes[ name ] = new Nodes.TextureNode(
							textureLoader.load( nodeDef.querySelector( '[name=file]' ).getAttribute( 'value' ) )
							// new Nodes.UVNode(),
						);
						break;

					case 'output':
						outputs[ name ] = nodes[ nodeDef.getAttribute( 'nodename' ) ];
						break;

					default:

						console.warn( `THREE.MaterialXLoader: Unexpected node graph element, "${ nodeDef.nodeName }".` );

				}

			}

			if ( filePrefix ) {

				textureLoader.setPath( resourcePath );

			}

			nodeGraphOutputs[ nodeGraphDef.getAttribute( 'name' ) ] = outputs;

		}

		function parseSurfaceMaterial( surfaceMaterialDef ) {

			const surfaceShaderDef = surfaceMaterialDef.children[ 0 ];

			if ( surfaceShaderDef.getAttribute( 'type' ) === 'surfaceshader' ) {

				const material = surfaceShaders[ surfaceShaderDef.getAttribute( 'nodename' ) ];

				materials[ surfaceMaterialDef.getAttribute( 'name' ) ] = material;

			} else {

				console.warn( `THREE.MaterialXLoader: Unexpected surface material type, "${ surfaceShaderDef.getAttribute( 'type' ) }".` );

			}

		}

		function parseStandardSurface( standardSurfaceDef ) {

			const material = new Nodes.MeshStandardNodeMaterial();

			surfaceShaders[ standardSurfaceDef.getAttribute( 'name' ) ] = material;

			for ( const inputDef of standardSurfaceDef.children ) {

				switch ( inputDef.getAttribute( 'name' ) ) {

					case 'base_color':
						material.color = parseInput( inputDef );
						break;

					case 'opacity':
						material.opacity = parseInput( inputDef );
						break;

					case 'diffuse_roughness':  // TODO
					case 'specular_roughness': // TODO
						material.roughness = parseInput( inputDef );
						break;

					case 'metalness':
						material.metalness = parseInput( inputDef );
						break;

					case 'emission_color':
						material.emissive = parseInput( inputDef );
						break;

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

		}

		function parseInput( inputDef ) {

			const inputType = inputDef.getAttribute( 'type' );
			const nodeGraphName = inputDef.getAttribute('nodegraph');

			if ( nodeGraphName ) {

				return nodeGraphOutputs[ nodeGraphName ][ inputDef.getAttribute( 'output' ) ];

			}

			const value = inputDef.getAttribute( 'value' );

			console.log( `${value} -> ${inputType}` );

			switch ( inputType ) {

				case 'float':

					return new Nodes.FloatNode( Number( value ) );

				case 'color3':

					return new Nodes.ColorNode( new Color( value.split(',').map( ( c ) => Number( c.trim() ) ) ) );

				default:

					// TODO
					console.warn( `THREE.MaterialXLoader: Unexpected input type, "${ inputType }".` );
					return null;

			}

		}

		return { materials };

	}

}

export { MaterialXLoader };
