import { ROADMAP_RESPONSE_SCHEMA, buildRoadmapPrompt } from '../../../ai-road-map-generator/server/roadmap-prompt.js';
import { AppError } from '../utils/errors.js';
import { geminiLatencyConfig, logGeminiRequestFailure } from './gemini-config.js';

const MAX_OUTPUT_TOKENS = 3600;
const REQUEST_TIMEOUT_MS = 45_000;

function inputText(value, field, { required = false, max = 1200 } = {}) {
  if (typeof value !== 'string' || value.length > max || (required && value.trim().length < 3)) throw new AppError(`${field} must be ${required ? 'at least 3' : 'at most'} characters${required ? ` and no more than ${max}` : ` or fewer`}.`, 400, 'INVALID_ROADMAP_REQUEST');
  return value.trim();
}

export function validateRoadmapRequest(body = {}) {
  const goal = inputText(body.goal, 'Goal', { required: true, max: 500 });
  const durationMonths = Number(body.durationMonths);
  const hoursPerWeek = Number(body.hoursPerWeek);
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 36) throw new AppError('Choose a roadmap duration from 1 to 36 months.', 400, 'INVALID_ROADMAP_DURATION');
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek < 1 || hoursPerWeek > 80) throw new AppError('Available time must be between 1 and 80 hours per week.', 400, 'INVALID_ROADMAP_HOURS');
  return {
    goal,
    durationMonths,
    hoursPerWeek,
    currentStage: inputText(body.currentStage ?? '', 'Current stage', { max: 500 }),
    background: inputText(body.background ?? '', 'Background', { max: 1200 }),
    constraints: inputText(body.constraints ?? '', 'Constraints', { max: 1200 }),
  };
}

function text(value, name, max = 700, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new AppError(`Gemini returned an invalid roadmap: ${name} was missing or too long.`, 502, 'ROADMAP_INVALID_RESPONSE');
  return value.trim();
}

export function validateRoadmap(value, durationMonths) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['title', 'overview', 'milestones', 'weeklyRhythm', 'successChecks'].includes(key))) throw new AppError('Gemini returned an invalid roadmap structure.', 502, 'ROADMAP_INVALID_RESPONSE');
  if (!Array.isArray(value.milestones) || !value.milestones.length || value.milestones.length > Math.min(durationMonths, 12)) throw new AppError('Gemini returned an invalid roadmap: milestone count did not match the requested duration.', 502, 'ROADMAP_INVALID_RESPONSE');
  let priorMonth = 0;
  const milestones = value.milestones.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['month', 'phase', 'focus', 'outcome', 'tasks', 'deliverable'].includes(key)) || !Number.isInteger(item.month) || item.month <= priorMonth || item.month > durationMonths) throw new AppError('Gemini returned an invalid roadmap: milestone months must be unique, ascending, and within the plan.', 502, 'ROADMAP_INVALID_RESPONSE');
    priorMonth = item.month;
    if (!Array.isArray(item.tasks) || item.tasks.length < 2 || item.tasks.length > 5) throw new AppError(`Gemini returned an invalid roadmap: milestone ${index + 1} needs two to five tasks.`, 502, 'ROADMAP_INVALID_RESPONSE');
    return {
      month: item.month,
      phase: text(item.phase, `milestones[${index}].phase`, 120),
      focus: text(item.focus, `milestones[${index}].focus`, 200),
      outcome: text(item.outcome, `milestones[${index}].outcome`, 500),
      tasks: item.tasks.map((task, taskIndex) => text(task, `milestones[${index}].tasks[${taskIndex}]`, 300)),
      deliverable: text(item.deliverable, `milestones[${index}].deliverable`, 300),
    };
  });
  if (!Array.isArray(value.weeklyRhythm) || value.weeklyRhythm.length < 2 || value.weeklyRhythm.length > 5 || !Array.isArray(value.successChecks) || value.successChecks.length < 2 || value.successChecks.length > 5) throw new AppError('Gemini returned an invalid roadmap: weekly rhythm or success checks were missing.', 502, 'ROADMAP_INVALID_RESPONSE');
  return {
    title: text(value.title, 'title', 160),
    overview: text(value.overview, 'overview', 700, 10),
    milestones,
    weeklyRhythm: value.weeklyRhythm.map((item, index) => text(item, `weeklyRhythm[${index}]`, 220)),
    successChecks: value.successChecks.map((item, index) => text(item, `successChecks[${index}]`, 220)),
  };
}

function friendlyApiError(error) {
  const status = Number(error?.status ?? error?.statusCode);
  const summary = `${error?.code ?? ''} ${error?.message ?? ''}`.toUpperCase();
  if (status === 429 || /RESOURCE_EXHAUSTED|QUOTA|RATE.?LIMIT/.test(summary)) return new AppError('Gemini usage quota or rate limit was reached. Wait and try again, or check the Google AI Studio quota for this API key.', 429, 'GEMINI_RATE_LIMIT');
  if (status === 401 || status === 403) return new AppError('Gemini rejected this API key or model access. Check GEMINI_API_KEY and GEMINI_MODEL.', 502, 'GEMINI_ACCESS_DENIED');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|timed out/i.test(error?.message ?? '')) return new AppError('Roadmap generation timed out. Shorten the context or try again.', 504, 'GEMINI_TIMEOUT');
  if (status >= 500) return new AppError('Google Gemini is temporarily unavailable. Try generating the roadmap again shortly.', 502, 'GEMINI_UNAVAILABLE');
  return new AppError('Gemini could not create this roadmap. Check the API key, model, network, and quota.', 502, 'GEMINI_UNAVAILABLE');
}

export async function generateRoadmap(body, dependencies = {}) {
  const input = validateRoadmapRequest(body);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AppError('The roadmap generator cannot access Gemini because GEMINI_API_KEY is missing from this server environment. On Vercel, add it in Project Settings → Environment Variables for Production, then redeploy; a local .env file is not deployed.', 503, 'GEMINI_NOT_CONFIGURED');
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
  try {
    const ai = dependencies.createClient ? await dependencies.createClient(apiKey) : new (await import('@google/genai')).GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: buildRoadmapPrompt(input),
      config: {
        responseMimeType: 'application/json',
        responseSchema: ROADMAP_RESPONSE_SCHEMA,
        ...geminiLatencyConfig(model),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        httpOptions: { timeout: REQUEST_TIMEOUT_MS - 5000, retryOptions: { attempts: 1 } },
      },
    });
    if (typeof response?.text !== 'string' || !response.text.trim()) throw new AppError('Gemini returned an empty roadmap.', 502, 'ROADMAP_INVALID_RESPONSE');
    let parsed;
    try { parsed = JSON.parse(response.text); } catch { throw new AppError('Gemini returned invalid JSON for the roadmap.', 502, 'ROADMAP_INVALID_RESPONSE'); }
    return { roadmap: validateRoadmap(parsed, input.durationMonths), model };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logGeminiRequestFailure('roadmap', error);
    throw friendlyApiError(error);
  }
}
