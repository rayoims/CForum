/**
     * Cloudflare Pages Functions - API Proxy to Worker
     */
    
    export const onRequest: PagesFunction = async (context) => {
        const { request, env } = context;
        const url = new URL(request.url);
        const pathname = url.pathname;
    
        // 1. 解决帖子链接点击问题：将 /posts/123 或 /post/123 智能重定向到 /post?id=123
        const postMatch = pathname.match(/^\/posts?\/(\d+)$/);
        if (postMatch) {
            const redirectUrl = new URL(request.url);
            redirectUrl.pathname = '/post';
            redirectUrl.search = `?id=${postMatch[1]}`;
            return Response.redirect(redirectUrl.toString(), 302);
        }
    
        const isApiRoute = pathname.startsWith('/api/');
        const isR2Route = pathname.startsWith('/r2/');
    
        if (!isApiRoute && !isR2Route) {
            return context.next();
        }
    
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS, PUT, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Timestamp, X-Nonce',
        };
    
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
    
        try {
            const isLocalDev = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
            let workerUrl = (env.WORKER_URL as string) ||
                (isLocalDev ? 'http://localhost:8787' : 'https://cforum.adysec.workers.dev');
    
            const forwardUrl = new URL(pathname + url.search, workerUrl);
            const forwardHeaders = new Headers(request.headers);
            forwardHeaders.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
            forwardHeaders.set('X-Forwarded-Host', url.hostname);
            forwardHeaders.set('X-Original-URL', url.origin);
    
            const response = await fetch(new Request(forwardUrl.toString(), {
                method: request.method,
                headers: forwardHeaders,
                body: request.body,
                redirect: 'manual', // 关键：不要静默吞掉重定向
            }));
    
            // 2. 解决邮箱验证反馈问题：如果是 301/302 重定向，直接重定向浏览器地址栏
            if (response.status === 301 || response.status === 302) {
                const location = response.headers.get('Location');
                if (location) {
                    return Response.redirect(location, response.status);
                }
            }
    
            const headers = new Headers(response.headers);
            Object.entries(corsHeaders).forEach(([key, val]) => headers.set(key, val));
    
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
    
        } catch (error) {
            console.error('❌ API proxy error:', error);
            return Response.json(
                {
                    error: 'Failed to forward API request',
                    message: String(error),
                },
                { status: 502, headers: corsHeaders }
            );
        }
    };
