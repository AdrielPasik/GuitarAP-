// Runs the real-stack API gateway (Supabase-shaped single origin on :4311) for browser tests. Needs the stack up.
import { createServer } from 'node:http';
const REST = 'http://127.0.0.1:4322';
const AUTH = 'http://127.0.0.1:4321';
const server = createServer(async (request, response) => {
  const url = request.url ?? '/';
  const route = url.startsWith('/rest/v1/') ? [REST, url.slice('/rest/v1'.length)] : url.startsWith('/auth/v1/') ? [AUTH, url.slice('/auth/v1'.length)] : null;
  const cors = { 'access-control-allow-origin': request.headers.origin ?? '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };
  if (request.method === 'OPTIONS') return response.writeHead(204, cors).end();
  if (!route) return response.writeHead(404, cors).end();
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) if (value && !['host', 'connection', 'content-length'].includes(name)) headers.set(name, String(value));
  const upstream = await fetch(route[0] + route[1], { method: request.method, headers, body: chunks.length && !['GET', 'HEAD'].includes(request.method) ? Buffer.concat(chunks) : undefined }).catch(() => null);
  if (!upstream) return response.writeHead(502, cors).end();
  const out = { ...cors };
  upstream.headers.forEach((value, name) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(name)) out[name] = value; });
  response.writeHead(upstream.status, out);
  response.end(Buffer.from(await upstream.arrayBuffer()));
});
server.listen(4311, '127.0.0.1', () => console.log('real-stack gateway on http://127.0.0.1:4311'));
