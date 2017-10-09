const express = require('express');
const rollup  = require('express-middleware-rollup');
const path    = require('path');

const app = express()
  .use(rollup({
    src: 'examples',
    prefix: '/examples',
    mode: 'polyfill',
    moduleName: 'foo'
    // bundleExtension: '.js',
    // serve: true
  }))
  .use(express.static('./'))
  .listen(3001);
