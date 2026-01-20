// Quick test script to verify Deepseek API key works
const axios = require('axios');

const apiKey = process.env.DEEPSEEK_API_KEY;

if (!apiKey) {
  console.error('✗ DEEPSEEK_API_KEY environment variable not set');
  process.exit(1);
}

console.log(`Testing Deepseek API key: ${apiKey.substring(0, 10)}...`);

axios.post(
  'https://api.deepseek.com/v1/chat/completions',
  {
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'Say "test" only' }],
    max_tokens: 5
  },
  {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  }
)
  .then(response => {
    console.log('✓ Deepseek API key is VALID');
    console.log(`  Status: ${response.status}`);
    console.log(`  Response: ${JSON.stringify(response.data.choices[0]?.message?.content || 'No content')}`);
    process.exit(0);
  })
  .catch(error => {
    if (error.response) {
      console.error('✗ Deepseek API key test FAILED');
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Error: ${JSON.stringify(error.response.data)}`);
      if (error.response.status === 401) {
        console.error('\n  → The API key is INVALID or EXPIRED');
      } else if (error.response.status === 429) {
        console.error('\n  → Rate limit exceeded (key may be valid but quota exceeded)');
      }
    } else {
      console.error('✗ Network/Connection error:', error.message);
    }
    process.exit(1);
  });
