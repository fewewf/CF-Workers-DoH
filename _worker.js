export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 支持的 DoH 服务商，可选：Google DNS 或 Cloudflare DNS
   // const DOH_UPSTREAM = 'https://cloudflare-dns.com/dns-query';
    const DOH_UPSTREAM = 'https://dns.google/dns-query';

    // 只允许 DNS-over-HTTPS 相关的请求
    if (url.pathname !== '/dns-query') {
      return new Response('Not Found', { status: 404 });
    }

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', new URL(DOH_UPSTREAM).host);

    const init = {
      method: request.method,
      headers: newHeaders,
      body: request.method === 'POST' ? await request.arrayBuffer() : null,
    };

    const upstreamUrl = DOH_UPSTREAM + (request.method === 'GET' ? url.search : '');

    const response = await fetch(upstreamUrl, init);

    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/dns-message',
        'Access-Control-Allow-Origin': '*', // 可选，允许跨域访问
      },
    });
  }
}
