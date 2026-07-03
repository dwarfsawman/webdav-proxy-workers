export interface Env {
	UPSTREAM: string;
	ALLOWED_ORIGINS: string;
	PROXY_USERNAME: string;
	PROXY_PASSWORD: string;
	PCLOUD_USERNAME: string;
	PCLOUD_PASSWORD: string;
}

const DAV_METHODS = 'GET, HEAD, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK';

function allowedOrigin(req: Request, env: Env): string | null {
	const origin = req.headers.get('Origin');
	if (!origin) return null;
	const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
	return allowed.includes(origin) ? origin : null;
}

function corsHeaders(req: Request, env: Env): Headers {
	const headers = new Headers();
	const origin = allowedOrigin(req, env);
	if (origin) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Vary', 'Origin');
	}
	headers.set('Access-Control-Allow-Methods', DAV_METHODS);
	const requestedHeaders = req.headers.get('Access-Control-Request-Headers');
	headers.set('Access-Control-Allow-Headers', requestedHeaders ?? 'Authorization, Content-Type, Depth, Destination, Overwrite, If, Lock-Token, Timeout, X-Requested-With');
	headers.set('Access-Control-Expose-Headers', 'ETag, DAV, Content-Length, Content-Type, Last-Modified, Content-Range, Accept-Ranges, Location');
	headers.set('Access-Control-Allow-Credentials', 'true');
	headers.set('Access-Control-Max-Age', '86400');
	return headers;
}

function timingSafeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const aBytes = enc.encode(a);
	const bBytes = enc.encode(b);
	if (aBytes.length !== bBytes.length) return false;
	let diff = 0;
	for (let i = 0; i < aBytes.length; i++) {
		diff |= aBytes[i] ^ bBytes[i];
	}
	return diff === 0;
}

function checkProxyAuth(req: Request, env: Env): boolean {
	const auth = req.headers.get('Authorization');
	if (!auth || !auth.startsWith('Basic ')) return false;
	let decoded: string;
	try {
		decoded = atob(auth.slice(6));
	} catch {
		return false;
	}
	const sep = decoded.indexOf(':');
	if (sep === -1) return false;
	const user = decoded.slice(0, sep);
	const pass = decoded.slice(sep + 1);
	return timingSafeEqual(user, env.PROXY_USERNAME) && timingSafeEqual(pass, env.PROXY_PASSWORD);
}

function unauthorized(req: Request, env: Env): Response {
	const headers = corsHeaders(req, env);
	headers.set('WWW-Authenticate', 'Basic realm="webdav-proxy"');
	return new Response('Unauthorized', { status: 401, headers });
}

function rewriteDestination(req: Request, env: Env): string | null | Response {
	const dest = req.headers.get('Destination');
	if (!dest) return null;

	const proxyOrigin = new URL(req.url).origin;
	let destUrl: URL;
	try {
		destUrl = new URL(dest, req.url);
	} catch {
		return new Response('Bad Destination header', { status: 400, headers: corsHeaders(req, env) });
	}

	if (destUrl.origin !== proxyOrigin) {
		return new Response('Destination must target this proxy', { status: 400, headers: corsHeaders(req, env) });
	}

	const upstream = new URL(env.UPSTREAM);
	destUrl.protocol = upstream.protocol;
	destUrl.host = upstream.host;
	return destUrl.toString();
}

async function handleProxy(req: Request, env: Env): Promise<Response> {
	const incomingUrl = new URL(req.url);
	const upstream = new URL(env.UPSTREAM);

	const targetUrl = new URL(upstream.toString());
	targetUrl.pathname = incomingUrl.pathname;
	targetUrl.search = incomingUrl.search;

	const headers = new Headers(req.headers);
	headers.delete('Host');
	headers.delete('Origin');
	headers.delete('Cookie');
	headers.set('Authorization', 'Basic ' + btoa(`${env.PCLOUD_USERNAME}:${env.PCLOUD_PASSWORD}`));

	const destRewrite = rewriteDestination(req, env);
	if (destRewrite instanceof Response) return destRewrite;
	if (destRewrite) headers.set('Destination', destRewrite);

	const init: RequestInit = {
		method: req.method,
		headers,
		body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
		redirect: 'manual',
	};
	// @ts-expect-error duplex is required by workers runtime for streaming bodies
	if (init.body) init.duplex = 'half';

	const upstreamRes = await fetch(targetUrl.toString(), init);

	const resHeaders = new Headers(upstreamRes.headers);
	resHeaders.delete('Content-Encoding');
	resHeaders.delete('Content-Length');

	const location = resHeaders.get('Location');
	if (location) {
		try {
			const locUrl = new URL(location, targetUrl);
			if (locUrl.origin === upstream.origin) {
				locUrl.protocol = incomingUrl.protocol;
				locUrl.host = incomingUrl.host;
				resHeaders.set('Location', locUrl.toString());
			}
		} catch {
			// leave Location untouched if unparsable
		}
	}

	const cors = corsHeaders(req, env);
	cors.forEach((value, key) => resHeaders.set(key, value));

	return new Response(upstreamRes.body, {
		status: upstreamRes.status,
		statusText: upstreamRes.statusText,
		headers: resHeaders,
	});
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		if (req.method === 'OPTIONS' && req.headers.has('Access-Control-Request-Method')) {
			return new Response(null, { status: 204, headers: corsHeaders(req, env) });
		}

		if (!checkProxyAuth(req, env)) {
			return unauthorized(req, env);
		}

		try {
			return await handleProxy(req, env);
		} catch (err) {
			const headers = corsHeaders(req, env);
			headers.set('Content-Type', 'text/plain');
			return new Response(`Proxy error: ${err instanceof Error ? err.message : String(err)}`, { status: 502, headers });
		}
	},
};
