const url = require('url');
const fetch = require('node-fetch');

const PACKAGE_REGEX = /^three(@\d+\.\d+\.\d+)?$/;
const MODULE_REGEX = /^[\w\/\.]+$/;
const BAD_REQUEST_RESPONSE = '<!DOCTYPE html><h1>400 Bad Request</h1><p>Invalid package or version.</p>';

module.exports = async ( req, res ) => {

	const { package, module } = req.query;

	if ( ! PACKAGE_REGEX.test( package ) || ! MODULE_REGEX.test( module ) ) {

		res.status( 400 ).send( BAD_REQUEST_RESPONSE );
		return;

	}

	const cdnResponse = await fetch( `https://unpkg.com/${package}/${module}` );

	if ( cdnResponse.redirected ) {

		res.writeHead( 301, { Location: url.parse( cdnResponse.url ).pathname } );
		res.end();
		return;

	}

	const content = ( await cdnResponse.text() )
		.replace( 'import {', 'var {' )
		.replace( /} from .*;/, '} = THREE;' )
		.replace( /export { (.*) };/, 'THREE.$1 = $1;' );

	res.setHeader( 'Content-Type', 'text/javascript' );
	res.send( content );

};
