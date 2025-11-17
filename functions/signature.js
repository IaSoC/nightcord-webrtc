// Use Web Crypto (crypto.subtle) when available. Dynamic Node fallback
// is used only where necessary to keep this file compatible with both
// Cloudflare Pages/Workers and local Node development.

// Self-contained implementation of OSS v4 style presigned URL signing.
// Exports an async function `signatureUrlV4(options, method, expires, request, objectName, additionalHeaders)`
// options: { accessKeyId, accessKeySecret, region, bucket, endpoint?, stsToken?, refreshSTSToken?(async) }

function formatDateUTC(d) {
	// produce YYYYMMDDTHHMMSSZ and YYYYMMDD
	const pad = (n) => (n < 10 ? '0' + n : '' + n);
	const Y = d.getUTCFullYear();
	const M = pad(d.getUTCMonth() + 1);
	const D = pad(d.getUTCDate());
	const h = pad(d.getUTCHours());
	const m = pad(d.getUTCMinutes());
	const s = pad(d.getUTCSeconds());
	const onlyDate = `${Y}${M}${D}`;
	const formattedDate = `${onlyDate}T${h}${m}${s}Z`;
	return { formattedDate, onlyDate };
}

function isFunction(fn) {
	return typeof fn === 'function';
}

async function setSTSToken(options) {
	if (options.stsToken && isFunction(options.refreshSTSToken)) {
		const token = await options.refreshSTSToken();
		if (token) options.stsToken = token;
	}
}

function getProduct(cloudBoxId) {
	// default product name used in Ali OSS v4 signing
	return cloudBoxId ? cloudBoxId : 'oss';
}

function getSignRegion(region, cloudBoxId) {
	// identity mapping; callers can pass region as-is
	return region || 'oss-cn-hangzhou';
}

function fixAdditionalHeaders(additionalHeaders) {
	if (!additionalHeaders) return [];
	if (!Array.isArray(additionalHeaders)) return [String(additionalHeaders)];
	return additionalHeaders.map((h) => String(h));
}


function bufferToHex(buf) {
	const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key, msg, encoding) {
	// key: string or Uint8Array/Buffer; msg: string
	const textEncoder = new TextEncoder();
	const msgBytes = textEncoder.encode(msg);

	// Require Web Crypto API (crypto.subtle). Cloudflare Workers and modern browsers provide this.
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		const keyBytes = typeof key === 'string' ? textEncoder.encode(key) : (key instanceof Uint8Array ? key : new Uint8Array(key));
		const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
		if (encoding === 'hex') return bufferToHex(sig);
		return new Uint8Array(sig);
	}

	// If we reach here the environment does not provide Web Crypto.
	throw new Error('Web Crypto API (crypto.subtle) is required but not available in this environment.');
}

async function sha256(msg, encoding) {
	const textEncoder = new TextEncoder();
	const msgBytes = textEncoder.encode(msg);
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		const digest = await crypto.subtle.digest('SHA-256', msgBytes);
		if (encoding === 'hex') return bufferToHex(digest);
		return new Uint8Array(digest);
	}

	// Web Crypto API required
	throw new Error('Web Crypto API (crypto.subtle) is required but not available in this environment.');
}

function encodeURIComponentStrict(str) {
	return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
		return '%' + c.charCodeAt(0).toString(16).toUpperCase();
	});
}

function encodeURIPath(path) {
	if (!path) return '/';
	// split and encode each segment to preserve slashes
	return (
		'/' +
		path
			.split('/')
			.map((seg) => encodeURIComponentStrict(seg))
			.join('/')
	);
}

function buildCanonicalQueryString(queries) {
	const parts = [];
	Object.keys(queries)
		.sort()
		.forEach((k) => {
			const v = queries[k];
			if (v === undefined || v === null) return;
			// if value is array, join with ','
			const val = Array.isArray(v) ? v.join(',') : String(v);
			parts.push(encodeURIComponentStrict(k) + '=' + encodeURIComponentStrict(val));
		});
	return parts.join('&');
}

function buildCanonicalHeaders(headers) {
	const canon = [];
	const names = Object.keys(headers || {})
		.map((n) => String(n).toLowerCase())
		.sort();
	const unique = Array.from(new Set(names));
	unique.forEach((name) => {
		let value = headers[name] || headers[String(name)];
		if (value === undefined) return;
		value = String(value).trim().replace(/\s+/g, ' ');
		canon.push(name + ':' + value + '\n');
	});
	const signedHeaders = unique.join(';');
	return { canonicalHeaders: canon.join(''), signedHeaders };
}

