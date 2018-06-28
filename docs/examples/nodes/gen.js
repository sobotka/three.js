const fs = require('fs-extra');
const path = require('path');

const docs = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'docs.json'), 'utf8'));

const PAGE_TPL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <base href="{{base}}" />
    <script src="list.js"></script>
    <script src="page.js"></script>
    <link type="text/css" rel="stylesheet" href="page.css" />
  </head>
  <body>
    <h1>[{{name}}]</h1>

    <p class="desc">{{description}}</p>


    <h2>Constructor</h2>

    <h3>{{constructor.header}}</h3>
    <p>{{constructor.description}}</p>


    <h2>Properties</h2>

{{properties}}


    <h2>Methods</h2>

{{methods}}


    <h2>Source</h2>

    [link:https://github.com/mrdoob/three.js/blob/master/src/[path].js src/[path].js]
  </body>
</html>
`;

const PROPERTY_TPL = `    <h3>{{header}}</h3>
    {{description}}
`;

const METHOD_TPL = `    <h3>{{header}}</h3>
    {{description}}
`;

const pages = {};
docs.forEach((entry) => {
  if (entry.type === 'skipped') return;

  if (!pages[entry.page]) {
    pages[entry.page] = {
      section: entry.section,
      name: entry.page,
      description: '',
      constructor: {header: '', description: ''},
      methods: [],
      properties: []
    };
  }

  const page = pages[entry.page];
  const header = entry.header || '';
  const description = entry.description || '';

  switch (entry.type) {
    case 'constructor':
      page.constructor = {header, description};
      break;
    case 'property':
      page.properties.push({header, description});
      break;
    case 'method':
      page.methods.push({header, description});
      break;
    default:
      console.warn('Unknown type: ' + entry.type);
  }
});

Object.keys(pages).forEach((name) => {
  const page = pages[name];
  const methods = page.methods.map((method) => METHOD_TPL
      .replace('{{header}}', method.header)
      .replace('{{description}}', method.description))
    .join('\n');
  const properties = page.properties.map((property) => PROPERTY_TPL
      .replace('{{header}}', property.header)
      .replace('{{description}}', property.description))
    .join('\n');
  const pageContent = PAGE_TPL
      .replace('{{base}}', page.section === '/' ? '../../' : '../../../')
      .replace('{{name}}', name)
      .replace('{{description}}', page.description)
      .replace('{{methods}}', methods)
      .replace('{{properties}}', properties)
      .replace('{{constructor.header}}', page.constructor.header)
      .replace('{{constructor.description}}', page.constructor.description)

  const pageFolder = path.resolve(__dirname, './' + page.section);
  const pagePath = path.resolve(__dirname, './' + page.section + name + '.html');
  fs.ensureDirSync(pageFolder);
  fs.writeFileSync(pagePath, pageContent, 'utf8');

  console.log(`"${name}": "examples/nodes/${page.section}${name}",`.replace('//', '/'));
});

