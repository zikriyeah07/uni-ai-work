import { ROADMAP_RESPONSE_SCHEMA, buildRoadmapPrompt } from '../../../ai-road-map-generator/server/roadmap-prompt.js';
import { AppError } from '../utils/errors.js';
import { logOpenRouterFailure, mapOpenRouterError, requestOpenRouter } from './openrouter-client.js';
import { logGeminiFailure, mapGeminiError, requestGemini } from './gemini-client.js';
import { parseAiJson, responseWasTruncated, runAiWithFallback } from './ai-provider-fallback.js';

const MAX_OUTPUT_TOKENS = 4500;
const REQUEST_TIMEOUT_MS = 70_000;

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
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new AppError(`The AI provider returned an invalid roadmap: ${name} was missing or too long.`, 502, 'ROADMAP_INVALID_RESPONSE');
  return value.trim();
}

export function validateRoadmap(value, durationMonths) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['title', 'overview', 'milestones', 'weeklyRhythm', 'successChecks'].includes(key))) throw new AppError('The AI provider returned an invalid roadmap structure.', 502, 'ROADMAP_INVALID_RESPONSE');
  if (!Array.isArray(value.milestones) || !value.milestones.length || value.milestones.length > Math.min(durationMonths, 12)) throw new AppError('The AI provider returned an invalid roadmap: milestone count did not match the requested duration.', 502, 'ROADMAP_INVALID_RESPONSE');
  let priorMonth = 0;
  const milestones = value.milestones.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['month', 'phase', 'focus', 'outcome', 'tasks', 'deliverable'].includes(key)) || !Number.isInteger(item.month) || item.month <= priorMonth || item.month > durationMonths) throw new AppError('The AI provider returned an invalid roadmap: milestone months must be unique, ascending, and within the plan.', 502, 'ROADMAP_INVALID_RESPONSE');
    priorMonth = item.month;
    if (!Array.isArray(item.tasks) || item.tasks.length < 2 || item.tasks.length > 5) throw new AppError(`The AI provider returned an invalid roadmap: milestone ${index + 1} needs two to five tasks.`, 502, 'ROADMAP_INVALID_RESPONSE');
    return {
      month: item.month,
      phase: text(item.phase, `milestones[${index}].phase`, 120),
      focus: text(item.focus, `milestones[${index}].focus`, 200),
      outcome: text(item.outcome, `milestones[${index}].outcome`, 500),
      tasks: item.tasks.map((task, taskIndex) => text(task, `milestones[${index}].tasks[${taskIndex}]`, 300)),
      deliverable: text(item.deliverable, `milestones[${index}].deliverable`, 300),
    };
  });
  if (!Array.isArray(value.weeklyRhythm) || value.weeklyRhythm.length < 2 || value.weeklyRhythm.length > 5 || !Array.isArray(value.successChecks) || value.successChecks.length < 2 || value.successChecks.length > 5) throw new AppError('The AI provider returned an invalid roadmap: weekly rhythm or success checks were missing.', 502, 'ROADMAP_INVALID_RESPONSE');
  return {
    title: text(value.title, 'title', 160),
    overview: text(value.overview, 'overview', 700, 10),
    milestones,
    weeklyRhythm: value.weeklyRhythm.map((item, index) => text(item, `weeklyRhythm[${index}]`, 220)),
    successChecks: value.successChecks.map((item, index) => text(item, `successChecks[${index}]`, 220)),
  };
}

export async function generateRoadmap(body, dependencies = {}) {
  const input = validateRoadmapRequest(body);
  const aiRequest = {
    messages: [{ role: 'user', content: buildRoadmapPrompt(input) }],
    schemaName: 'learning_roadmap',
    schema: ROADMAP_RESPONSE_SCHEMA,
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: REQUEST_TIMEOUT_MS,
  };
  const processResponse = (response, provider) => {
    if (responseWasTruncated(response.finishReason)) throw new AppError(`${provider} returned a roadmap that was cut off before it finished.`, 502, 'ROADMAP_INVALID_RESPONSE');
    const parsed = parseAiJson(response.text, 'roadmap', provider);
    return { roadmap: validateRoadmap(parsed, input.durationMonths), model: response.model };
  };
  const callProvider = async (provider) => {
    try {
      const response = provider === 'openrouter'
        ? await (dependencies.requestOpenRouter ?? requestOpenRouter)(aiRequest, dependencies)
        : await (dependencies.requestGemini ?? requestGemini)(aiRequest, dependencies);
      return processResponse(response, provider === 'openrouter' ? 'OpenRouter' : 'Gemini');
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (provider === 'openrouter') {
        logOpenRouterFailure('roadmap', error);
        throw mapOpenRouterError(error, 'Roadmap generation');
      }
      logGeminiFailure('roadmap', error);
      throw mapGeminiError(error, 'Roadmap generation');
    }
  };

  return runAiWithFallback('Roadmap generation', {
    openrouter: () => callProvider('openrouter'),
    gemini: () => callProvider('gemini'),
  });
}
