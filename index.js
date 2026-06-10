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
});

async function forwardToClaudeAsync(event, payload) {
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
  const system = process.env.CLAUDE_SYSTEM_PROMPT || 'You are an assistant that analyzes GitHub webhook events.';

  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: 'user',
          content: `GitHub Event: ${event}\n\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    });

    const text = message.content.find(b => b.type === 'text')?.text ?? '';
    console.log(`\n--- Claude response ---\n${text}`);
  } catch (err) {
    console.error('Claude call failed:', err.message);
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

  forwardToClaudeAsync(event, payload);

  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
