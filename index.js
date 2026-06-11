require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

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

async function forwardToClaudeAsync(userMessage, systemOverride) {
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
  const system = systemOverride || process.env.CLAUDE_SYSTEM_PROMPT || 'You are an assistant that analyzes GitHub webhook events.';

  const messages = [{ role: 'user', content: userMessage }];

  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      messages,
    });

    const text = message.content.find(b => b.type === 'text')?.text ?? '';
    console.log(`\n--- Claude response ---\n${text}`);
    return text;
  } catch (err) {
    console.error('Claude call failed:', err.message);
    return null;
  }
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
    const userMessage = `A GitHub issue was opened by @${user.login}.\n\nTitle: ${title}\n\n${body || '(no body)'}`;
    const system = 'You are a helpful assistant. Answer the question or address the request in the GitHub issue. Be concise and direct.';
    (async () => {
      const response = await forwardToClaudeAsync(userMessage, system);
      if (response) {
        await postGitHubComment(repoFullName, issueNumber, response);
      }
    })();
  } else {
    forwardToClaudeAsync(`GitHub Event: ${event}\n\n${JSON.stringify(payload, null, 2)}`);
  }

  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
