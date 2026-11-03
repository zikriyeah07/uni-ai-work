import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCv, validateCvAnalysis, validateCvRequest } from '../src/services/cv-analysis.service.js';
import { generateRoadmap, validateRoadmap, validateRoadmapRequest } from '../src/services/roadmap.service.js';

const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.OPENROUTER_MODEL;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalGeminiModel = process.env.GEMINI_MODEL;
const originalProviderOrder = process.env.AI_PROVIDER_ORDER;
function restoreEnv() {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = originalModel;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalGeminiModel;
  if (originalProviderOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
  else process.env.AI_PROVIDER_ORDER = originalProviderOrder;
}
function useOpenRouterOnly() {
  process.env.AI_PROVIDER_ORDER = 'openrouter,gemini';
  delete process.env.GEMINI_API_KEY;
}

function cvResult(overrides = {}) {
  return {
    score: 76,
    summary: 'The CV communicates relevant experience and has room for stronger evidence.',
    strengths: ['The project section gives concrete examples of applied work.'],
    improvements: [{
      title: 'Quantify project impact', priority: 'High', evidence: 'Built a REST API',
      whyItMatters: 'Specific outcomes help a reviewer understand the scale of your contribution.',
      suggestion: 'Add a truthful result or describe the users and use case for this API.',
    }],
    nextSteps: ['Review each project bullet for a clear action and result.'],
    ...overrides,
  };
}

function fakeOpenRouter(output, inspect = () => {}) {
  return async (request) => {
    inspect(request);
    return { text: JSON.stringify(output), model: 'openrouter/free', annotations: [], finishReason: 'stop' };
  };
}

test('validates uploaded CV content and rejects invalid types and malformed base64', () => {
  const pdf = Buffer.from('%PDF-1.7\nresume').toString('base64');
  assert.equal(validateCvRequest({ fileName: 'cv.pdf', mimeType: 'application/pdf', base64: pdf }).mimeType, 'application/pdf');
  assert.throws(() => validateCvRequest({ fileName: 'cv.pdf', mimeType: 'application/pdf', base64: '%%%bad' }), { code: 'INVALID_CV_SIZE' });
  assert.throws(() => validateCvRequest({ fileName: 'cv.pdf', mimeType: 'application/pdf', base64: Buffer.from('not pdf').toString('base64') }), { code: 'INVALID_CV_FILE' });
  assert.throws(() => validateCvRequest({ fileName: 'cv.docx', mimeType: 'application/pdf', base64: pdf }), { code: 'INVALID_CV_FILE' });
});

test('analyzes a PDF through OpenRouter and validates the returned assessment', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_MODEL = 'openrouter/free';
  t.after(restoreEnv);
  let request;
  const pdfBase64 = Buffer.from('%PDF-1.7\nresume').toString('base64');
  const result = await analyzeCv({ fileName: 'resume.pdf', mimeType: 'application/pdf', base64: pdfBase64, targetRole: 'Frontend developer' }, {
    requestOpenRouter: fakeOpenRouter(cvResult(), (payload) => { request = payload; }),
  });
  assert.equal(result.model, 'openrouter/free');
  assert.equal(result.analysis.score, 76);
  assert.equal(result.analysis.improvements[0].priority, 'High');
  assert.equal(request.schemaName, 'cv_review');
  assert.equal(request.maxTokens, 3200);
  assert.equal(request.plugins[0].pdf.engine, 'cloudflare-ai');
  assert.equal(request.messages[0].content[1].type, 'file');
  assert.match(request.messages[0].content[0].text, /Frontend developer/);
});

test('checks text CV evidence against the actual uploaded content', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  t.after(restoreEnv);
  const text = 'Built a REST API for coursework and documented endpoints for a student project.';
  const base64 = Buffer.from(text).toString('base64');
  const output = cvResult();
  const result = await analyzeCv({ fileName: 'resume.txt', mimeType: 'text/plain', base64 }, { requestOpenRouter: fakeOpenRouter(output) });
  assert.equal(result.analysis.improvements[0].evidence, 'Built a REST API');
  await assert.rejects(analyzeCv({ fileName: 'resume.txt', mimeType: 'text/plain', base64 }, {
    requestOpenRouter: fakeOpenRouter(cvResult({ improvements: [{ ...output.improvements[0], evidence: 'Managed a team of 20 people' }] })),
  }), { code: 'CV_INVALID_RESPONSE', message: /does not appear/ });
});

