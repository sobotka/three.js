import { sRGBColorSpace, LinearSRGBColorSpace, DisplayP3ColorSpace, LinearACESCGColorSpace  } from '../constants.js';
import { Matrix3 } from './Matrix3.js';
import { Vector3 } from './Vector3.js';

export let SourceColorSpace = LinearSRGBColorSpace;
export let WorkingColorSpace = LinearSRGBColorSpace;

export function SRGBToLinear( c ) {

	return ( c < 0.04045 ) ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 );

}

export function LinearToSRGB( c ) {

	return ( c < 0.0031308 ) ? c * 12.92 : 1.055 * ( Math.pow( c, 0.41666 ) ) - 0.055;

}

// Chromatic Adaptation Transform (CAT) RGB-to-RGB transforms, defined as
// CAT02[InputColorSpace][OutputColorSpace] 3x3 matrices.
// Based on https://www.colour-science.org/apps/.
const CAT02 = {
	[LinearACESCGColorSpace]: {
		[sRGBColorSpace]: [
			1.7048873310, -0.6241572745, -0.0808867739,
			-0.1295209353,  1.1383993260, -0.0087792418,
			-0.0241270599, -0.1246206123,  1.1488221099,
		],
		[DisplayP3ColorSpace]: [
			1.3793363837, -0.3112868172, -0.0680495665,
			-0.0687964722,  1.0799570656, -0.0111605934,
			-0.0022666792, -0.0417050150,  1.0439716942,
		],
	},
	[sRGBColorSpace]: {
		[LinearACESCGColorSpace]: [
			0.6131178129,  0.3411819959,  0.0457873443,
			0.0699340823,  0.9181030375,  0.0119327755,
			0.0204629926,  0.1067686634,  0.8727159106,
		],
	},
	[DisplayP3ColorSpace]: {
		[LinearACESCGColorSpace]: [
			0.7357429995, 0.2140109244, 0.0502460760,
			0.0469048867, 0.9399887338, 0.0131063796,
			0.0034712266, 0.0380157226, 0.9585130508,
		],
	},
}

const _matrix = /*@__PURE__*/new Matrix3();
const _vector = /*@__PURE__*/new Vector3();

export class ColorManagement {

	static getSourceColorSpace() {

		return SourceColorSpace;

	}

	static setSourceColorSpace( colorSpace ) {

		SourceColorSpace = colorSpace;

	}

	static getWorkingColorSpace() {

		return WorkingColorSpace;

	}

	static setWorkingColorSpace( colorSpace ) {

		WorkingColorSpace = colorSpace;

	}

	static fromWorkingColorSpace( color, colorSpace = SourceColorSpace ) {

		if ( colorSpace === WorkingColorSpace ) {

			return color;

		}

		if ( colorSpace === sRGBColorSpace && WorkingColorSpace === LinearSRGBColorSpace ) {

			color.r = LinearToSRGB( color.r );
			color.g = LinearToSRGB( color.g );
			color.b = LinearToSRGB( color.b );

			return color;

		}

		if ( CAT02[ WorkingColorSpace ] && CAT02[ WorkingColorSpace ][ colorSpace ] !== undefined ) {

			_matrix.fromArray( CAT02[ WorkingColorSpace ][ colorSpace ] ).transpose();
			_vector.set( color.r, color.g, color.b ).applyMatrix3( _matrix );

			color.r = _vector.x;
			color.g = _vector.y;
			color.b = _vector.z;

			return color;

		}

		throw new Error( 'Unsupported color space conversion.' );

	}

	static toWorkingColorSpace( color, colorSpace = SourceColorSpace ) {

		if ( colorSpace === WorkingColorSpace ) {

			return color;

		}

		if ( colorSpace === sRGBColorSpace && WorkingColorSpace === LinearSRGBColorSpace ) {

			color.r = SRGBToLinear( color.r );
			color.g = SRGBToLinear( color.g );
			color.b = SRGBToLinear( color.b );

			return color;

		}

		if ( CAT02[ colorSpace ] && CAT02[ colorSpace ][ WorkingColorSpace ] !== undefined ) {

			_matrix.fromArray( CAT02[ WorkingColorSpace ][ colorSpace ] ).transpose();
			_vector.set( color.r, color.g, color.b ).applyMatrix3( _matrix );

			color.r = _vector.x;
			color.g = _vector.y;
			color.b = _vector.z;

			return color;

		}

		throw new Error( 'Unsupported color space conversion.' );

	}

};
