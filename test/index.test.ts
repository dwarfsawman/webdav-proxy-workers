import { describe, expect, it } from 'bun:test';
import worker, { allowedOrigin, type Env } from '../src/index';

const mockEnv: Env = {
	UPSTREAM: 'https://ewebdav.pcloud.com',
	ALLOWED_ORIGINS: 'https://readest-web-personal.raven-log.workers.dev,https://*.raven-log.workers.dev,http://localhost:3000,http://127.0.0.1:3000',
	PROXY_USERNAME: 'testuser',
	PROXY_PASSWORD: 'testpassword',
	PCLOUD_USERNAME: 'pcloud@example.com',
	PCLOUD_PASSWORD: 'pcloudsecret',
};

describe('allowedOrigin', () => {
	it('allows exact production origin', () => {
		const req = new Request('https://proxy.example.com/', {
			headers: { Origin: 'https://readest-web-personal.raven-log.workers.dev' },
		});
		expect(allowedOrigin(req, mockEnv)).toBe('https://readest-web-personal.raven-log.workers.dev');
	});

	it('allows wildcard subdomains on raven-log.workers.dev', () => {
		const req = new Request('https://proxy.example.com/', {
			headers: { Origin: 'https://preview-123.raven-log.workers.dev' },
		});
		expect(allowedOrigin(req, mockEnv)).toBe('https://preview-123.raven-log.workers.dev');
	});

	it('allows localhost development origins', () => {
		const req = new Request('https://proxy.example.com/', {
			headers: { Origin: 'http://localhost:3000' },
		});
		expect(allowedOrigin(req, mockEnv)).toBe('http://localhost:3000');
	});

	it('rejects unauthorized origins', () => {
		const req = new Request('https://proxy.example.com/', {
			headers: { Origin: 'https://unauthorized.example.com' },
		});
		expect(allowedOrigin(req, mockEnv)).toBeNull();
	});

	it('returns null when Origin header is missing', () => {
		const req = new Request('https://proxy.example.com/');
		expect(allowedOrigin(req, mockEnv)).toBeNull();
	});
});

describe('Worker CORS integration', () => {
	it('returns CORS headers for allowed origin on OPTIONS preflight', async () => {
		const req = new Request('https://proxy.example.com/Documents/Books/', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://readest-web-personal.raven-log.workers.dev',
				'Access-Control-Request-Method': 'PROPFIND',
			},
		});
		const res = await worker.fetch(req, mockEnv);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://readest-web-personal.raven-log.workers.dev');
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
		expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PROPFIND');
	});

	it('returns 401 with CORS headers when unauthenticated request comes from allowed origin', async () => {
		const req = new Request('https://proxy.example.com/Documents/Books/', {
			method: 'PROPFIND',
			headers: {
				Origin: 'https://readest-web-personal.raven-log.workers.dev',
			},
		});
		const res = await worker.fetch(req, mockEnv);
		expect(res.status).toBe(401);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://readest-web-personal.raven-log.workers.dev');
		expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="webdav-proxy"');
	});

	it('does not return Access-Control-Allow-Origin for disallowed origin', async () => {
		const req = new Request('https://proxy.example.com/Documents/Books/', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://evil.com',
				'Access-Control-Request-Method': 'PROPFIND',
			},
		});
		const res = await worker.fetch(req, mockEnv);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});
