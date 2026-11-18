import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiPayload, mapGeminiError, requestGemini } from '../src/services/gemini-client.js';
import { getAiProviderOrder, runAiWithFallback } from '../src/services/ai-provider-fallback.js';

const envNames = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'AI_PROVIDER_ORDER'];
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

function restoreEnv() {
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}

const schema = {
  type: 'OBJECT',
  properties: { answer: { type: 'STRING' } },
  required: ['answer'],
};

test('builds Gemini structured-output payloads with system instructions and native PDF data', () => {
  const payload = buildGeminiPayload({
    model: 'gemini-3.5-flash-lite',
    messages: [
      { role: 'system', content: 'Return JSON only.' },
      { role: 'user', content: [
        { type: 'text', text: 'Review this file.' },
        { type: 'file', file: { filename: 'resume.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } },
      ] },
    ],
    schema,
    maxTokens: 400,
  });

  assert.deepEqual(payload.systemInstruction, { parts: [{ text: 'Return JSON only.' }] });
  assert.deepEqual(payload.contents[0].parts[1], { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0=' } });
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.equal(payload.generationConfig.responseSchema.type, 'OBJECT');
  assert.equal(payload.generationConfig.maxOutputTokens, 400);
  assert.deepEqual(payload.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
});

test('sends Gemini requests with the API key header and parses structured responses', async (t) => {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  t.after(restoreEnv);
  let request;
  const result = await requestGemini({
    messages: [{ role: 'user', content: 'Return a short JSON response.' }],
    schema,
    maxTokens: 200,
    timeoutMs: 5000,
  }, {
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{"answer":"ready"}' }] }, finishReason: 'STOP' }] }),
      };
    },
  });
  assert.match(request.url, /gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(request.options.headers['x-goog-api-key'], 'test-gemini-key');
  assert.equal(JSON.parse(request.options.body).generationConfig.responseMimeType, 'application/json');
  assert.equal(result.text, '{"answer":"ready"}');
  assert.equal(result.finishReason, 'STOP');
});

test('maps Gemini quota failures into safe provider errors', () => {
  const error = mapGeminiError(Object.assign(new Error('quota'), { status: 429 }), 'CV analysis');
  assert.equal(error.code, 'GEMINI_RATE_LIMIT');
  assert.match(error.message, /free-tier quota/);
  const invalidKey = mapGeminiError(Object.assign(new Error('API key not valid'), { status: 400 }), 'CV analysis');
  assert.equal(invalidKey.code, 'GEMINI_ACCESS_DENIED');
});

test('uses configured provider order for automatic fallback', async (t) => {
  process.env.AI_PROVIDER_ORDER = 'gemini,openrouter';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  t.after(restoreEnv);
  const calls = [];
  const result = await runAiWithFallback('test task', {
    gemini: async () => { calls.push('gemini'); return { model: 'gemini-test' }; },
    openrouter: async () => { calls.push('openrouter'); return { model: 'openrouter-test' }; },
  });
  assert.deepEqual(getAiProviderOrder(), ['gemini', 'openrouter']);
  assert.deepEqual(calls, ['gemini']);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.fallbackUsed, false);
});

test('returns a clear error when no provider has a configured key', async (t) => {
  delete process.env.OPENCODE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.AI_PROVIDER_ORDER = 'opencode,openrouter,gemini';
  t.after(restoreEnv);
  await assert.rejects(runAiWithFallback('CV review', { opencode: async () => {}, openrouter: async () => {}, gemini: async () => {} }), {
    code: 'AI_NOT_CONFIGURED',
    message: /OPENCODE_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY/,
  });
});
