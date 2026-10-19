import http from 'node:http';
import { BASE_URL } from './helpers';

/** Raw HTTP request: the path goes out exactly as written (fetch and Playwright would normalise `%2e%2e` and friends). */
export function raw(method: string, path: string, opts: { sid?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE_URL);
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { ...(opts.sid ? { cookie: `latex_session=${opts.sid}` } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}), ...opts.headers };
    const req = http.request({ host: u.hostname, port: u.port, method, path, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

