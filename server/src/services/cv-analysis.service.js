import { CV_RESPONSE_SCHEMA, buildCvPrompt } from '../../../ai-cv-cheker/server/cv-prompt.js';
import { AppError } from '../utils/errors.js';
import { logOpenRouterFailure, mapOpenRouterError, requestOpenRouter } from './openrouter-client.js';
import { logGeminiFailure, mapGeminiError, requestGemini } from './gemini-client.js';
import { logOpenCodeFailure, mapOpenCodeError, requestOpenCode } from './opencode-client.js';
import { parseAiJson, responseWasTruncated, runAiWithFallback } from './ai-provider-fallback.js';

const MAX_FILE_BYTES = 2.8 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 3200;
const REQUEST_TIMEOUT_MS = 100_000;
const priorities = new Set(['High', 'Medium', 'Low']);

function invalidResponse(detail) {
  return new AppError(`The AI provider returned an invalid CV review: ${detail}`, 502, 'CV_INVALID_RESPONSE');
}

function boundedText(value, field, max = 800, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw invalidResponse(`${field} did not match the expected format.`);
  return value.trim();
}

export function validateCvRequest(body = {}) {
  const { fileName, mimeType, base64, targetRole = '' } = body;
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 180 || /[\\/\0]/.test(fileName)) {
    throw new AppError('Provide a valid CV file name.', 400, 'INVALID_CV_FILE');
  }
  if (!['application/pdf', 'text/plain'].includes(mimeType)) throw new AppError('Upload a PDF or plain text CV.', 400, 'UNSUPPORTED_CV_TYPE');
  if ((mimeType === 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) || (mimeType === 'text/plain' && !fileName.toLowerCase().endsWith('.txt'))) throw new AppError('The selected CV file extension does not match its content type.', 400, 'INVALID_CV_FILE');
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new AppError('The CV file is empty or larger than 2.8 MB.', 413, 'INVALID_CV_SIZE');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== base64) throw new AppError('The CV file is empty, invalid, or larger than 2.8 MB.', 413, 'INVALID_CV_SIZE');
  if (mimeType === 'application/pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new AppError('This file does not appear to be a valid PDF.', 400, 'INVALID_CV_FILE');
  if (typeof targetRole !== 'string' || targetRole.length > 120) throw new AppError('Target role must be 120 characters or fewer.', 400, 'INVALID_CV_REQUEST');
  const text = mimeType === 'text/plain' ? bytes.toString('utf8').replace(/\0/g, '').trim() : '';
  if (mimeType === 'text/plain' && text.length < 40) throw new AppError('This text file is too short to review. Add the CV content and try again.', 400, 'CV_TOO_SHORT');
  if (text.length > 100_000) throw new AppError('Text CVs must contain 100,000 characters or fewer. Upload a PDF for longer documents.', 413, 'INVALID_CV_SIZE');
  return { fileName: fileName.trim(), mimeType, base64, bytes, text, targetRole: targetRole.trim() };
}

