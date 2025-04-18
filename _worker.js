let DoH = "dns.google"; 
const jsonDoH = `https://${DoH}/resolve`; 
const dnsDoH = `https://${DoH}/dns-query`;
let dohPath = 'dns-queshi'; 

// 提取CORS头设置函数
function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
    };
}

// 提取错误响应函数
function createErrorResponse(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' }
    });
}

// 处理DNS查询的通用函数
async function queryDns(dohServer, domain, type) {
    // 构造 DoH 请求 URL
    const dohUrl = new URL(dohServer);
    dohUrl.searchParams.set("name", domain);
    dohUrl.searchParams.set("type", type);

    // 尝试多种请求头格式
    const fetchOptions = [
        // 标准 application/dns-json
        { headers: { 'Accept': 'application/dns-json' } },
        // 部分服务使用没有指定 Accept 头的请求
        { headers: {} },
        // 另一个尝试 application/json
        { headers: { 'Accept': 'application/json' } },
        // 稳妥起见，有些服务可能需要明确的用户代理
        { headers: { 'Accept': 'application/dns-json', 'User-Agent': 'Mozilla/5.0 DNS Client' } }
    ];
    let lastError = null;

    // 依次尝试不同的请求头组合
    for (const options of fetchOptions) {
        try {
            const response = await fetch(dohUrl.toString(), options);
            // 如果请求成功，解析JSON
            if (response.ok) {
                const contentType = response.headers.get('content-type') || '';
                // 检查内容类型是否兼容
                if (contentType.includes('json') || contentType.includes('dns-json')) {
                    return await response.json();
                } else {
                    // 对于非标准的响应，仍尝试进行解析
                    const textResponse = await response.text();
                    try {
                        return JSON.parse(textResponse);
                    } catch (jsonError) {
                        throw new Error(`无法解析响应为JSON: ${jsonError.message}, 响应内容: ${textResponse.substring(0, 100)}`);
                    }
                }
            }
            // 错误情况记录，继续尝试下一个选项
            const errorText = await response.text();
            lastError = new Error(`DoH 服务器返回错误 (${response.status}): ${errorText.substring(0, 200)}`);
        } catch (err) {
            // 记录错误，继续尝试下一个选项
            lastError = err;
        }
    }
    // 所有尝试都失败，抛出最后一个错误
    throw lastError || new Error("无法完成 DNS 查询");
}

// 处理本地 DoH 请求的函数 - 直接调用 DoH，而不是自身服务
async function handleLocalDohRequest(domain, type, hostname) {
    try {
        if (type === "all") {
            // 同时请求 A、AAAA 和 NS 记录
            const ipv4Promise = queryDns(dnsDoH, domain, "A");
            const ipv6Promise = queryDns(dnsDoH, domain, "AAAA");
            const nsPromise = queryDns(dnsDoH, domain, "NS");

            // 等待所有请求完成
            const [ipv4Result, ipv6Result, nsResult] = await Promise.all([ipv4Promise, ipv6Promise, nsPromise]);

            // 准备NS记录数组
            const nsRecords = [];
            // 从Answer和Authority部分收集NS记录
            if (nsResult.Answer && nsResult.Answer.length > 0) {
                nsRecords.push(...nsResult.Answer.filter(record => record.type === 2));
            }
            if (nsResult.Authority && nsResult.Authority.length > 0) {
                nsRecords.push(...nsResult.Authority.filter(record => record.type === 2 || record.type === 6));
            }

            // 合并结果
            const combinedResult = {
                Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
                TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
                RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
                RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
                AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
                CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
                Question: [...(ipv4Result.Question || []), ...(ipv6Result.Question || []), ...(nsResult.Question || [])],
                Answer: [
                   ...(ipv4Result.Answer || []),
                   ...(ipv6Result.Answer || []),
                   ...nsRecords
                ],
                ipv4: { records: ipv4Result.Answer || [] },
                ipv6: { records: ipv6Result.Answer || [] },
                ns: { records: nsRecords }
            };

            return new Response(JSON.stringify(combinedResult, null, 2), {
                headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
            });
        } else {
            // 普通的单类型查询
            const result = await queryDns(dnsDoH, domain, type);
            return new Response(JSON.stringify(result, null, 2), {
                headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
            });
        }
    } catch (err) {
        console.error("DoH 查询失败:", err);
        return new Response(JSON.stringify({ error: `DoH 查询失败: ${err.message}`, stack: err.stack }, null, 2), {
            headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' },
            status: 500
        });
    }
}

