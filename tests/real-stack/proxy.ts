import http from 'node:http';

/**
 * A minimal stand-in for Supabase's API gateway (Kong): one origin that routes /rest/v1/* to PostgREST and
 * /auth/v1/* to GoTrue, exactly the URL shape the app uses (`${url}/rest/v1/rpc/...`, `${url}/auth/v1/token`).
 */
export const REAL_STACK = { rest: 'http://127.0.0.1:4322', auth: 'http://127.0.0.1:4321', gateway: 4311 };

export function startGateway(port = REAL_STACK.gateway): Promise<http.Server> {
  const server = http.createServer(async (request, response) => {
    const url = request.url ?? '/';
    const route = url.startsWith('/rest/v1/') ? [REAL_STACK.rest, url.slice('/rest/v1'.length)] : url.startsWith('/auth/v1/') ? [REAL_STACK.auth, url.slice('/auth/v1'.length)] : null;
    const cors = {
      'access-control-allow-origin': request.headers.origin ?? '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': '*',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors).end();
      return;
    }
    if (!route) {
      response.writeHead(404, cors).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (value && !['host', 'connection', 'content-length'].includes(name)) headers.set(name, String(value));
    const upstream = await fetch(route[0] + route[1], { method: request.method, headers, body: chunks.length && !['GET', 'HEAD'].includes(request.method ?? '') ? Buffer.concat(chunks) : undefined }).catch(() => null);
    if (!upstream) {
      response.writeHead(502, cors).end();
      return;
    }
    const out: Record<string, string> = { ...cors };
    upstream.headers.forEach((value, name) => {
      if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(name)) out[name] = value;
    });
    response.writeHead(upstream.status, out);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
