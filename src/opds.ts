import { Env } from './index';

export interface DavItem {
	path: string;
	name: string;
	isCollection: boolean;
	contentLength?: number;
	contentType?: string;
	lastModified?: string;
}

export const OPDS_MIME = {
	NAVIGATION: 'application/atom+xml;profile=opds-catalog;kind=navigation',
	ACQUISITION: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
} as const;

export const SUPPORTED_BOOK_EXTENSIONS = new Set([
	'epub',
	'pdf',
	'mobi',
	'azw',
	'azw3',
	'cbz',
	'cbr',
	'fb2',
	'zip',
	'txt',
]);

export const MIME_MAP: Record<string, string> = {
	epub: 'application/epub+zip',
	pdf: 'application/pdf',
	mobi: 'application/x-mobipocket-ebook',
	azw: 'application/vnd.amazon.ebook',
	azw3: 'application/vnd.amazon.ebook',
	cbz: 'application/vnd.comicbook+zip',
	cbr: 'application/vnd.comicbook-rar',
	fb2: 'application/x-fictionbook+xml',
	zip: 'application/zip',
	txt: 'text/plain',
};

export function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export function unescapeXml(str: string): string {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

export function formatFileSize(bytes?: number): string {
	if (bytes === undefined || bytes < 0) return '';
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getFileExtension(filename: string): string {
	const dotIndex = filename.lastIndexOf('.');
	return dotIndex !== -1 ? filename.slice(dotIndex + 1).toLowerCase() : '';
}

export function getMimeType(filename: string, serverContentType?: string): string {
	const ext = getFileExtension(filename);
	if (ext && MIME_MAP[ext]) {
		return MIME_MAP[ext];
	}
	if (serverContentType && serverContentType !== 'application/octet-stream') {
		return serverContentType.split(';')[0].trim();
	}
	return 'application/octet-stream';
}

export function normalizePath(path: string): string {
	let normalized = path.replace(/\\/g, '/');
	if (!normalized.startsWith('/')) normalized = '/' + normalized;
	return normalized;
}

export function encodeUriSegments(path: string): string {
	const segments = path.split('/').map((seg) => encodeURIComponent(seg));
	return segments.join('/');
}

export function parseWebDavMultiStatus(
	xmlText: string,
	currentNormalizedPath: string,
): { directories: DavItem[]; files: DavItem[] } {
	const directories: DavItem[] = [];
	const files: DavItem[] = [];

	const responseRegex = /<(?:[a-zA-Z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?response>/gi;
	let match: RegExpExecArray | null;

	const ensureTrailingSlash = (p: string) => (p.endsWith('/') ? p : p + '/');
	const currentWithSlash = ensureTrailingSlash(currentNormalizedPath);

	while ((match = responseRegex.exec(xmlText)) !== null) {
		const responseChunk = match[1];

		// Extract href
		const hrefMatch = /<(?:[a-zA-Z0-9_-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?href>/i.exec(responseChunk);
		if (!hrefMatch) continue;

		let rawHref = hrefMatch[1].trim();
		try {
			if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
				rawHref = new URL(rawHref).pathname;
			}
			rawHref = decodeURIComponent(rawHref);
		} catch {
			// use rawHref as-is if decoding fails
		}

		let itemPath = normalizePath(rawHref);

		// Extract resourcetype
		const resourceTypeMatch = /<(?:[a-zA-Z0-9_-]+:)?resourcetype\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?resourcetype>/i.exec(responseChunk);
		const isCollection = resourceTypeMatch
			? /<(?:[a-zA-Z0-9_-]+:)?collection\b/i.test(resourceTypeMatch[1])
			: false;

		if (isCollection && !itemPath.endsWith('/')) {
			itemPath += '/';
		}

		// Check if it represents current requested directory
		const itemPathWithSlash = isCollection ? itemPath : itemPath;
		if (itemPathWithSlash === currentWithSlash || itemPath === currentNormalizedPath) {
			continue;
		}

		// Extract displayname
		const displayNameMatch = /<(?:[a-zA-Z0-9_-]+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?displayname>/i.exec(responseChunk);
		let name = displayNameMatch ? unescapeXml(displayNameMatch[1].trim()) : '';

		if (!name) {
			const cleanPath = isCollection ? itemPath.slice(0, -1) : itemPath;
			const lastSlash = cleanPath.lastIndexOf('/');
			name = lastSlash !== -1 ? cleanPath.slice(lastSlash + 1) : cleanPath;
		}

		// Ignore hidden files and system directories
		if (name.startsWith('.') || name.length === 0) {
			continue;
		}

		// Extract getcontentlength
		let contentLength: number | undefined;
		const lengthMatch = /<(?:[a-zA-Z0-9_-]+:)?getcontentlength\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?getcontentlength>/i.exec(responseChunk);
		if (lengthMatch) {
			const len = parseInt(lengthMatch[1].trim(), 10);
			if (!isNaN(len)) contentLength = len;
		}

		// Extract getcontenttype
		let contentType: string | undefined;
		const typeMatch = /<(?:[a-zA-Z0-9_-]+:)?getcontenttype\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?getcontenttype>/i.exec(responseChunk);
		if (typeMatch) {
			contentType = unescapeXml(typeMatch[1].trim());
		}

		// Extract getlastmodified
		let lastModified: string | undefined;
		const modifiedMatch = /<(?:[a-zA-Z0-9_-]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?getlastmodified>/i.exec(responseChunk);
		if (modifiedMatch) {
			const rawDate = modifiedMatch[1].trim();
			const parsed = new Date(rawDate);
			if (!isNaN(parsed.getTime())) {
				lastModified = parsed.toISOString();
			}
		}

		const davItem: DavItem = {
			path: itemPath,
			name,
			isCollection,
			contentLength,
			contentType,
			lastModified,
		};

		if (isCollection) {
			directories.push(davItem);
		} else {
			const ext = getFileExtension(name);
			if (SUPPORTED_BOOK_EXTENSIONS.has(ext)) {
				files.push(davItem);
			}
		}
	}

	// Sort alphabetically
	directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
	files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

	return { directories, files };
}

export interface NavigationFeedOptions {
	proxyOrigin: string;
	currentPath: string; // e.g. "/Documents/Books/"
	directories: DavItem[];
	fileCount: number;
	feedTitle?: string;
}

/**
 * Generates an OPDS 1.2 Navigation Feed containing sub-folders and
 * a link/entry to the Acquisition Feed of books in the current folder.
 */
export function generateNavigationFeed(options: NavigationFeedOptions): string {
	const { proxyOrigin, currentPath, directories, fileCount } = options;
	const normalizedCurrent = normalizePath(currentPath);
	const currentWithSlash = normalizedCurrent.endsWith('/') ? normalizedCurrent : normalizedCurrent + '/';

	const title = options.feedTitle || (currentWithSlash === '/'
		? 'pCloud Gateway'
		: currentWithSlash.slice(0, -1).split('/').pop() || 'Catalog');

	const nowIso = new Date().toISOString();
	const selfUrl = `${proxyOrigin}/opds${encodeUriSegments(currentWithSlash)}`;
	const startUrl = `${proxyOrigin}/opds/`;
	const booksUrl = `${proxyOrigin}/opds${encodeUriSegments(currentWithSlash)}?type=acquisition`;

	// Compute parent path for navigation
	let parentLinkXml = '';
	if (currentWithSlash !== '/') {
		const parts = currentWithSlash.slice(0, -1).split('/');
		parts.pop(); // remove last segment
		const parentPath = (parts.join('/') || '') + '/';
		const parentUrl = `${proxyOrigin}/opds${encodeUriSegments(parentPath)}`;
		parentLinkXml = `\n  <link rel="up" href="${escapeXml(parentUrl)}" type="${OPDS_MIME.NAVIGATION}" title="Parent Directory" />`;
	}

	// Feed-level link to books acquisition feed if files exist
	let feedBooksLinkXml = '';
	if (fileCount > 0) {
		feedBooksLinkXml = `\n  <link rel="subsection" href="${escapeXml(booksUrl)}" type="${OPDS_MIME.ACQUISITION}" title="Books in this folder" />`;
	}

	const entriesXml: string[] = [];

	// If there are books in this directory, provide a prominent entry pointing to the Acquisition feed
	if (fileCount > 0) {
		entriesXml.push(`  <entry>
    <title>📚 Books (${fileCount})</title>
    <id>urn:pcloud:acquisition:${escapeXml(currentWithSlash)}</id>
    <updated>${nowIso}</updated>
    <content type="text">Browse ${fileCount} books in this folder</content>
    <link rel="subsection" href="${escapeXml(booksUrl)}" type="${OPDS_MIME.ACQUISITION}" />
  </entry>`);
	}

	// Sub-directories (Navigation Entries)
	for (const dir of directories) {
		const dirPathWithSlash = dir.path.endsWith('/') ? dir.path : dir.path + '/';
		const dirUrl = `${proxyOrigin}/opds${encodeUriSegments(dirPathWithSlash)}`;
		const updated = dir.lastModified || nowIso;

		entriesXml.push(`  <entry>
    <title>${escapeXml(dir.name)}</title>
    <id>urn:pcloud:dir:${escapeXml(dirPathWithSlash)}</id>
    <updated>${updated}</updated>
    <content type="text">Folder: ${escapeXml(dir.name)}</content>
    <link rel="subsection" href="${escapeXml(dirUrl)}" type="${OPDS_MIME.NAVIGATION}" />
  </entry>`);
	}

	return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:pcloud:nav:${escapeXml(currentWithSlash)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${nowIso}</updated>
  <author>
    <name>pCloud Gateway</name>
  </author>
  <link rel="self" href="${escapeXml(selfUrl)}" type="${OPDS_MIME.NAVIGATION}" />
  <link rel="start" href="${escapeXml(startUrl)}" type="${OPDS_MIME.NAVIGATION}" title="Home" />${parentLinkXml}${feedBooksLinkXml}
${entriesXml.join('\n')}
</feed>`;
}

export interface AcquisitionFeedOptions {
	proxyOrigin: string;
	currentPath: string; // e.g. "/Documents/Books/"
	files: DavItem[];
	feedTitle?: string;
}

/**
 * Generates an OPDS 1.2 Acquisition Feed containing only the books
 * within the current folder, with direct download links.
 */
export function generateAcquisitionFeed(options: AcquisitionFeedOptions): string {
	const { proxyOrigin, currentPath, files } = options;
	const normalizedCurrent = normalizePath(currentPath);
	const currentWithSlash = normalizedCurrent.endsWith('/') ? normalizedCurrent : normalizedCurrent + '/';

	const baseTitle = options.feedTitle || (currentWithSlash === '/'
		? 'pCloud Gateway'
		: currentWithSlash.slice(0, -1).split('/').pop() || 'Catalog');
	const title = `${baseTitle} — Books`;

	const nowIso = new Date().toISOString();
	const selfUrl = `${proxyOrigin}/opds${encodeUriSegments(currentWithSlash)}?type=acquisition`;
	const startUrl = `${proxyOrigin}/opds/`;
	const navUrl = `${proxyOrigin}/opds${encodeUriSegments(currentWithSlash)}`;

	const entriesXml: string[] = [];

	// Book files (Acquisition Entries)
	for (const file of files) {
		const downloadUrl = `${proxyOrigin}${encodeUriSegments(file.path)}`;
		const updated = file.lastModified || nowIso;
		const mimeType = getMimeType(file.name, file.contentType);
		const sizeFormatted = formatFileSize(file.contentLength);
		const lengthAttr = file.contentLength !== undefined ? ` length="${file.contentLength}"` : '';

		// Remove file extension for cleaner title
		const dotIdx = file.name.lastIndexOf('.');
		const displayName = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;

		const contentText = sizeFormatted ? `${file.name} (${sizeFormatted})` : file.name;

		entriesXml.push(`  <entry>
    <title>${escapeXml(displayName)}</title>
    <id>urn:pcloud:file:${escapeXml(file.path)}</id>
    <updated>${updated}</updated>
    <content type="text">${escapeXml(contentText)}</content>
    <link rel="http://opds-spec.org/acquisition" href="${escapeXml(downloadUrl)}" type="${escapeXml(mimeType)}"${lengthAttr} />
  </entry>`);
	}

	return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:pcloud:acquisition:${escapeXml(currentWithSlash)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${nowIso}</updated>
  <author>
    <name>pCloud Gateway</name>
  </author>
  <link rel="self" href="${escapeXml(selfUrl)}" type="${OPDS_MIME.ACQUISITION}" />
  <link rel="start" href="${escapeXml(startUrl)}" type="${OPDS_MIME.NAVIGATION}" title="Home" />
  <link rel="up" href="${escapeXml(navUrl)}" type="${OPDS_MIME.NAVIGATION}" title="Back to Folder" />
${entriesXml.join('\n')}
</feed>`;
}

export async function handleOpds(
	req: Request,
	env: Env,
	cors: Headers,
): Promise<Response> {
	const incomingUrl = new URL(req.url);

	// Strip leading /opds or /opds/
	let pcloudPath = incomingUrl.pathname.replace(/^\/opds\/?/, '/');
	if (!pcloudPath.startsWith('/')) pcloudPath = '/' + pcloudPath;

	const upstream = new URL(env.UPSTREAM);
	const targetUrl = new URL(upstream.origin);
	targetUrl.pathname = pcloudPath;

	const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getcontenttype/>
    <D:getlastmodified/>
  </D:prop>
</D:propfind>`;

	const upstreamHeaders = new Headers();
	upstreamHeaders.set('Authorization', 'Basic ' + btoa(`${env.PCLOUD_USERNAME}:${env.PCLOUD_PASSWORD}`));
	upstreamHeaders.set('Depth', '1');
	upstreamHeaders.set('Content-Type', 'application/xml; charset=utf-8');

	const upstreamRes = await fetch(targetUrl.toString(), {
		method: 'PROPFIND',
		headers: upstreamHeaders,
		body: propfindBody,
	});

	if (upstreamRes.status === 404) {
		const resHeaders = new Headers(cors);
		resHeaders.set('Content-Type', 'text/plain; charset=utf-8');
		return new Response('Directory not found on pCloud', { status: 404, headers: resHeaders });
	}

	if (!upstreamRes.ok && upstreamRes.status !== 207) {
		const resHeaders = new Headers(cors);
		resHeaders.set('Content-Type', 'text/plain; charset=utf-8');
		return new Response(`pCloud WebDAV error: ${upstreamRes.status} ${upstreamRes.statusText}`, {
			status: upstreamRes.status >= 500 ? 502 : upstreamRes.status,
			headers: resHeaders,
		});
	}

	const xmlText = await upstreamRes.text();
	const { directories, files } = parseWebDavMultiStatus(xmlText, pcloudPath);

	const isAcquisitionRequest =
		incomingUrl.searchParams.get('type') === 'acquisition' ||
		incomingUrl.searchParams.get('view') === 'books';

	let feedXml: string;
	let mimeType: string;

	if (isAcquisitionRequest) {
		feedXml = generateAcquisitionFeed({
			proxyOrigin: incomingUrl.origin,
			currentPath: pcloudPath,
			files,
		});
		mimeType = `${OPDS_MIME.ACQUISITION};charset=utf-8`;
	} else {
		feedXml = generateNavigationFeed({
			proxyOrigin: incomingUrl.origin,
			currentPath: pcloudPath,
			directories,
			fileCount: files.length,
		});
		mimeType = `${OPDS_MIME.NAVIGATION};charset=utf-8`;
	}

	const resHeaders = new Headers(cors);
	resHeaders.set('Content-Type', mimeType);
	resHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');

	return new Response(feedXml, {
		status: 200,
		headers: resHeaders,
	});
}