test('rejects invalid CV score and maps OpenRouter limit and timeout failures', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  t.after(restoreEnv);
  assert.throws(() => validateCvAnalysis(cvResult({ score: 101 })), { code: 'CV_INVALID_RESPONSE' });
  const pdf = Buffer.from('%PDF-1.7\nresume').toString('base64');
  const input = { fileName: 'resume.pdf', mimeType: 'application/pdf', base64: pdf };
  await assert.rejects(analyzeCv(input, { requestOpenRouter: async () => { throw Object.assign(new Error('rate limit'), { status: 429 }); } }), { code: 'OPENROUTER_RATE_LIMIT' });
  await assert.rejects(analyzeCv(input, { requestOpenRouter: async () => { throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' }); } }), { code: 'OPENROUTER_TIMEOUT' });
});

test('falls back to Gemini when OpenRouter is unavailable for a CV review', async (t) => {
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.AI_PROVIDER_ORDER = 'openrouter,gemini';
  t.after(restoreEnv);
  const calls = [];
  const text = 'Built a REST API for coursework and documented endpoints for a student project.';
  const result = await analyzeCv({ fileName: 'resume.txt', mimeType: 'text/plain', base64: Buffer.from(text).toString('base64') }, {
    requestOpenRouter: async () => { calls.push('openrouter'); throw Object.assign(new Error('rate limit'), { status: 429 }); },
    requestGemini: async (request) => {
      calls.push('gemini');
      assert.equal(request.schemaName, 'cv_review');
      return { text: JSON.stringify(cvResult()), model: 'gemini-3.5-flash-lite', finishReason: 'STOP' };
    },
  });
  assert.deepEqual(calls, ['openrouter', 'gemini']);
  assert.equal(result.analysis.score, 76);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.fallbackUsed, true);
  assert.match(result.warnings[0], /OpenRouter did not respond/);
});

const roadmapOutput = {
  title: 'Prepare for a junior frontend role',
  overview: 'Build the foundations, create evidence of your work, and prepare a focused application process.',
  milestones: [
    { month: 1, phase: 'Strengthen foundations', focus: 'HTML, CSS, and JavaScript practice', outcome: 'Core concepts are practiced through small builds.', tasks: ['Complete structured lessons for fundamentals.', 'Build a responsive page from a design reference.'], deliverable: 'A responsive page with a short project README.' },
    { month: 3, phase: 'Create portfolio evidence', focus: 'Build and explain projects', outcome: 'Two projects demonstrate the skills requested in target roles.', tasks: ['Build a data-driven interface.', 'Write a concise case study for each project.'], deliverable: 'Two deployed projects with documented decisions.' },
  ],
  weeklyRhythm: ['Reserve two focused sessions for practice.', 'Review progress and adjust the next week.'],
  successChecks: ['Projects run and can be demonstrated.', 'Applications describe relevant evidence clearly.'],
};

test('validates roadmap input and enforces bounded ordered milestones', () => {
  assert.deepEqual(validateRoadmapRequest({ goal: 'Learn front-end development', durationMonths: 6, hoursPerWeek: 5 }).durationMonths, 6);
  assert.throws(() => validateRoadmapRequest({ goal: 'Learn frontend development', durationMonths: 40, hoursPerWeek: 5 }), { code: 'INVALID_ROADMAP_DURATION' });
  assert.equal(validateRoadmap(roadmapOutput, 6).milestones.length, 2);
  assert.throws(() => validateRoadmap({ ...roadmapOutput, milestones: [roadmapOutput.milestones[1], roadmapOutput.milestones[0]] }, 6), { code: 'ROADMAP_INVALID_RESPONSE', message: /ascending/ });
});

test('generates a roadmap through the configured OpenRouter model and handles free-model limits', async (t) => {
  useOpenRouterOnly();
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_MODEL = 'openrouter/free';
  t.after(restoreEnv);
  let request;
  const result = await generateRoadmap({ goal: 'Prepare for a junior frontend role', durationMonths: 6, hoursPerWeek: 5 }, {
    requestOpenRouter: fakeOpenRouter(roadmapOutput, (payload) => { request = payload; }),
  });
  assert.equal(result.model, 'openrouter/free');
  assert.equal(result.roadmap.milestones[1].month, 3);
  assert.equal(request.schemaName, 'learning_roadmap');
  assert.equal(request.maxTokens, 4500);
  assert.match(request.messages[0].content, /availableHoursPerWeek/);
  await assert.rejects(generateRoadmap({ goal: 'Learn front-end development', durationMonths: 6, hoursPerWeek: 5 }, {
    requestOpenRouter: async () => { throw Object.assign(new Error('rate limit'), { status: 429 }); },
  }), { code: 'OPENROUTER_RATE_LIMIT' });
});

test('falls back to Gemini when OpenRouter is unavailable for roadmap generation', async (t) => {
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.AI_PROVIDER_ORDER = 'openrouter,gemini';
  t.after(restoreEnv);
  const calls = [];
  const result = await generateRoadmap({ goal: 'Prepare for a junior frontend role', durationMonths: 6, hoursPerWeek: 5 }, {
    requestOpenRouter: async () => { calls.push('openrouter'); throw Object.assign(new Error('provider unavailable'), { status: 503 }); },
    requestGemini: async () => {
      calls.push('gemini');
      return { text: JSON.stringify(roadmapOutput), model: 'gemini-3.5-flash-lite', finishReason: 'STOP' };
    },
  });
  assert.deepEqual(calls, ['openrouter', 'gemini']);
  assert.equal(result.roadmap.milestones.length, 2);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.fallbackUsed, true);
});
