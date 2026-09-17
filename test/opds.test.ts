import { describe, expect, it } from 'bun:test';
import {
	escapeXml,
	formatFileSize,
	generateAcquisitionFeed,
	generateNavigationFeed,
	getMimeType,
	normalizePath,
	OPDS_MIME,
	parseWebDavMultiStatus,
} from '../src/opds';
import worker, { Env } from '../src/index';

describe('OPDS Utilities', () => {
	it('escapeXml escapes &, <, >, ", and \'', () => {
		expect(escapeXml('Tom & Jerry <"Adventure\'>')).toBe('Tom &amp; Jerry &lt;&quot;Adventure&apos;&gt;');
	});

	it('formatFileSize formats bytes to human readable string', () => {
		expect(formatFileSize(0)).toBe('0 B');
		expect(formatFileSize(512)).toBe('512 B');
		expect(formatFileSize(1024)).toBe('1 KB');
		expect(formatFileSize(1048576)).toBe('1 MB');
		expect(formatFileSize(1572864)).toBe('1.5 MB');
		expect(formatFileSize(undefined)).toBe('');
	});

	it('getMimeType identifies standard ebook formats', () => {
		expect(getMimeType('book.epub')).toBe('application/epub+zip');
		expect(getMimeType('doc.pdf')).toBe('application/pdf');
		expect(getMimeType('novel.mobi')).toBe('application/x-mobipocket-ebook');
		expect(getMimeType('comic.cbz')).toBe('application/vnd.comicbook+zip');
		expect(getMimeType('notes.txt')).toBe('text/plain');
		expect(getMimeType('unknown.xyz', 'application/custom')).toBe('application/custom');
	});

	it('normalizePath ensures leading slash', () => {
		expect(normalizePath('foo/bar')).toBe('/foo/bar');
		expect(normalizePath('/foo/bar')).toBe('/foo/bar');
		expect(normalizePath('foo\\bar')).toBe('/foo/bar');
	});
});

describe('WebDAV Multi-Status XML Parser', () => {
	const sampleXml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <!-- Current Directory -->
  <D:response>
    <D:href>/Documents/Books/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>Wed, 17 Sep 2026 05:00:00 GMT</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <!-- Sub Directory -->
  <D:response>
    <D:href>/Documents/Books/SciFi/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>SciFi</D:displayname>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>Wed, 17 Sep 2026 05:10:00 GMT</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <!-- Japanese Named Directory with percent encoding -->
  <D:response>
    <D:href>/Documents/Books/%E5%B0%8F%E8%AA%AC/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>小説</D:displayname>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>Wed, 17 Sep 2026 05:12:00 GMT</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <!-- Book file: epub -->
  <D:response>
    <D:href>/Documents/Books/Dune.epub</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Dune.epub</D:displayname>
        <D:resourcetype/>
        <D:getcontentlength>2097152</D:getcontentlength>
        <D:getcontenttype>application/epub+zip</D:getcontenttype>
        <D:getlastmodified>Wed, 17 Sep 2026 05:20:00 GMT</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <!-- Book file: pdf with special chars -->
  <D:response>
    <D:href>/Documents/Books/Alice%20%26%20Bob.pdf</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Alice &amp; Bob.pdf</D:displayname>
        <D:resourcetype/>
        <D:getcontentlength>5242880</D:getcontentlength>
        <D:getlastmodified>Wed, 17 Sep 2026 05:30:00 GMT</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <!-- Hidden file (should be ignored) -->
  <D:response>
    <D:href>/Documents/Books/.DS_Store</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>.DS_Store</D:displayname>
        <D:resourcetype/>
        <D:getcontentlength>6148</D:getcontentlength>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <!-- Non-book file (should be ignored) -->
  <D:response>
    <D:href>/Documents/Books/cover.jpg</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>cover.jpg</D:displayname>
        <D:resourcetype/>
        <D:getcontentlength>102400</D:getcontentlength>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

	it('correctly parses directories and files while ignoring current dir and hidden/non-book files', () => {
		const { directories, files } = parseWebDavMultiStatus(sampleXml, '/Documents/Books/');

		expect(directories.length).toBe(2);
		expect(directories[0].name).toBe('SciFi');
		expect(directories[0].path).toBe('/Documents/Books/SciFi/');
		expect(directories[0].isCollection).toBe(true);

		expect(directories[1].name).toBe('小説');
		expect(directories[1].path).toBe('/Documents/Books/小説/');
		expect(directories[1].isCollection).toBe(true);

		expect(files.length).toBe(2);
		expect(files[0].name).toBe('Alice & Bob.pdf');
		expect(files[0].path).toBe('/Documents/Books/Alice & Bob.pdf');
		expect(files[0].contentLength).toBe(5242880);

		expect(files[1].name).toBe('Dune.epub');
		expect(files[1].path).toBe('/Documents/Books/Dune.epub');
		expect(files[1].contentLength).toBe(2097152);
	});
});

