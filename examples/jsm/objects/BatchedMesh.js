import { BufferAttribute, BufferGeometry, Mesh, Matrix4 } from 'three';

const _vector = /*@__PURE__*/ new Vector3();

const _itemWorldMatrix = /*@__PURE__*/ new Matrix4();

const _batchIntersects = [];

const _mesh = /*@__PURE__*/ new Mesh();

class BatchedMesh extends Mesh {

  constructor( geometry, material, vertexCount, indexCount ) {

    super( new BufferGeometry(), material );

    if ( ! geometry.index ) {

      throw new Error( 'THREE.BatchedMesh: Indexed geometry required.' );

    }

    this.vertexCount = vertexCount;
    this.indexCount = indexCount;

    this._batchItemProperties = [];
    this._batchItemIndex = {};
    this._nextID = 1;

    //

    for ( const attributeName in geometry.attributes ) {

      const srcAttribute = geometry.attributes[ attributeName ];

      const { array, itemSize, normalized } = srcAttribute;

      const dstArray = new array.constructor( this.vertexCount * itemSize );
      const dstAttribute = new srcAttribute.constructor( dstArray, itemSize, normalized );

      this.geometry.setAttribute( attributeName, dstAttribute );

    }

    const indexArray = indexCount > 65534
      ? new Uint32Array( indexCount )
      : new Uint16Array( indexCount );

    this.geometry.setIndex( new BufferAttribute( indexArray, 1 ) );

    //

    this.geometry.setDrawRange( 0, 0 );

  }

  copy( source ) {

    super.copy( source );

    this.vertexCount = source.vertexCount;
    this.indexCount = source.indexCount;

    this._batchItemProperties = source._batchItemProperties.slice();
    this._batchItemIndex = Object.assign( {}, source._batchItemIndex );
    thsi._nextID = source._nextID;

    return this;

  }

  addGeometry( geometry, matrix, static = false ) {

    const id = this.nextID++;
    const index = this._batchItemProperties.length;
    const prevItem = this._batchItemProperties[ index - 1 ];

    if ( geometry.boundingBox === null ) geometry.computeBoundingBox();

    const item = {

      id: id,

      geometry: static ? null : geometry,
      boundingBox: geometry.boundingBox,
      matrix: matrix.toArray( [] ),

      vertexOffset: prevItem.vertexOffset + prevItem.vertexCount,
      vertexCount: geometry.attributes.position.count,

      indexOffset: prevItem.indexOffset + prevItem.indexCount,
      indexCount: geometry.index.count,

    };

    this._batchItemProperties.push( item );
    this._batchItemIndex[ id ] = index;

    //

    for ( let attributeName in this.geometry ) {

      const srcAttribute = geometry.attributes[ attributeName ];
      const dstAttribute = this.geometry.attributes[ attributeName ];

      dstAttribute.array.set( srcAttribute.array, item.vertexOffset );

    }

    const srcIndex = geometry.index;
    const dstIndex = this.geometry.index;

    dstIndex.array.set( srcIndex.array, item.indexOffset );

    //

    this.geometry.setDrawRange( 0, item.indexOffset + item.indexCount );

    return id;

  }

  removeGeometry( id ) {

    const index = this._batchItemIndex[ id ];

    if ( index === undefined ) return;

    const prevItem = this._batchItemProperties[ index - 1 ];
    const geometry = this.geometry;

    let vertexOffset = prevItem ? prevItem.vertexOffset : 0;
    let indexOffset = prevItem ? prevItem.indexOffset : 0;

    for ( let i = index + 1; i < this._batchItemProperties.length; i++ ) {

      const item = this._batchItemProperties[ i ];

      for ( const attributeName in geometry.attributes ) {

        const attribute = geometry.attributes[ attributeName ];

        for ( let j = 0; j < item.vertexCount; j++ ) {

          attribute.copyAt( vertexOffset + j, attribute, item.vertexOffset + j );

        }

      }

      for ( let j = 0; j < item.indexCount; j++ ) {

        geometry.index.setX( indexOffset + j, geometry.index.getX( item.indexOffset + j ) );

      }

      item.vertexOffset = vertexOffset;
      item.indexOffset = indexOffset;

      vertexOffset += item.vertexCount;
      indexOffset += item.indexCount;

    }

    delete this._batchItemIndex[ id ];
    this._batchItemProperties.splice( index, 1 );

    //

    this.geometry.setDrawRange( 0, indexOffset );

  }

  getMatrixAt( id, matrix ) {

    matrix.fromArray( this._batchItemProperties[ this._batchItemIndex[ id ] ].matrix );

  }

  setMatrixAt( id, matrix ) {

    const item = this._batchItemProperties[ this._batchItemIndex[ id ] ];

    if ( item.geometry === null ) {

      throw new Error( 'THREE.BatchedMesh: Cannot update static geometry.' );

    }

    matrix.toArray( item.matrix );

    const { position: srcPosition, normal: srcNormal, tangent: srcTangent } = item.geometry.attributes;
    const { position: dstPosition, normal: dstNormal, tangent: dstTangent } = this.geometry.attributes;

    if ( srcPosition ) {

      dstPosition.array.set( srcPosition.array, item.vertexOffset );
      dstPosition.applyMatrix4( item.matrix, item.vertexOffset, item.vertexCount );

    }

    if ( srcNormal ) {

      dstNormal.array.set( srcNormal.array, item.vertexOffset );
      dstNormal.applyNormalMatrix( item.matrix, item.vertexOffset, item.vertexCount );

    }

    if ( srcTangent ) {

      dstTangent.array.set( srcTangent.array, item.vertexOffset );
      dstTangent.applyNormalMatrix( item.matrix, item.vertexOffset, item.vertexCount );

    }

  }

  raycast( raycaster, intersects ) {

    const matrixWorld = this.matrixWorld;
    const itemCount = this._batchItemProperties.length;

    _mesh.geometry = this.geometry;
    _mesh.material = this.material;

    if ( _mesh.material === undefined ) return;

    const { start, count } = this.geometry.drawRange;

    try {

      for ( let index = 0; index < itemCount; index ++ ) {

        const item = this._batchItemProperties[ index ];

        // calculate the world matrix for each item

        this.getMatrixAt( id, _itemWorldMatrix );

        _itemWorldMatrix.multiplyMatrices( matrixWorld, _itemWorldMatrix );

        // the mesh represents this single instance

        _mesh.matrixWorld = _instanceWorldMatrix;

        this.geometry.setDrawRange( item.indexOffset, item.indexCount );

        _mesh.raycast( raycaster, _batchIntersects );

        // process the result of raycast

        for ( let i = 0, l = _batchIntersects.length; i < l; i ++ ) {

          const intersect = _batchIntersects[ i ];
          intersect.batchGeometryId = id;
          intersect.object = this;
          intersects.push( intersect );

        }

        _batchIntersects.length = 0;

      }

    } finally {

      this.geometry.setDrawRange( start, count );

    }

  }

  updateMorphTargets() {

  }

  dispose() {

    this.dispatchEvent( { type: 'dispose' } );

  }

}

BatchedMesh.prototype.isBatchedMesh = true;

export { BatchedMesh };
