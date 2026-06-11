const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

const DOCS_ROOT = '/home/kastr/dev/dynatrace-docs';

const GUIDE_DOCS = {
  readme:                   { file: 'README.md',                   description: 'Repository overview, structure, branches, PR preview links' },
  contribution:             { file: 'CONTRIBUTION.md',             description: 'Git workflow, branch naming, commit format, local build setup, lint/format' },
  'documentation-guidelines':{ file: 'DOCUMENTATION-GUIDELINES.md', description: 'Writing standards: Diátaxis framework, active voice, frontmatter, content types' },
  releasing:                { file: 'RELEASING.md',                description: 'Release process: daily tags, hardening vs production deployments' },
  'extensions-docs':        { file: 'EXTENSIONS-DOCS.md',          description: 'How to write and structure extension documentation' },
  claude:                   { file: 'CLAUDE.md',                   description: 'Codebase architecture, Python tooling (clio), frontmatter rules, Handlebars components' },
};

const server = new Server(
  { name: 'dynatrace-docs-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_guide_docs',
      description: 'List all available dynatrace-docs guide and setup documents (README, contribution guide, documentation guidelines, releasing, etc.)',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'get_guide_doc',
      description: 'Get the full content of a dynatrace-docs guide document by name. Use list_guide_docs to see available names.',
      inputSchema: {
        type: 'object',
        properties: {
          doc_name: {
            type: 'string',
            description: `Name of the guide doc. One of: ${Object.keys(GUIDE_DOCS).join(', ')}`
          }
        },
        required: ['doc_name']
      }
    },
    {
      name: 'list_scripts',
      description: 'List all npm/pnpm scripts available in the dynatrace-docs repository (start, build, lint, format, setup, etc.)',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'search_guide_docs',
      description: 'Search for a keyword or phrase across all dynatrace-docs guide documents. Returns matching excerpts with file and line context.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword or phrase to search for (case-insensitive)'
          }
        },
        required: ['query']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'list_guide_docs') {
    const docs = Object.entries(GUIDE_DOCS).map(([key, { file, description }]) => ({
      name: key,
      file,
      description,
      exists: fs.existsSync(path.join(DOCS_ROOT, file))
    }));
    return { content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }] };
  }

  if (name === 'get_guide_doc') {
    const entry = GUIDE_DOCS[args.doc_name];
    if (!entry) {
      return {
        content: [{ type: 'text', text: `Unknown doc '${args.doc_name}'. Available: ${Object.keys(GUIDE_DOCS).join(', ')}` }],
        isError: true
      };
    }
    const fullPath = path.join(DOCS_ROOT, entry.file);
    if (!fs.existsSync(fullPath)) {
      return { content: [{ type: 'text', text: `File not found: ${entry.file}` }], isError: true };
    }
    return { content: [{ type: 'text', text: fs.readFileSync(fullPath, 'utf-8') }] };
  }

  if (name === 'list_scripts') {
    const pkgPath = path.join(DOCS_ROOT, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return { content: [{ type: 'text', text: 'package.json not found' }], isError: true };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = Object.entries(pkg.scripts || {}).map(([script, command]) => ({ script, command }));
    return { content: [{ type: 'text', text: JSON.stringify(scripts, null, 2) }] };
  }

  if (name === 'search_guide_docs') {
    const query = args.query.toLowerCase();
    const CONTEXT_LINES = 3;
    const results = [];

    for (const [key, { file }] of Object.entries(GUIDE_DOCS)) {
      const fullPath = path.join(DOCS_ROOT, file);
      if (!fs.existsSync(fullPath)) continue;
      const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (!line.toLowerCase().includes(query)) return;
        const start = Math.max(0, i - CONTEXT_LINES);
        const end = Math.min(lines.length - 1, i + CONTEXT_LINES);
        results.push({
          file,
          line: i + 1,
          excerpt: lines.slice(start, end + 1).join('\n')
        });
      });
    }

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No results found for '${args.query}'` }] };
    }

    const output = results
      .map(r => `### ${r.file} (line ${r.line})\n\`\`\`\n${r.excerpt}\n\`\`\``)
      .join('\n\n');

    return { content: [{ type: 'text', text: `Found ${results.length} match(es) for '${args.query}':\n\n${output}` }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
