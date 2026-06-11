require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.WEBHOOK_SECRET || '';

const CLAUDE_ENDPOINT = process.env.CLAUDE_ENDPOINT || '';
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  ...(CLAUDE_ENDPOINT ? { baseURL: CLAUDE_ENDPOINT } : {}),
  ...(CLAUDE_ENDPOINT ? {
    defaultHeaders: {
      'api-key': process.env.ANTHROPIC_API_KEY || '',
    },
    ...(process.env.CLAUDE_API_VERSION ? {
      defaultQuery: { 'api-version': process.env.CLAUDE_API_VERSION },
    } : {}),
  } : {}),
});

const DOCSTACK_SYSTEM_PROMPT = `You are a documentation assistant for the dynatrace-docs repository, which uses Docstack as its documentation framework.

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

// MCP clients are initialised once at startup and reused across all requests.
// toolRouter maps tool name → the MCP client that handles it.
let claudeTools = [];
const toolRouter = new Map();

async function connectMcp(name, scriptFile) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, scriptFile)]
  });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  for (const t of tools) {
    claudeTools.push({ name: t.name, description: t.description, input_schema: t.inputSchema });
    toolRouter.set(t.name, client);
  }
  console.log(`[${name}] tools ready:`, tools.map(t => t.name).join(', '));
}

async function initMcp() {
  await Promise.all([
    connectMcp('docstack-client', 'docstack-mcp.js'),
    connectMcp('dynatrace-docs-client', 'dynatrace-docs-mcp.js'),
  ]);
}

async function askDocstack(userMessage) {
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
  const messages = [{ role: 'user', content: userMessage }];

  try {
    while (true) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: DOCSTACK_SYSTEM_PROMPT,
        tools: claudeTools,
        messages,
      });

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const text = response.content.find(b => b.type === 'text')?.text ?? '';
        console.log(`\n--- Claude response ---\n${text}`);
        return text;
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          console.log(`[Tool call] ${block.name}`, JSON.stringify(block.input));
          const client = toolRouter.get(block.name);
          const result = await client.callTool({ name: block.name, arguments: block.input });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.content });
        }
        messages.push({ role: 'user', content: toolResults });
      } else {
        break;
      }
    }
  } catch (err) {
    console.error('Claude call failed:', err.message);
  }
  return null;
}

async function postGitHubComment(repoFullName, issueNumber, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not set — cannot post comment');
    return;
  }
  const url = `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to post GitHub comment (${res.status}): ${text}`);
  } else {
    console.log(`Comment posted to ${repoFullName}#${issueNumber}`);
  }
}

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (SECRET) {
    const sig = req.headers['x-hub-signature-256'];
    const digest = 'sha256=' + crypto.createHmac('sha256', SECRET).update(req.body).digest('hex');
    if (sig !== digest) {
      console.log('Invalid signature — request rejected');
      return res.status(401).send('Unauthorized');
    }
  }

  const event = req.headers['x-github-event'];
  const payload = JSON.parse(req.body);

  console.log(`\n--- GitHub Event: ${event} / action: ${payload.action} ---`);
  console.log(JSON.stringify(payload, null, 2));

  if (event === 'issues' && payload.action === 'opened') {
    const repoFullName = payload.repository.full_name;
    const issueNumber = payload.issue.number;
    const { title, body, user } = payload.issue;
    const userMessage = `GitHub issue opened by @${user.login}.\n\nTitle: ${title}\n\n${body || '(no body)'}`;
    (async () => {
      const response = await askDocstack(userMessage);
      if (response) {
        await postGitHubComment(repoFullName, issueNumber, response);
      }
    })();
  }

  res.status(200).send('OK');
});

initMcp()
  .then(() => app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`)))
  .catch(err => { console.error('Failed to start MCP:', err); process.exit(1); });
