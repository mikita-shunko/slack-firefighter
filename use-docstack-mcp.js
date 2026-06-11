require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'docstack-mcp.js')]
  });

  const mcpClient = new Client(
    { name: 'docstack-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await mcpClient.connect(transport);

  const { tools: mcpTools } = await mcpClient.listTools();
  console.log('MCP tools available:', mcpTools.map(t => t.name).join(', '));

  const claudeTools = mcpTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));

  const anthropic = new Anthropic();

  const SYSTEM_PROMPT = `You are a documentation assistant for the dynatrace-docs repository, which uses Docstack as its documentation framework.

Your responsibilities:
- Answer questions about Docstack components, their parameters, and usage examples.
- Answer questions about setting up, running, building, linting, and contributing to the dynatrace-docs repository.
- Use the available tools to look up component docs, guide documents, and available scripts when needed.
- When explaining how to use a Docstack component, always show examples using code blocks with the Handlebars syntax, e.g.:
  \`\`\`
  {{#card-grid title='My Grid'}}
  {{#card icon='star'}}Card content{{/card}}
  {{/card-grid}}
  \`\`\`
- When explaining setup or scripts, show exact pnpm commands in code blocks, e.g.:
  \`\`\`sh
  pnpm repo:setup
  pnpm dynatrace:start
  \`\`\`

Rules you must follow:
1. Only answer questions that are directly related to Docstack components or the dynatrace-docs repository (setup, contribution workflow, scripts, writing guidelines, release process). If a question is about something else, do not answer it — instead respond ONLY with: "This is outside my scope. Pinging @mikita-shunko for help."
2. If you cannot find enough information to give a confident answer, do not answer — respond ONLY with: "I'm not sure about this. Pinging @mikita-shunko for help."
3. If the question lacks context or is ambiguous, do not ask for clarification and do not attempt to answer — respond ONLY with: "This question needs more context. Pinging @mikita-shunko for help."
4. When you can answer, respond in a single message with the most probable solution. Never ask follow-up questions or request more details.`;

  const messages = [
    {
      role: 'user',
      content: 'List all available Docstack components, then show me the full documentation for the card-grid component.'
    }
  ];

  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: claudeTools,
      messages
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      for (const block of response.content) {
        if (block.type === 'text') console.log('\n--- Claude ---\n', block.text);
      }
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        console.log(`\n[Tool call] ${block.name}`, JSON.stringify(block.input));
        const result = await mcpClient.callTool({ name: block.name, arguments: block.input });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  await mcpClient.close();
}

main().catch(err => { console.error(err); process.exit(1); });
