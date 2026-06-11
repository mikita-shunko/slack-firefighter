const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

const COMPONENTS_DIR = '/home/kastr/dev/docstack/libs/engine/components/src';

const server = new Server(
  { name: 'docstack-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_components',
      description: 'List all available Docstack components that have .docs.md documentation files',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'get_component_info',
      description: 'Get the documentation content for a specific Docstack component from its .docs.md file',
      inputSchema: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'Component folder name (e.g. "card-grid", "callout", "table")'
          }
        },
        required: ['component_name']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'list_components') {
    const entries = fs.readdirSync(COMPONENTS_DIR, { withFileTypes: true });
    const components = entries
      .filter(e => e.isDirectory())
      .flatMap(dir => {
        const dirPath = path.join(COMPONENTS_DIR, dir.name);
        const docsFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.docs.md'));
        return docsFiles.map(file => ({ component: dir.name, docs_file: file }));
      });
    return { content: [{ type: 'text', text: JSON.stringify(components, null, 2) }] };
  }

  if (name === 'get_component_info') {
    const componentName = args.component_name;
    const componentDir = path.join(COMPONENTS_DIR, componentName);

    if (!fs.existsSync(componentDir)) {
      return { content: [{ type: 'text', text: `Component '${componentName}' not found` }], isError: true };
    }

    const docsFiles = fs.readdirSync(componentDir).filter(f => f.endsWith('.docs.md'));
    if (docsFiles.length === 0) {
      return { content: [{ type: 'text', text: `No .docs.md file found for '${componentName}'` }], isError: true };
    }

    const content = fs.readFileSync(path.join(componentDir, docsFiles[0]), 'utf-8');
    return { content: [{ type: 'text', text: content }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
