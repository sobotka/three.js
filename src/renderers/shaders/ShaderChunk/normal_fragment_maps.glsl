#if defined( USE_TANGENT ) && defined( USE_NORMALMAP )

	// mat3 tbn = mat3( normalize( vTangent ), normalize( vBinormal ), normalize( vNormal ) );
	mat3 tbn = mat3( tangent, binormal, normal );
	vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
	mapN.xy = normalScale * mapN.xy;
	normal = normalize( tbn * mapN );

#elif defined( USE_NORMALMAP )

	normal = perturbNormal2Arb( -vViewPosition, normal );

#elif defined( USE_BUMPMAP )

	normal = perturbNormalArb( -vViewPosition, normal, dHdxy_fwd() );

#endif