// DoH 请求处理函数
async function DOHRequest(request) {
    const { method, headers, body } = request;
    const UA = headers.get('User-Agent') || 'DoH Client';
    const url = new URL(request.url);
    const { searchParams } = url;

    try {
        // 直接访问端点的处理
        if (method === 'GET' &&!url.search) {
            // 如果是直接访问或浏览器访问，返回友好信息
            return new Response('Bad Request', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
        }

        // 根据请求方法和参数构建转发请求
        let response;
        if (method === 'GET' && searchParams.has('name')) {
            const searchDoH = searchParams.has('type')? url.search : url.search + '&type=A';
            // 处理 JSON 格式的 DoH 请求
            response = await fetch(dnsDoH + searchDoH, { headers: { 'Accept': 'application/dns-json', 'User-Agent': UA } });
            // 如果 DoHUrl 请求非成功（状态码 200），则再请求 jsonDoH
            if (!response.ok) response = await fetch(jsonDoH + searchDoH, { headers: { 'Accept': 'application/dns-json', 'User-Agent': UA } });
        } else if (method === 'GET') {
            // 处理 base64url 格式的 GET 请求
            response = await fetch(dnsDoH + url.search, { headers: { 'Accept': 'application/dns-message', 'User-Agent': UA } });
        } else if (method === 'POST') {
            // 处理 POST 请求
            response = await fetch(dnsDoH, {
                method: 'POST',
                headers: { 'Accept': 'application/dns-message', 'Content-Type': 'application/dns-message', 'User-Agent': UA },
                body: body
            });
        } else {
            // 其他不支持的请求方式
            return new Response('不支持的请求格式: DoH请求需要包含name或dns参数，或使用POST方法', {
                status: 400,
                headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
            });
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`DoH 返回错误 (${response.status}): ${errorText.substring(0, 200)}`);
        }

        // 创建一个新的响应头对象
        const responseHeaders = new Headers(response.headers);
        // 设置跨域资源共享 (CORS) 的头部信息
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', '*');

        // 检查是否为JSON格式的DoH请求，确保设置正确的Content-Type
        if (method === 'GET' && searchParams.has('name')) {
            // 对于JSON格式的DoH请求，明确设置Content-Type为application/json
            responseHeaders.set('Content-Type', 'application/json');
        }

        // 返回响应
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    } catch (error) {
        console.error("DoH 请求处理错误:", error);
        return new Response(JSON.stringify({ error: `DoH 请求处理错误: ${error.message}`, stack: error.stack }, null, 4), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

export default {
    async fetch(request) {
        // 处理 OPTIONS 预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: getCorsHeaders() });
        }

        // 处理路径
        const url = new URL(request.url);
        const path = url.pathname;
        const hostname = url.hostname;

        // 如果请求路径，则作为 DoH 服务器处理
        if (path === `/${dohPath}`) {
            return await DOHRequest(request);
        }

        // 如果请求参数中包含 domain 和 doh，则执行 DNS 解析
        if (url.searchParams.has("doh")) {
            const { domain, doh, type } = Object.fromEntries(url.searchParams.entries());
            const queryDomain = domain || url.searchParams.get("name") || "www.google.com";
            const queryDoh = doh || dnsDoH;
            const queryType = type || "all";

            // 如果使用的是当前站点，则使用 DoH 服务
            if (queryDoh.includes(url.host)) {
                return await handleLocalDohRequest(queryDomain, queryType, hostname);
            }

            try {
                // 根据请求类型进行不同的处理
                if (queryType === "all") {
                    // 同时请求 A、AAAA 和 NS 记录，使用新的查询函数
                    const ipv4Result = await queryDns(queryDoh, queryDomain, "A");
                    const ipv6Result = await queryDns(queryDoh, queryDomain, "AAAA");
                    const nsResult = await queryDns(queryDoh, queryDomain, "NS");

                    // 合并结果 - 修改Question字段处理方式以兼容不同格式
                    const combinedResult = {
                        Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
                        TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
                        RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
                        RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
                        AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
                        CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
                        Question: [],
                        Answer: [...(ipv4Result.Answer || []), ...(ipv6Result.Answer || [])],
                        ipv4: { records: ipv4Result.Answer || [] },
                        ipv6: { records: ipv6Result.Answer || [] },
                        ns: { records: [] }
                    };

                    // 正确处理Question字段，无论是对象还是数组
                    if (ipv4Result.Question) {
                        if (Array.isArray(ipv4Result.Question)) {
                            combinedResult.Question.push(...ipv4Result.Question);
                        } else {
                            combinedResult.Question.push(ipv4Result.Question);
                        }
                    }
                    if (ipv6Result.Question) {
                        if (Array.isArray(ipv6Result.Question)) {
                            combinedResult.Question.push(...ipv6Result.Question);
                        } else {
                            combinedResult.Question.push(ipv6Result.Question);
                        }
                    }
                    if (nsResult.Question) {
                        if (Array.isArray(nsResult.Question)) {
                            combinedResult.Question.push(...nsResult.Question);
                        } else {
                            combinedResult.Question.push(nsResult.Question);
                        }
                    }

                    // 处理NS记录 - 可能在Answer或Authority部分
                    const nsRecords = [];
                    // 从Answer部分收集NS记录
                    if (nsResult.Answer && nsResult.Answer.length > 0) {
                        nsResult.Answer.forEach(record => {
                            if (record.type === 2) {
                                // NS记录类型是2
                                nsRecords.push(record);
                            }
                        });
                    }
                    // 从Authority部分收集NS和SOA记录
                    if (nsResult.Authority && nsResult.Authority.length > 0) {
                        nsResult.Authority.forEach(record => {
                            if (record.type === 2 || record.type === 6) {
                                // NS=2, SOA=6
                                nsRecords.push(record);
                                // 也添加到总Answer数组
                                combinedResult.Answer.push(record);
                            }
                        });
                    }
                    // 设置NS记录集合
                    combinedResult.ns.records = nsRecords;

                    return new Response(JSON.stringify(combinedResult, null, 2), {
                        headers: { "content-type": "application/json; charset=UTF-8" }
                    });
                } else {
                    // 普通的单类型查询，使用新的查询函数
                    const result = await queryDns(queryDoh, queryDomain, queryType);
                    return new Response(JSON.stringify(result, null, 2), {
                        headers: { "content-type": "application/json; charset=UTF-8" }
                    });
                }
            } catch (err) {
                console.error("DNS 查询失败:", err);
                return new Response(JSON.stringify({ error: `DNS 查询失败: ${err.message}`, doh: queryDoh, domain: queryDomain, stack: err.stack }, null, 2), {
                    headers: { "content-type": "application/json; charset=UTF-8" },
                    status: 500
                });
            }
        }

        return new Response('Not Found.', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
    }
};
