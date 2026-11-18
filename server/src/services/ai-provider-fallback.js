import { AppError } from '../utils/errors.js';

export const DEFAULT_AI_PROVIDER_ORDER = ['opencode', 'openrouter', 'gemini'];
const KNOWN_PROVIDERS = ['opencode', 'openrouter', 'gemini'];

const providerNames = {
  opencode: 'OpenCode',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
};

export function getAiProviderOrder() {
  const configured = process.env.AI_PROVIDER_ORDER?.trim();
  if (!configured) return [...DEFAULT_AI_PROVIDER_ORDER];

  const order = configured.split(',').map((provider) => provider.trim().toLowerCase()).filter(Boolean);
  if (!order.length || new Set(order).size !== order.length || order.some((provider) => !KNOWN_PROVIDERS.includes(provider))) {
    throw new AppError('AI_PROVIDER_ORDER must list opencode, openrouter, and/or gemini once each, separated by commas.', 503, 'AI_PROVIDER_ORDER_INVALID');
  }
  return order;
}

export function isAiProviderConfigured(provider) {
  if (provider === 'opencode') return Boolean(process.env.OPENCODE_API_KEY?.trim());
  if (provider === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY?.trim());
  if (provider === 'gemini') return Boolean(process.env.GEMINI_API_KEY?.trim());
  return false;
}

export function configuredAiProviders() {
  return getAiProviderOrder().filter(isAiProviderConfigured);
}

export async function runAiWithFallback(task, providers) {
  const order = configuredAiProviders().filter((provider) => typeof providers[provider] === 'function');
  if (!order.length) {
    throw new AppError('No AI provider is configured. Set OPENCODE_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY on the server.', 503, 'AI_NOT_CONFIGURED');
  }

  const failures = [];
  for (const provider of order) {
    try {
      const result = await providers[provider]();
      return {
        ...result,
        provider,
        fallbackUsed: failures.length > 0,
        warnings: failures.length
          ? [`${providerNames[failures[0].provider] || failures[0].provider} did not respond; ${providerNames[provider] || provider} provided the result.`]
          : [],
      };
    } catch (error) {
      failures.push({ provider, error });
      if (order.length > failures.length) {
        const status = Number(error?.status ?? error?.statusCode);
        console.warn(`[ai-fallback:${task}] ${provider} failed; trying the next provider`, {
          name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
          status: Number.isFinite(status) ? status : null,
          code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
        });
      }
    }
  }

  if (failures.length === 1) throw failures[0].error;
  const details = failures.map(({ provider, error }) => `${providerNames[provider] || provider}: ${error?.message || 'request failed'}`).join(' ');
  throw new AppError(`${task} failed with all configured AI providers. ${details}`, 502, 'AI_PROVIDERS_FAILED');
}

export function parseAiJson(text, task, provider) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AppError(`${provider} returned an empty ${task.toLowerCase()}.`, 502, 'AI_INVALID_RESPONSE');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(`${provider} returned invalid JSON for the ${task.toLowerCase()}.`, 502, 'AI_INVALID_RESPONSE');
  }
}

export function responseWasTruncated(finishReason) {
  return ['length', 'max_tokens', 'max_tokens_reached'].includes(String(finishReason ?? '').toLowerCase());
}
