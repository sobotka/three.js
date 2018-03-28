#ifdef FLAT_SHADED

	// Workaround for Adreno/Nexus5 not able able to do dFdx( vViewPosition ) ...

	vec3 fdx = vec3( dFdx( vViewPosition.x ), dFdx( vViewPosition.y ), dFdx( vViewPosition.z ) );
	vec3 fdy = vec3( dFdy( vViewPosition.x ), dFdy( vViewPosition.y ), dFdy( vViewPosition.z ) );
	vec3 normal = normalize( cross( fdx, fdy ) );

#else

	vec3 normal = normalize( vNormal );

	#ifdef DOUBLE_SIDED

		normal = normal * ( float( gl_FrontFacing ) * 2.0 - 1.0 );

	#endif

	#ifdef USE_TANGENT

		vec3 tangent = normalize( vTangent );
		vec3 binormal = normalize( vBinormal );

		// NOTES: It doesn't seem like I'm handling double-sided materials
		// correctly. With this line in place, the tangents are right on the front,
		// and wrong on the back. Otherwise vice-versa.
		tangent = tangent * -1.0 * ( float( gl_FrontFacing ) * 2.0 - 1.0 );

		#ifdef DOUBLE_SIDED

			// tangent = tangent * ( float( gl_FrontFacing ) * 2.0 - 1.0 );
			// ok thats worse
			// binormal = binormal * ( float( gl_FrontFacing ) * 2.0 - 1.0 );

		#endif

	#endif

#endif
