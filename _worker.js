addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/queshi') {
    // 构建发送给 dns.google 的请求
    const dohUrl = new URL('https://dns.google/dns-query');
    dohUrl.search = url.search; // 复制原始请求的查询参数

    const dohRequest = new Request(dohUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    // 发送请求到 dns.google 并返回响应
    return fetch(dohRequest);
  } else {
    // 如果路径不是 /dns-query，则重定向到 speed.net
    return Response.redirect('https://speed.net', 302);
  }
}
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/dns-query') {
    // 构建发送给 dns.google 的请求
    const dohUrl = new URL('https://dns.google/dns-query');
    dohUrl.search = url.search; // 复制原始请求的查询参数

    const dohRequest = new Request(dohUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    // 发送请求到 dns.google 并返回响应
    return fetch(dohRequest);
  } else {
    // 如果路径不是 /dns-query，则重定向到 speed.net
    return Response.redirect('https://speed.net', 302);
  }
}