describe('OPDS 1.2 Feed Separation', () => {
	it('generates Navigation Feed without book acquisition entries, linking to Acquisition Feed', () => {
		const xml = generateNavigationFeed({
			proxyOrigin: 'https://proxy.example.com',
			currentPath: '/Documents/Books/',
			directories: [
				{
					name: 'SciFi',
					path: '/Documents/Books/SciFi/',
					isCollection: true,
					lastModified: '2026-09-17T05:10:00.000Z',
				},
			],
			fileCount: 5,
		});

		expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
		expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
		expect(xml).toContain('<title>Books</title>');

		// self and start links
		expect(xml).toContain(`<link rel="self" href="https://proxy.example.com/opds/Documents/Books/" type="${OPDS_MIME.NAVIGATION}" />`);
		expect(xml).toContain(`<link rel="start" href="https://proxy.example.com/opds/" type="${OPDS_MIME.NAVIGATION}" title="Home" />`);
		expect(xml).toContain(`<link rel="up" href="https://proxy.example.com/opds/Documents/" type="${OPDS_MIME.NAVIGATION}" title="Parent Directory" />`);

		// Link to acquisition feed of this folder
		expect(xml).toContain(`<link rel="subsection" href="https://proxy.example.com/opds/Documents/Books/?type=acquisition" type="${OPDS_MIME.ACQUISITION}" title="Books in this folder" />`);

		// Navigation entry for books
		expect(xml).toContain('<title>📚 Books (5)</title>');
		expect(xml).toContain(`<link rel="subsection" href="https://proxy.example.com/opds/Documents/Books/?type=acquisition" type="${OPDS_MIME.ACQUISITION}" />`);

		// Subdirectory navigation entry
		expect(xml).toContain('<title>SciFi</title>');
		expect(xml).toContain(`<link rel="subsection" href="https://proxy.example.com/opds/Documents/Books/SciFi/" type="${OPDS_MIME.NAVIGATION}" />`);

		// MUST NOT contain acquisition link directly in navigation feed
		expect(xml).not.toContain('rel="http://opds-spec.org/acquisition"');
	});

	it('generates Acquisition Feed containing only book acquisition entries', () => {
		const xml = generateAcquisitionFeed({
			proxyOrigin: 'https://proxy.example.com',
			currentPath: '/Documents/Books/',
			files: [
				{
					name: 'Dune.epub',
					path: '/Documents/Books/Dune.epub',
					isCollection: false,
					contentLength: 2097152,
					lastModified: '2026-09-17T05:20:00.000Z',
				},
			],
		});

		expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
		expect(xml).toContain('<title>Books — Books</title>');

		// self, start, up links
		expect(xml).toContain(`<link rel="self" href="https://proxy.example.com/opds/Documents/Books/?type=acquisition" type="${OPDS_MIME.ACQUISITION}" />`);
		expect(xml).toContain(`<link rel="start" href="https://proxy.example.com/opds/" type="${OPDS_MIME.NAVIGATION}" title="Home" />`);
		expect(xml).toContain(`<link rel="up" href="https://proxy.example.com/opds/Documents/Books/" type="${OPDS_MIME.NAVIGATION}" title="Back to Folder" />`);

		// Book file acquisition entry
		expect(xml).toContain('<title>Dune</title>');
		expect(xml).toContain('<content type="text">Dune.epub (2 MB)</content>');
		expect(xml).toContain('<link rel="http://opds-spec.org/acquisition" href="https://proxy.example.com/Documents/Books/Dune.epub" type="application/epub+zip" length="2097152" />');

		// MUST NOT contain subsection links
		expect(xml).not.toContain('rel="subsection"');
	});
});

describe('Worker End-to-End Routing and Auth', () => {
	const mockEnv: Env = {
		UPSTREAM: 'https://ewebdav.pcloud.com',
		ALLOWED_ORIGINS: 'https://readest-web-personal.raven-log.workers.dev',
		PROXY_USERNAME: 'testuser',
		PROXY_PASSWORD: 'testpassword',
		PCLOUD_USERNAME: 'pcloud@example.com',
		PCLOUD_PASSWORD: 'pcloudsecret',
	};

	it('returns 401 when request has no credentials', async () => {
		const req = new Request('https://proxy.example.com/opds/', {
			headers: { Origin: 'https://readest-web-personal.raven-log.workers.dev' },
		});
		const res = await worker.fetch(req, mockEnv);

		expect(res.status).toBe(401);
		expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="webdav-proxy"');
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://readest-web-personal.raven-log.workers.dev');
	});

	it('returns 204 on OPTIONS preflight with CORS headers', async () => {
		const req = new Request('https://proxy.example.com/opds/Documents/Books/', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://readest-web-personal.raven-log.workers.dev',
				'Access-Control-Request-Method': 'GET',
			},
		});
		const res = await worker.fetch(req, mockEnv);

		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://readest-web-personal.raven-log.workers.dev');
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
	});
});