function getCredential(onlyDate, signRegion, accessKeyId, product) {
	// similar to AWS credential scope but uses product and aliyun_v4_request
	// x-oss-credential 格式：<AccessKeyId>/<SignDate>/<Region>/<product>/aliyun_v4_request
	return `${accessKeyId}/${onlyDate}/${signRegion}/${product}/aliyun_v4_request`;
}

function getCanonicalRequest(method, { headers = {}, queries = {} }, bucket, objectName, fixedAdditionalHeaders) {
	// Ensure host header is present
	const host = headers.host || `${bucket}.${headers.endpointHost || 'oss-' + (headers.region || '') + '.aliyuncs.com'}`;
	headers.host = headers.host || host;

	const canonicalURI = encodeURIPath(objectName);
	const canonicalQueryString = buildCanonicalQueryString(queries);
	const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headers);
	const payloadHash = 'UNSIGNED-PAYLOAD';

	const canonicalRequest = [
		method.toUpperCase(),
		canonicalURI,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		payloadHash
	].join('\n');
	return { canonicalRequest, signedHeaders };
}

async function getStringToSign(signRegion, formattedDate, canonicalRequest, product) {
	const algorithm = 'OSS4-HMAC-SHA256';
	const hashedRequest = await sha256(canonicalRequest, 'hex');
	const credentialScope = `${formattedDate.split('T')[0]}/${signRegion}/${product}/aliyun_v4_request`;
	return [algorithm, formattedDate, credentialScope, hashedRequest].join('\n');
}

async function getSignatureV4(secret, onlyDate, signRegion, stringToSign, product) {
	// Key derivation: kDate = HMAC('OSS4' + secret, onlyDate)
	const kDate = await hmac('OSS4' + secret, onlyDate);
	const kRegion = await hmac(kDate, signRegion);
	const kService = await hmac(kRegion, product);
	const kSigning = await hmac(kService, 'aliyun_v4_request');
	return await hmac(kSigning, stringToSign, 'hex');
}

/**
 * signatureUrlV4
 * @param {Object} options
 * @param {string} method
 * @param {number} expires
 * @param {Object} [request]
 * @param {Object} [request.headers]
 * @param {Object} [request.queries]
 * @param {string} [objectName]
 * @param {string[]} [additionalHeaders]
 */
async function signatureUrlV4(options, method, expires, request, objectName, additionalHeaders) {
	const { cloudBoxId } = options || {};
	const product = getProduct(cloudBoxId);
	const signRegion = getSignRegion(options.region, cloudBoxId);
	const headers = Object.assign({}, (request && request.headers) || {});
	const queries = Object.assign({}, (request && request.queries) || {});
	const date = new Date();
	const { formattedDate, onlyDate } = formatDateUTC(date);
	const fixedAdditionalHeaders = fixAdditionalHeaders(additionalHeaders);

	if (fixedAdditionalHeaders.length > 0) {
		queries['x-oss-additional-headers'] = fixedAdditionalHeaders.join(';');
	}
	queries['x-oss-credential'] = getCredential(onlyDate, signRegion, options.accessKeyId, product);
	queries['x-oss-date'] = formattedDate;
	queries['x-oss-expires'] = expires;
	queries['x-oss-signature-version'] = 'OSS4-HMAC-SHA256';

	if (options.stsToken && isFunction(options.refreshSTSToken)) {
		await setSTSToken(options);
	}

	if (options.stsToken) {
		queries['x-oss-security-token'] = options.stsToken;
	}

	// include host and helpful headers for canonicalization
	const tempHeaders = Object.assign({}, headers);
	// Provide region/endpoint hints for host construction used in canonical
	if (!tempHeaders.endpointHost && options.region) tempHeaders.region = options.region;

	const { canonicalRequest, signedHeaders } = getCanonicalRequest(
		method,
		{
			headers: tempHeaders,
			queries
		},
		options.bucket,
		objectName,
		fixedAdditionalHeaders
	);
	const stringToSign = await getStringToSign(signRegion, formattedDate, canonicalRequest, product);

	queries['x-oss-signature'] = await getSignatureV4(
		options.accessKeySecret,
		onlyDate,
		signRegion,
		stringToSign,
		product
	);

	// Build base URL. Prefer options.endpoint when provided.
	let endpoint;
	if (options.endpoint) {
		endpoint = options.endpoint.replace(/\/+$/, '');
	} else if (options.region) {
		// default style: https://{bucket}.oss-{region}.aliyuncs.com
		endpoint = `https://${options.bucket}.oss-${options.region}.aliyuncs.com`;
	} else {
		endpoint = `https://${options.bucket}.aliyuncs.com`;
	}

	const objectPath = objectName ? (objectName.charAt(0) === '/' ? objectName : '/' + objectName) : '/';
		// Use WHATWG URL API instead of Node's `url` module so this works in
		// browser/Workers/Pages environments and avoids bundling the Node builtin.
		const parsed = new URL(endpoint);
		// append object path
		parsed.pathname = (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '') + objectPath;

		// populate query/search params from `queries` object
		// clear existing search
		parsed.search = '';
		Object.keys(queries).forEach((k) => {
			const v = queries[k];
			if (v === undefined || v === null) return;
			const val = Array.isArray(v) ? v.join(',') : String(v);
			parsed.searchParams.set(k, val);
		});
		// include signed headers list for clients that may need it
		parsed.searchParams.set('x-oss-signedheaders', signedHeaders);

		return parsed.toString();
}