export function validateCvAnalysis(value, sourceText = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse('the root value must be an object.');
  const score = Number.isInteger(value.score) ? value.score : Number.isFinite(Number(value.score)) ? Math.round(Number(value.score)) : NaN;
  if (!Number.isInteger(score) || score < 0 || score > 100) throw invalidResponse('score must be an integer from 0 to 100.');
  const strengthsIn = Array.isArray(value.strengths) ? value.strengths.slice(0, 4) : [];
  const improvementsIn = Array.isArray(value.improvements) ? value.improvements.slice(0, 6) : [];
  const nextStepsIn = Array.isArray(value.nextSteps) ? value.nextSteps.slice(0, 4) : [];
  const normalizedText = sourceText.toLowerCase().replace(/\s+/g, ' ');
  const improvements = improvementsIn.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidResponse(`improvements[${index}] had an unexpected shape.`);
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim().slice(0, 260) : '';
    const priority = priorities.has(item.priority) ? item.priority : 'Medium';
    if (normalizedText && evidence && !normalizedText.includes(evidence.toLowerCase().replace(/\s+/g, ' '))) {
      // keep improvement but drop unverifiable quote instead of failing the whole review
      return {
        title: boundedText(item.title, `improvements[${index}].title`, 140),
        priority,
        evidence: '',
        whyItMatters: boundedText(item.whyItMatters, `improvements[${index}].whyItMatters`, 600, 10),
        suggestion: boundedText(item.suggestion, `improvements[${index}].suggestion`, 800, 10),
      };
    }
    return {
      title: boundedText(item.title, `improvements[${index}].title`, 140),
      priority,
      evidence,
      whyItMatters: boundedText(item.whyItMatters, `improvements[${index}].whyItMatters`, 600, 10),
      suggestion: boundedText(item.suggestion, `improvements[${index}].suggestion`, 800, 10),
    };
  });
  return {
    score,
    summary: boundedText(value.summary, 'summary', 600, 10),
    strengths: strengthsIn.map((item, index) => boundedText(item, `strengths[${index}]`, 400, 5)),
    improvements,
    nextSteps: nextStepsIn.map((item, index) => boundedText(item, `nextSteps[${index}]`, 300, 5)),
  };
}

export async function analyzeCv(body, dependencies = {}) {
  const request = validateCvRequest(body);
  const prompt = buildCvPrompt({ fileName: request.fileName, targetRole: request.targetRole });
  const pdf = request.mimeType === 'application/pdf';
  const content = pdf
    ? [
      { type: 'text', text: prompt },
      { type: 'file', file: { filename: request.fileName, file_data: `data:application/pdf;base64,${request.base64}` } },
    ]
    : `${prompt}\n\nBEGIN CV DOCUMENT (untrusted content):\n${request.text}\nEND CV DOCUMENT`;
  const aiRequest = {
    messages: [{ role: 'user', content }],
    schemaName: 'cv_review',
    schema: CV_RESPONSE_SCHEMA,
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...(pdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
  };

  const processResponse = (response, provider) => {
    if (responseWasTruncated(response.finishReason)) throw invalidResponse('the response was cut off before it finished.');
    const parsed = parseAiJson(response.text, 'CV review', provider);
    const extractedPdfText = (response.annotations ?? [])
      .flatMap((annotation) => annotation?.type === 'file' && Array.isArray(annotation.file?.content) ? annotation.file.content : [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
    return { analysis: validateCvAnalysis(parsed, request.text || extractedPdfText), model: response.model };
  };

  const callProvider = async (provider) => {
    try {
      if (provider === 'opencode' && pdf) {
        throw new AppError('PDF CVs need OpenRouter or Gemini with this app. Upload a .txt CV, or configure another AI provider for PDF analysis.', 400, 'CV_PDF_PROVIDER_UNSUPPORTED');
      }
      const response = provider === 'openrouter'
        ? await (dependencies.requestOpenRouter ?? requestOpenRouter)(aiRequest, dependencies)
        : provider === 'opencode'
          ? await (dependencies.requestOpenCode ?? requestOpenCode)(aiRequest, dependencies)
          : await (dependencies.requestGemini ?? requestGemini)(aiRequest, dependencies);
      const label = provider === 'openrouter' ? 'OpenRouter' : provider === 'opencode' ? 'OpenCode' : 'Gemini';
      return processResponse(response, label);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (provider === 'openrouter') {
        logOpenRouterFailure('cv', error);
        throw mapOpenRouterError(error, 'CV analysis');
      }
      if (provider === 'opencode') {
        logOpenCodeFailure('cv', error);
        throw mapOpenCodeError(error, 'CV analysis');
      }
      logGeminiFailure('cv', error);
      throw mapGeminiError(error, 'CV analysis');
    }
  };

  return runAiWithFallback('CV review', {
    opencode: () => callProvider('opencode'),
    openrouter: () => callProvider('openrouter'),
    gemini: () => callProvider('gemini'),
  });
}
