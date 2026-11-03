import axios from 'axios';
import { getSessionReport, getSessionReports, saveSessionReport } from './session-reports.js';

const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
const api = axios.create({ baseURL: apiBase, timeout: 15000 });

export function getErrorMessage(error) {
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return 'The SiteSense API did not respond in time. Check that the server is running, then try again.';
  }
  if (error?.isAxiosError && !error.response) {
    return 'Could not reach the SiteSense API. Check that the server is running, then try again.';
  }
  return error?.response?.data?.error?.message || error?.message || 'Something went wrong. Please try again.';
}

export async function getHealth() {
  const { data } = await api.get('/health');
  return data;
}

export async function getScans() {
  const scans = getSessionReports();
  return { scans, totalScans: scans.length };
}

export async function getScan(id) {
  const scan = getSessionReport(id);
  if (!scan) throw new Error('This report is no longer available in this browser session. Run another scan.');
  return scan;
}

export async function createScan(payload, onProgress = () => {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 280000);
  let reader;
  try {
    const response = await fetch(`${apiBase}/scan?stream=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      let message = '';
      if (contentType.includes('json')) {
        const body = await response.json().catch(() => ({}));
        message = body?.error?.message || body?.message || '';
      } else {
        const bodyText = await response.text().catch(() => '');
        message = bodyText
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);
      }
      if (!message && response.status === 403) {
        message = 'The API rejected the request before scanning. Confirm the API server is running on the configured port, then restart the API and Vite.';
      }
      throw new Error(message || `The scan request failed (HTTP ${response.status}).`);
    }
    if (!response.body) throw new Error('This browser could not open the scan progress stream.');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let scan = null;
    const consume = (block) => {
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) return;
      const message = JSON.parse(data.join('\n'));
      if (event === 'progress') onProgress(message);
      else if (event === 'result') scan = message.scan;
      else if (event === 'error') throw new Error(message?.error?.message || 'The scan could not be completed.');
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!scan) throw new Error('The server ended the scan stream without returning a report.');
    return saveSessionReport(scan);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The scan timed out. Try again or use a faster responding page.');
    throw error;
  } finally {
    clearTimeout(timeout);
    if (reader) await reader.cancel().catch(() => {});
  }
}
