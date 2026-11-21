import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';

/**
 * #1531 T01 （， loopback，）：
 * 「」≠「」。
 * -  fetch（undici  dispatcher） HTTP_PROXY/NO_PROXY；
 * - --use-env-proxy（Node 24 ）；
 * -  env ：planFetch  fetch ；
 * - undici  env-proxy ： CONNECT ，NO_PROXY 。
 */

let target: http.Server, proxy: http.Server;
let targetUrl = '', proxyUrl = '';
let proxyHits = 0, connectHits = 0;

beforeAll(async () => {
  target = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ via: 'direct', url: req.url }));
  });
  proxy = http.createServer((req, res) => {
    proxyHits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ via: 'proxy', url: req.url }));
  });
  // undici's env ProxyAgent tunnels every scheme through CONNECT.
  proxy.on('connect', (req, client, head) => {
    connectHits++;
    const [host, port] = String(req.url).split(':');
    const upstream = net.connect(Number(port), host);
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.once('error', () => client.destroy());
    client.once('error', () => upstream.destroy());
  });
  await Promise.all([
    new Promise<void>(r => target.listen(0, '127.0.0.1', r)),
    new Promise<void>(r => proxy.listen(0, '127.0.0.1', r)),
  ]);
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/probe`;
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>(r => target.close(() => r())),
    new Promise<void>(r => proxy.close(() => r())),
  ]);
});

function probe(env: NodeJS.ProcessEnv, args: string[] = []): Promise<{ code: number | null; out: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, [...args, '--input-type=module', '-e',
      `const r = await fetch(${JSON.stringify(targetUrl)}); const j = await r.json(); console.log(j.via);`],
      { env, timeout: 15000 });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.on('exit', code => done({ code, out: out.trim() }));
  });
}

describe('network proxy inventory — env honored vs copied', () => {
  it('global fetch ignores HTTP_PROXY (undici default dispatcher)', async () => {
    const hitsBefore = proxyHits + connectHits;
    const res = await fetch(targetUrl);
    const body = await res.json() as { via: string };
    expect(body.via).toBe('direct');
    expect(proxyHits + connectHits).toBe(hitsBefore);
  });

  it('child with copied proxy env still goes direct (copy != honored)', async () => {
    const r = await probe({ ...process.env, HTTP_PROXY: proxyUrl, http_proxy: proxyUrl });
    expect(r.code).toBe(0);
    expect(r.out).toBe('direct');
  });

  it('--use-env-proxy makes the same fetch cross the proxy (CONNECT tunnel)', async () => {
    const r = await probe({ ...process.env, HTTP_PROXY: proxyUrl }, ['--use-env-proxy']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('direct'); // tunneled to target returns its own payload
    expect(connectHits).toBeGreaterThan(0); // the CONNECT hop proves it crossed the proxy
  });

  it('NO_PROXY keeps loopback direct even under --use-env-proxy', async () => {
    const before = connectHits;
    const r = await probe({ ...process.env, HTTP_PROXY: proxyUrl, NO_PROXY: '127.0.0.1' }, ['--use-env-proxy']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('direct');
    expect(connectHits).toBe(before);
  });
});