export async function onRequest(context) {
	const { request } = context || {};

	// Attempt to parse JSON body (if any). Ignore errors and fall back to query params.
	let body = null;
	try {
		body = await request.json();
	} catch (e) {
		body = null;
	}

	const url = new URL(request.url);
	const queryParams = Object.fromEntries(url.searchParams.entries());

	const getParam = (key) => {
		if (body && Object.prototype.hasOwnProperty.call(body, key)) return body[key];
		if (Object.prototype.hasOwnProperty.call(queryParams, key)) return queryParams[key];
		return undefined;
	};

	// Collect options: either as a full object or as individual fields
	let options = getParam('options') || {};
	if (typeof options === 'string') {
		try {
			options = JSON.parse(options);
		} catch (e) {
			options = {};
		}
	}

	// Allow supplying some option fields at the top level (convenience)
	['accessKeyId', 'accessKeySecret', 'region', 'bucket', 'endpoint', 'stsToken', 'cloudBoxId'].forEach((k) => {
		const v = getParam(k);
		if (v !== undefined) options[k] = v;
	});

	const method = (getParam('method') || 'GET').toString().toUpperCase();
	const expiresRaw = getParam('expires');
	const expires = expiresRaw !== undefined ? parseInt(expiresRaw, 10) : 3600;
	const objectName = getParam('objectName') || getParam('object') || getParam('key');
	let additionalHeaders = getParam('additionalHeaders') || getParam('additional_headers');
	if (typeof additionalHeaders === 'string') {
		try { additionalHeaders = JSON.parse(additionalHeaders); } catch (e) { /* keep string */ }
	}

	// request payload for canonicalization (optional)
	let requestParts = getParam('request') || {};
	if (typeof requestParts === 'string') {
		try { requestParts = JSON.parse(requestParts); } catch (e) { requestParts = {}; }
	}

	// Prefer credentials from Cloudflare Pages Secrets (context.env) or local process.env
	const env = (context && context.env) || (typeof process !== 'undefined' ? process.env : {});
	const getEnvVal = (names) => {
		for (const n of names) {
			if (env && typeof env[n] !== 'undefined' && env[n] !== null) return env[n];
			if (typeof process !== 'undefined' && process.env && typeof process.env[n] !== 'undefined') return process.env[n];
		}
		return undefined;
	};

	options = options || {};
	// Common env var names used for convenience. Adjust names in your Pages project secrets as needed.
	options.accessKeyId = options.accessKeyId || getEnvVal(['OSS_ACCESS_KEY_ID', 'ACCESS_KEY_ID', 'ACCESSKEYID']);
	options.accessKeySecret = options.accessKeySecret || getEnvVal(['OSS_ACCESS_KEY_SECRET', 'ACCESS_KEY_SECRET', 'ACCESSSECRET']);
	options.bucket = options.bucket || getEnvVal(['OSS_BUCKET', 'BUCKET']);
	options.region = options.region || getEnvVal(['OSS_REGION', 'REGION']);
	options.endpoint = options.endpoint || getEnvVal(['OSS_ENDPOINT', 'ENDPOINT']);
	options.stsToken = options.stsToken || getEnvVal(['OSS_STS_TOKEN', 'STS_TOKEN']);
	options.cloudBoxId = options.cloudBoxId || getEnvVal(['OSS_CLOUDBOX_ID', 'CLOUD_BOX_ID', 'CLOUDBOXID']);

	// Basic validation
	if (!options || !options.accessKeyId || !options.accessKeySecret || !options.bucket) {
		return new Response(
			JSON.stringify({ error: 'Missing required option(s). Required: accessKeyId, accessKeySecret, bucket (or set them in environment/secrets)' }),
			{ status: 400, headers: { 'Content-Type': 'application/json' } }
		);
	}

	try {
		const signedUrl = await signatureUrlV4(options, method, expires, requestParts, objectName, additionalHeaders);
		return new Response(JSON.stringify({ url: signedUrl }), { status: 200, headers: { 'Content-Type': 'application/json' } });
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}
}
