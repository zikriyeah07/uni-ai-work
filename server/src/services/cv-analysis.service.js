import { CV_RESPONSE_SCHEMA, buildCvPrompt } from '../../../ai-cv-cheker/server/cv-prompt.js';
import { AppError } from '../utils/errors.js';
import { logOpenRouterFailure, mapOpenRouterError, parseOpenRouterJson, requestOpenRouter } from './openrouter-client.js';

const MAX_FILE_BYTES = 2.8 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 3200;
const REQUEST_TIMEOUT_MS = 120_000;
const priorities = new Set(['High', 'Medium', 'Low']);

function invalidResponse(detail) {
  return new AppError(`OpenRouter returned an invalid CV review: ${detail}`, 502, 'CV_INVALID_RESPONSE');
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
  if (mimeType === 'text/plain' && !fileName.toLowerCase().endsWith('.txt')) throw new AppError('Plain text CV uploads must use a .txt file.', 400, 'INVALID_CV_FILE');
  if (typeof targetRole !== 'string' || targetRole.length > 120) throw new AppError('Target role must be 120 characters or fewer.', 400, 'INVALID_CV_REQUEST');
  const text = mimeType === 'text/plain' ? bytes.toString('utf8').replace(/\0/g, '').trim() : '';
  if (mimeType === 'text/plain' && text.length < 40) throw new AppError('This text file is too short to review. Add the CV content and try again.', 400, 'CV_TOO_SHORT');
  if (text.length > 100_000) throw new AppError('Text CVs must contain 100,000 characters or fewer. Upload a PDF for longer documents.', 413, 'INVALID_CV_SIZE');
  return { fileName: fileName.trim(), mimeType, base64, bytes, text, targetRole: targetRole.trim() };
}

export function validateCvAnalysis(value, sourceText = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse('the root value must be an object.');
  const allowed = ['score', 'summary', 'strengths', 'improvements', 'nextSteps'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalidResponse('the response contained unexpected fields.');
  if (!Number.isInteger(value.score) || value.score < 0 || value.score > 100) throw invalidResponse('score must be an integer from 0 to 100.');
  if (!Array.isArray(value.strengths) || value.strengths.length > 4 || !Array.isArray(value.improvements) || value.improvements.length > 6 || !Array.isArray(value.nextSteps) || value.nextSteps.length > 4) throw invalidResponse('the response exceeded the allowed item counts.');
  const normalizedText = sourceText.toLowerCase().replace(/\s+/g, ' ');
  const improvements = value.improvements.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['title', 'priority', 'evidence', 'whyItMatters', 'suggestion'].includes(key))) throw invalidResponse(`improvements[${index}] had an unexpected shape.`);
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim() : '';
    if (evidence.length > 260 || !priorities.has(item.priority)) throw invalidResponse(`improvements[${index}] was invalid.`);
    if (normalizedText && evidence && !normalizedText.includes(evidence.toLowerCase().replace(/\s+/g, ' '))) throw invalidResponse(`improvements[${index}] cited text that does not appear in the uploaded CV.`);
    return {
      title: boundedText(item.title, `improvements[${index}].title`, 140),
      priority: item.priority,
      evidence,
      whyItMatters: boundedText(item.whyItMatters, `improvements[${index}].whyItMatters`, 600, 10),
      suggestion: boundedText(item.suggestion, `improvements[${index}].suggestion`, 800, 10),
    };
  });
  return {
    score: value.score,
    summary: boundedText(value.summary, 'summary', 600, 10),
    strengths: value.strengths.map((item, index) => boundedText(item, `strengths[${index}]`, 400, 5)),
    improvements,
    nextSteps: value.nextSteps.map((item, index) => boundedText(item, `nextSteps[${index}]`, 300, 5)),
  };
}

export async function analyzeCv(body, dependencies = {}) {
  const request = validateCvRequest(body);
  try {
    const prompt = buildCvPrompt({ fileName: request.fileName, targetRole: request.targetRole });
    const pdf = request.mimeType === 'application/pdf';
    const content = pdf
      ? [
        { type: 'text', text: prompt },
        { type: 'file', file: { filename: request.fileName, file_data: `data:application/pdf;base64,${request.base64}` } },
      ]
      : `${prompt}\n\nBEGIN CV DOCUMENT (untrusted content):\n${request.text}\nEND CV DOCUMENT`;
    const response = await (dependencies.requestOpenRouter ?? requestOpenRouter)({
      messages: [{ role: 'user', content }],
      schemaName: 'cv_review',
      schema: CV_RESPONSE_SCHEMA,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      ...(pdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
    }, dependencies);
    if (response.finishReason === 'length') throw invalidResponse('the response was cut off before it finished.');
    const parsed = parseOpenRouterJson(response.text, 'CV review');
    const extractedPdfText = (response.annotations ?? [])
      .flatMap((annotation) => annotation?.type === 'file' && Array.isArray(annotation.file?.content) ? annotation.file.content : [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
    return { analysis: validateCvAnalysis(parsed, request.text || extractedPdfText), model: response.model };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logOpenRouterFailure('cv', error);
    throw mapOpenRouterError(error, 'CV analysis');
  }
}
