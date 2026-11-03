export function geminiLatencyConfig(model) {
  return /^gemini-3(?:\.|-)/i.test(model)
    ? { thinkingConfig: { thinkingLevel: 'low' } }
    : {};
}

export function logGeminiRequestFailure(area, error) {
  const status = Number(error?.status ?? error?.statusCode);
  console.error(`[gemini:${area}] request failed`, {
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    status: Number.isFinite(status) ? status : null,
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
  });
}
