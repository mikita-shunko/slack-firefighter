const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.WEBHOOK_SECRET || '';

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

  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
