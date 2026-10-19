// static/wasm/texlive/dist/comlink.js
var proxyMarker = /* @__PURE__ */ Symbol("Comlink.proxy");
var createEndpoint = /* @__PURE__ */ Symbol("Comlink.endpoint");
var releaseProxy = /* @__PURE__ */ Symbol("Comlink.releaseProxy");
var finalizer = /* @__PURE__ */ Symbol("Comlink.finalizer");
var throwMarker = /* @__PURE__ */ Symbol("Comlink.thrown");
var isObject = (val) => typeof val === "object" && val !== null || typeof val === "function";
var proxyTransferHandler = {
  canHandle: (val) => isObject(val) && val[proxyMarker],
  serialize(obj) {
    const { port1, port2 } = new MessageChannel();
    expose(obj, port1);
    return [port2, [port2]];
  },
  deserialize(port) {
    port.start();
    return wrap(port);
  }
};
var throwTransferHandler = {
  canHandle: (value) => isObject(value) && throwMarker in value,
  serialize({ value }) {
    let serialized;
    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack
        }
      };
    } else {
      serialized = { isError: false, value };
    }
    return [serialized, []];
  },
  deserialize(serialized) {
    if (serialized.isError) {
      throw Object.assign(new Error(serialized.value.message), serialized.value);
    }
    throw serialized.value;
  }
};
var transferHandlers = /* @__PURE__ */ new Map([
  ["proxy", proxyTransferHandler],
  ["throw", throwTransferHandler]
]);
function isAllowedOrigin(allowedOrigins, origin) {
  for (const allowedOrigin of allowedOrigins) {
    if (origin === allowedOrigin || allowedOrigin === "*") {
      return true;
    }
    if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
      return true;
    }
  }
  return false;
}
function expose(obj, ep = globalThis, allowedOrigins = ["*"]) {
  ep.addEventListener("message", function callback(ev) {
    if (!ev || !ev.data) {
      return;
    }
    if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
      console.warn(`Invalid origin '${ev.origin}' for comlink proxy`);
      return;
    }
    const { id, type, path } = Object.assign({ path: [] }, ev.data);
    const argumentList = (ev.data.argumentList || []).map(fromWireValue);
    let returnValue;
    try {
      const parent = path.slice(0, -1).reduce((obj2, prop) => obj2[prop], obj);
      const rawValue = path.reduce((obj2, prop) => obj2[prop], obj);
      switch (type) {
        case "GET":
          {
            returnValue = rawValue;
          }
          break;
        case "SET":
          {
            parent[path.slice(-1)[0]] = fromWireValue(ev.data.value);
            returnValue = true;
          }
          break;
        case "APPLY":
          {
            returnValue = rawValue.apply(parent, argumentList);
          }
          break;
        case "CONSTRUCT":
          {
            const value = new rawValue(...argumentList);
            returnValue = proxy(value);
          }
          break;
        case "ENDPOINT":
          {
            const { port1, port2 } = new MessageChannel();
            expose(obj, port2);
            returnValue = transfer(port1, [port1]);
          }
          break;
        case "RELEASE":
          {
            returnValue = void 0;
          }
          break;
        default:
          return;
      }
    } catch (value) {
      returnValue = { value, [throwMarker]: 0 };
    }
    Promise.resolve(returnValue).catch((value) => {
      return { value, [throwMarker]: 0 };
    }).then((returnValue2) => {
      const [wireValue, transferables] = toWireValue(returnValue2);
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
      if (type === "RELEASE") {
        ep.removeEventListener("message", callback);
        closeEndPoint(ep);
        if (finalizer in obj && typeof obj[finalizer] === "function") {
          obj[finalizer]();
        }
      }
    }).catch((error) => {
      const [wireValue, transferables] = toWireValue({
        value: new TypeError("Unserializable return value"),
        [throwMarker]: 0
      });
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
    });
  });
  if (ep.start) {
    ep.start();
  }
}
function isMessagePort(endpoint) {
  return endpoint.constructor.name === "MessagePort";
}
function closeEndPoint(endpoint) {
  if (isMessagePort(endpoint))
    endpoint.close();
}
function wrap(ep, target) {
  const pendingListeners = /* @__PURE__ */ new Map();
  ep.addEventListener("message", function handleMessage(ev) {
    const { data } = ev;
    if (!data || !data.id) {
      return;
    }
    const resolver = pendingListeners.get(data.id);
    if (!resolver) {
      return;
    }
    try {
      resolver(data);
    } finally {
      pendingListeners.delete(data.id);
    }
  });
  return createProxy(ep, pendingListeners, [], target);
}
function throwIfProxyReleased(isReleased) {
  if (isReleased) {
    throw new Error("Proxy has been released and is not useable");
  }
}
function releaseEndpoint(ep) {
  return requestResponseMessage(ep, /* @__PURE__ */ new Map(), {
    type: "RELEASE"
  }).then(() => {
    closeEndPoint(ep);
  });
}
var proxyCounter = /* @__PURE__ */ new WeakMap();
var proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((ep) => {
  const newCount = (proxyCounter.get(ep) || 0) - 1;
  proxyCounter.set(ep, newCount);
  if (newCount === 0) {
    releaseEndpoint(ep);
  }
});
function registerProxy(proxy2, ep) {
  const newCount = (proxyCounter.get(ep) || 0) + 1;
  proxyCounter.set(ep, newCount);
  if (proxyFinalizers) {
    proxyFinalizers.register(proxy2, ep, proxy2);
  }
}
function unregisterProxy(proxy2) {
  if (proxyFinalizers) {
    proxyFinalizers.unregister(proxy2);
  }
}
function createProxy(ep, pendingListeners, path = [], target = function() {
}) {
  let isProxyReleased = false;
  const proxy2 = new Proxy(target, {
    get(_target, prop) {
      throwIfProxyReleased(isProxyReleased);
      if (prop === releaseProxy) {
        return () => {
          unregisterProxy(proxy2);
          releaseEndpoint(ep);
          pendingListeners.clear();
          isProxyReleased = true;
        };
      }
      if (prop === "then") {
        if (path.length === 0) {
          return { then: () => proxy2 };
        }
        const r = requestResponseMessage(ep, pendingListeners, {
          type: "GET",
          path: path.map((p) => p.toString())
        }).then(fromWireValue);
        return r.then.bind(r);
      }
      return createProxy(ep, pendingListeners, [...path, prop]);
    },
    set(_target, prop, rawValue) {
      throwIfProxyReleased(isProxyReleased);
      const [value, transferables] = toWireValue(rawValue);
      return requestResponseMessage(ep, pendingListeners, {
        type: "SET",
        path: [...path, prop].map((p) => p.toString()),
        value
      }, transferables).then(fromWireValue);
    },
    apply(_target, _thisArg, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const last = path[path.length - 1];
      if (last === createEndpoint) {
        return requestResponseMessage(ep, pendingListeners, {
          type: "ENDPOINT"
        }).then(fromWireValue);
      }
      if (last === "bind") {
        return createProxy(ep, pendingListeners, path.slice(0, -1));
      }
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, pendingListeners, {
        type: "APPLY",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    },
    construct(_target, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, pendingListeners, {
        type: "CONSTRUCT",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    }
  });
  registerProxy(proxy2, ep);
  return proxy2;
}
function myFlat(arr) {
  return Array.prototype.concat.apply([], arr);
}
function processArguments(argumentList) {
  const processed = argumentList.map(toWireValue);
  return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))];
}
var transferCache = /* @__PURE__ */ new WeakMap();
function transfer(obj, transfers) {
  transferCache.set(obj, transfers);
  return obj;
}
function proxy(obj) {
  return Object.assign(obj, { [proxyMarker]: true });
}
function toWireValue(value) {
  for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
      const [serializedValue, transferables] = handler.serialize(value);
      return [
        {
          type: "HANDLER",
          name,
          value: serializedValue
        },
        transferables
      ];
    }
  }
  return [
    {
      type: "RAW",
      value
    },
    transferCache.get(value) || []
  ];
}
function fromWireValue(value) {
  switch (value.type) {
    case "HANDLER":
      return transferHandlers.get(value.name).deserialize(value.value);
    case "RAW":
      return value.value;
  }
}
function requestResponseMessage(ep, pendingListeners, msg, transfers) {
  return new Promise((resolve) => {
    const id = generateUUID();
    pendingListeners.set(id, resolve);
    if (ep.start) {
      ep.start();
    }
    ep.postMessage(Object.assign({ id }, msg), transfers);
  });
}
function generateUUID() {
  return new Array(4).fill(0).map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)).join("-");
}

// static/wasm/texlive/dist/manifest.js
async function loadManifest(url) {
  const r = await fetch(url, { cache: "force-cache" });
  if (!r.ok) {
    throw new Error(`Failed to load manifest from ${url}: HTTP ${r.status}`);
  }
  const json = await r.json();
  if (json.schema !== 1) {
    throw new Error(`Unsupported manifest schema: ${json.schema}`);
  }
  return json;
}
function expectedSha256(manifest, tdsPath) {
  return manifest.files[tdsPath]?.sha256 ?? null;
}
async function sha256Hex(bytes) {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function assertSha256(bytes, expected, what) {
  const actual = await sha256Hex(bytes);
  if (actual !== expected.toLowerCase()) {
    throw new Error(
      `texlive-wasm: integrity check failed for ${what}: expected sha256 ${expected}, got ${actual}`
    );
  }
}

// static/wasm/texlive/dist/paths-FjePC1PO.js
function safeRelativePath(path) {
  const segments = path.split(/[/\\]+/).filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return null;
  if (segments.some((s) => s === "..")) return null;
  if (/^[a-z]:$/i.test(segments[0])) return null;
  if (segments.some((s) => s.includes("\0"))) return null;
  return segments.join("/");
}

// static/wasm/texlive/dist/bundlefs-CUNRa0dT.js
var MAX_TAR_ENTRIES = 25e4;
function untar(bytes, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_TAR_ENTRIES;
  const out = [];
  const decoder = new TextDecoder();
  let offset = 0;
  let pendingLongName = null;
  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    if (isAllZero(block)) {
      break;
    }
    const name = readCString(block, 0, 100);
    const size = parseOctal(block, 124, 12);
    const typeflag = String.fromCharCode(block[156] ?? 0);
    const prefix = readCString(block, 345, 155);
    const fullPath = pendingLongName ?? (prefix ? prefix + "/" + name : name);
    pendingLongName = null;
    offset += 512;
    if (size < 0 || !Number.isSafeInteger(size) || offset + size > bytes.length) {
      throw new Error(
        `texlive-wasm: tar entry "${fullPath}" declares ${size} bytes, past the end of the archive`
      );
    }
    const contentBlocks = Math.ceil(size / 512);
    const content = bytes.subarray(offset, offset + size);
    offset += contentBlocks * 512;
    if (out.length >= maxEntries) {
      throw new Error(
        `texlive-wasm: tar archive has more than ${maxEntries} entries; refusing to continue`
      );
    }
    if (typeflag === "L") {
      pendingLongName = decoder.decode(content).replace(/\0+$/, "");
      continue;
    }
    if (typeflag === "x") {
      const paxPath = parsePaxPath(decoder.decode(content));
      if (paxPath) pendingLongName = paxPath;
      continue;
    }
    if (typeflag === "g") {
      continue;
    }
    const type = typeflag === "5" ? "dir" : typeflag === "0" || typeflag === "\0" ? "file" : "other";
    out.push({ path: fullPath, content: type === "file" ? content : new Uint8Array(), type });
  }
  return out;
}
function parsePaxPath(body) {
  let i = 0;
  while (i < body.length) {
    const space = body.indexOf(" ", i);
    if (space < 0) break;
    const len = Number(body.slice(i, space));
    if (!Number.isFinite(len) || len <= 0) break;
    const record = body.slice(space + 1, i + len);
    const eq = record.indexOf("=");
    if (eq > 0 && record.slice(0, eq) === "path") {
      return record.slice(eq + 1).replace(/\n$/, "");
    }
    i += len;
  }
  return null;
}
function readCString(block, start, len) {
  let end = start;
  while (end < start + len && block[end] !== 0) end++;
  return new TextDecoder().decode(block.subarray(start, end));
}
function parseOctal(block, start, len) {
  let n = 0;
  for (let i = start; i < start + len; i++) {
    const c = block[i];
    if (c === void 0 || c === 0 || c === 32) continue;
    if (c < 48 || c > 55) break;
    n = n * 8 + (c - 48);
  }
  return n;
}
function isAllZero(block) {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}
var MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
async function decompress(bytes, format, maxBytes = MAX_DECOMPRESSED_BYTES) {
  const Ctor = globalThis.DecompressionStream;
  if (!Ctor) {
    throw new Error(`DecompressionStream not available; can't decompress ${format}`);
  }
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const stream = new Blob([ab]).stream().pipeThrough(new Ctor(format)).pipeThrough(limitBytes(maxBytes, format));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
function limitBytes(maxBytes, format) {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(
          new Error(
            `texlive-wasm: ${format} stream expands past the ${maxBytes}-byte limit; refusing to continue`
          )
        );
        return;
      }
      controller.enqueue(chunk);
    }
  });
}
var MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
async function createBundleFs(opts) {
  const files = /* @__PURE__ */ new Map();
  const stripPrefix = opts.stripPrefix ?? "texmf/";
  async function load() {
    let bytes = opts.bundleBytes;
    let bundleUrl = opts.bundleUrl;
    let expectedSha = opts.sha256;
    if (!bytes && !bundleUrl && opts.manifestUrl) {
      const manifest = await loadManifest(opts.manifestUrl);
      if (manifest.coreBundleUrl) {
        bundleUrl = new URL(manifest.coreBundleUrl, absolutize(opts.manifestUrl)).toString();
        expectedSha ??= manifest.coreBundleSha256 ?? void 0;
      }
    }
    if (!bytes && bundleUrl) {
      requireIntegrity(bundleUrl, expectedSha, opts.allowUnverified === true);
      const r = await fetch(bundleUrl);
      if (!r.ok) throw new Error(`BundleFs: HTTP ${r.status} for ${bundleUrl}`);
      bytes = new Uint8Array(await r.arrayBuffer());
      const maxCompressed = opts.maxCompressedBytes ?? MAX_COMPRESSED_BYTES;
      if (bytes.byteLength > maxCompressed) {
        throw new Error(
          `BundleFs: ${bundleUrl} is ${bytes.byteLength} bytes, past the ${maxCompressed}-byte download limit; refusing to unpack it`
        );
      }
    }
    if (!bytes) return;
    if (expectedSha) {
      await assertSha256(bytes, expectedSha, bundleUrl ?? "bundle");
    }
    const format = opts.format ?? detectFormat(bundleUrl, bytes);
    if (!format) {
      throw new Error(
        `BundleFs: cannot tell what ${bundleUrl ?? "the supplied bundle"} is compressed with \u2014 it is neither gzip nor a plain tar. Brotli has no magic bytes, so name the file .tar.br or pass format: 'br' explicitly.`
      );
    }
    const tar = format === "raw" ? bytes : await decompress(bytes, format, opts.maxBytes);
    let rejected = 0;
    let firstRejected = "";
    let duplicates = 0;
    for (const entry of untar(tar)) {
      if (entry.type !== "file") continue;
      let path = entry.path;
      if (path.startsWith(stripPrefix)) path = path.slice(stripPrefix.length);
      const safe = path.startsWith("/") ? null : safeRelativePath(path);
      if (!safe) {
        rejected++;
        firstRejected ||= entry.path;
        continue;
      }
      if (files.has(safe)) {
        duplicates++;
        continue;
      }
      files.set(safe, entry.content);
    }
    if (rejected > 0) {
      console.warn(
        `texlive-wasm: BundleFs dropped ${rejected} archive entr${rejected === 1 ? "y" : "ies"} with an escaping path (first: ${firstRejected}) from ${bundleUrl ?? "the supplied bundle"}`
      );
    }
    if (duplicates > 0) {
      console.warn(
        `texlive-wasm: BundleFs dropped ${duplicates} duplicate archive entr${duplicates === 1 ? "y" : "ies"} from ${bundleUrl ?? "the supplied bundle"}; the first copy of each name is the one served`
      );
    }
  }
  return {
    id: "bundlefs",
    read(tdsPath) {
      return files.get(stripLeading(tdsPath)) ?? null;
    },
    exists(tdsPath) {
      return files.has(stripLeading(tdsPath));
    },
    list(prefix) {
      const p = stripLeading(prefix);
      const out = [];
      for (const path of files.keys()) {
        if (path.startsWith(p)) out.push(path);
      }
      return out;
    },
    async init() {
      await load();
    }
  };
}
function stripLeading(p) {
  return p.replace(/^\/+/, "");
}
function requireIntegrity(bundleUrl, sha256, allow) {
  if (sha256 || allow || isSameOrigin(bundleUrl)) return;
  throw new Error(
    `BundleFs: refusing to load ${bundleUrl} \u2014 no SHA-256 for it. Publish the digest in the manifest (coreBundleSha256), pass it as \`sha256\`, or serve the bundle from the app's own origin. For development only, set allowUnverified/allowUnverifiedAssets.`
  );
}
function isSameOrigin(url) {
  if (typeof location === "undefined") return false;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}
function absolutize(url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const origin = typeof location !== "undefined" ? location.href : "file:///";
  return new URL(url, origin).toString();
}
function detectFormat(url, bytes) {
  if (url) {
    const path = url.split(/[?#]/)[0] ?? url;
    if (path.endsWith(".tar.gz") || path.endsWith(".tgz")) return "gzip";
    if (path.endsWith(".tar.br")) return "br";
    if (path.endsWith(".tar")) return "raw";
  }
  if (bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139) return "gzip";
  if (bytes.length >= 262 && bytes[257] === 117 && // u
  bytes[258] === 115 && // s
  bytes[259] === 116 && // t
  bytes[260] === 97 && // a
  bytes[261] === 114) {
    return "raw";
  }
  return null;
}

// static/wasm/texlive/dist/index.js
async function createOpfsFs(opts = {}) {
  const rootName = opts.rootName ?? "texlive-wasm";
  const version = opts.version ?? "unversioned";
  const root = await navigator.storage.getDirectory();
  const tlRoot = await root.getDirectoryHandle(rootName, { create: true });
  const versionRoot = await tlRoot.getDirectoryHandle(safeSegment(version), { create: true });
  const fullDir = await versionRoot.getDirectoryHandle("full", { create: true });
  const cdnDir = await versionRoot.getDirectoryHandle("cdn", { create: true });
  async function walkTo(dir, tdsPath, create) {
    const safe = safeRelativePath(tdsPath);
    if (!safe) return null;
    const parts = safe.split("/");
    let cur = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      try {
        cur = await cur.getDirectoryHandle(parts[i], { create });
      } catch {
        return null;
      }
    }
    return { dir: cur, name: parts[parts.length - 1] };
  }
  async function readFrom(dir, tdsPath) {
    const loc = await walkTo(dir, tdsPath, false);
    if (!loc) return null;
    try {
      const fh = await loc.dir.getFileHandle(loc.name, { create: false });
      const file = await fh.getFile();
      const ab = await file.arrayBuffer();
      return new Uint8Array(ab);
    } catch {
      return null;
    }
  }
  return {
    id: "opfsfs",
    async read(tdsPath) {
      return await readFrom(fullDir, tdsPath) ?? await readFrom(cdnDir, tdsPath);
    },
    async write(tdsPath, bytes) {
      try {
        const loc = await walkTo(cdnDir, tdsPath, true);
        if (!loc) return;
        const fh = await loc.dir.getFileHandle(loc.name, { create: true });
        const writable = await fh.createWritable();
        await writable.write(bytes);
        await writable.close();
      } catch {
      }
    }
  };
}
function safeSegment(name) {
  return name.replace(/[^\w.-]+/g, "_") || "unversioned";
}
function createFetchFs(opts) {
  const base = opts.cdnBaseUrl.endsWith("/") ? opts.cdnBaseUrl : opts.cdnBaseUrl + "/";
  return {
    id: "fetchfs",
    async read(tdsPath) {
      const safePath = safeRelativePath(tdsPath);
      if (!safePath) return null;
      const url = base + safePath.split("/").map(encodeURIComponent).join("/");
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`FETCHFS: HTTP ${r.status} for ${tdsPath}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (opts.verify && !await opts.verify(safePath, buf)) return null;
      await opts.onFetched?.(tdsPath, buf);
      return buf;
    }
  };
}
async function defaultBackends(_id, config, options = {}) {
  const layers = [];
  let manifest = null;
  if (config.manifestUrl) {
    try {
      manifest = await loadManifest(config.manifestUrl);
    } catch (err) {
      console.warn(
        `texlive-wasm: could not load manifest ${config.manifestUrl} (${String(err)}); cached and CDN files will not be integrity-checked`
      );
    }
  }
  const allowUnverified = config.allowUnverifiedAssets === true;
  if (config.cdnBaseUrl && !manifest && !allowUnverified) {
    throw new Error(
      `texlive-wasm: cdnBaseUrl is set but no manifest could be loaded, so CDN files cannot be integrity-checked. Set manifestUrl (its per-file sha256 is what verifies them), or set allowUnverifiedAssets: true for development.`
    );
  }
  if (config.manifestUrl && !options.skipManifestBundle) {
    layers.push(await createBundleFs({ manifestUrl: config.manifestUrl, allowUnverified }));
  }
  let opfs = null;
  if (isOpfsAvailable()) {
    opfs = await createOpfsFs(manifest ? { version: manifest.version } : {});
    layers.push(manifest ? withIntegrity(opfs, manifest) : opfs);
  }
  if (config.cdnBaseUrl) {
    const cache = opfs;
    const index = manifest;
    layers.push(
      createFetchFs({
        cdnBaseUrl: config.cdnBaseUrl,
        // Write-through: CDN hits are persisted into the OPFS cdn/ tier so
        // the next session reads them locally.
        ...cache ? { onFetched: (tdsPath, bytes) => cache.write(tdsPath, bytes) } : {},
        // Verified BEFORE the write-through fires, or a poisoned response
        // would be the thing we cache.
        ...index ? { verify: (tdsPath, bytes) => matches(index, tdsPath, bytes) } : {}
      })
    );
  }
  return layers;
}
function withIntegrity(backend, manifest) {
  const wrapped = {
    id: backend.id,
    async read(tdsPath) {
      const bytes = await backend.read(tdsPath);
      if (!bytes) return null;
      return await matches(manifest, tdsPath, bytes) ? bytes : null;
    }
  };
  if (backend.exists) wrapped.exists = (p) => backend.exists(p);
  if (backend.list) wrapped.list = (p) => backend.list(p);
  if (backend.init) wrapped.init = () => backend.init();
  if (backend.dispose) wrapped.dispose = () => backend.dispose();
  return wrapped;
}
async function matches(manifest, tdsPath, bytes) {
  const expected = expectedSha256(manifest, tdsPath.replace(/^\/+/, ""));
  if (!expected) return true;
  const actual = await sha256Hex(bytes);
  if (actual === expected.toLowerCase()) return true;
  console.warn(
    `texlive-wasm: integrity check failed for ${tdsPath} (expected ${expected}, got ${actual}); discarding those bytes`
  );
  return false;
}
function isOpfsAvailable() {
  return typeof navigator !== "undefined" && typeof navigator.storage !== "undefined" && typeof navigator.storage.getDirectory === "function";
}
var DEFAULT_CONFIG = {
  useWorker: typeof Worker !== "undefined",
  verbose: "silent"
};
var DISPOSE_GRACE_MS = 2e3;
async function createEngine(id, config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const bundleInWorker = merged.useWorker === true && !merged.vfs && !!merged.manifestUrl;
  const backends = merged.vfs ?? await defaultBackends(id, merged, { skipManifestBundle: bundleInWorker });
  if (merged.useWorker) {
    return createWorkerEngine(id, merged, backends, bundleInWorker);
  }
  return createInProcessEngine(id);
}
function makeBackendHost(backends) {
  return {
    async read(i, tdsPath) {
      return await backends[i].read(tdsPath) ?? null;
    },
    async exists(i, tdsPath) {
      const b = backends[i];
      if (b.exists) return b.exists(tdsPath);
      return await b.read(tdsPath) != null;
    },
    async list(i, tdsPrefix) {
      const b = backends[i];
      return b.list ? await b.list(tdsPrefix) : [];
    },
    async init(i) {
      await backends[i].init?.();
    },
    async dispose(i) {
      await backends[i].dispose?.();
    }
  };
}
async function createWorkerEngine(id, config, backends, bundleFromManifest = false) {
  const worker = new Worker(new URL(
    /* @vite-ignore */
    // NeoLeaf patch: the worker URL keeps the "?v=<build>" of this module, so a new release is never served from the browser cache
    "" + new URL("./worker.js" + new URL(import.meta.url).search, import.meta.url).href,
    import.meta.url
  ), {
    type: "module",
    name: "texlive-wasm-worker"
  });
  const workerFailed = new Promise((_, reject) => {
    worker.addEventListener("error", (event) => {
      const msg = event.message || "worker failed to load";
      reject(new Error(`texlive-wasm: engine worker error: ${msg}`));
    });
  });
  const api = wrap(worker);
  const { vfs: _vfs, ...cloneableConfig } = config;
  const backendMeta = backends.map((b) => ({
    id: b.id,
    hasList: typeof b.list === "function",
    hasInit: typeof b.init === "function",
    hasDispose: typeof b.dispose === "function"
  }));
  try {
    await Promise.race([
      api.init(
        {
          engineId: id,
          config: cloneableConfig,
          backendMeta,
          ...bundleFromManifest ? { bundleFromManifest: true } : {}
        },
        proxy(makeBackendHost(backends))
      ),
      workerFailed
    ]);
  } catch (err) {
    worker.terminate();
    throw err;
  }
  let ready = true;
  let queue = Promise.resolve();
  let killRun = () => {
  };
  const killed = new Promise((_, reject) => {
    killRun = reject;
  });
  killed.catch(() => {
  });
  const terminate = (reason) => {
    ready = false;
    worker.terminate();
    killRun(new Error(`Engine ${id}: ${reason}`));
  };
  const doRun = async (options) => {
    if (!ready) throw new Error(`Engine ${id} has been disposed`);
    const { signal, ...runOptions } = options;
    if (signal?.aborted) throw new Error(`Engine ${id}: run aborted before it started`);
    let timer;
    const onAbort = () => terminate("run aborted; worker terminated");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (options.timeoutMs !== void 0) {
      timer = setTimeout(
        () => terminate(`run exceeded timeoutMs=${options.timeoutMs}; worker terminated`),
        options.timeoutMs
      );
    }
    try {
      return await Promise.race([api.run(runOptions), killed]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
  return {
    id,
    config,
    async run(options) {
      const result = queue.then(() => doRun(options));
      queue = result.catch(() => {
      });
      return result;
    },
    async dispose() {
      if (!ready) return;
      ready = false;
      try {
        await Promise.race([
          api.dispose(),
          new Promise((resolve) => setTimeout(resolve, DISPOSE_GRACE_MS))
        ]);
      } finally {
        worker.terminate();
        killRun(new Error(`Engine ${id} was disposed while a run was in flight`));
      }
    },
    isReady() {
      return ready;
    }
  };
}
async function createInProcessEngine(id, _config, _backends) {
  throw new Error(
    `texlive-wasm: running ${id} outside a Web Worker (Node / WASI) is not implemented yet. The engines currently require a browser, Tauri WebView, or another Worker-capable host.`
  );
}
function noop() {
}
function createEngineManager(options) {
  const maxLive = Math.max(1, options.maxLiveEngines ?? 3);
  const slots = /* @__PURE__ */ new Map();
  let clock = 0;
  function get(id) {
    const existing = slots.get(id);
    if (existing) {
      existing.lastUsed = ++clock;
      return existing;
    }
    const evicted = evictIdle();
    options.onLoad?.(id);
    const promise = evicted.then(() => createEngine(id, options.config(id)));
    const slot = {
      promise,
      leased: promise.then((handle) => lease(id, handle)),
      current: null,
      pins: 0,
      lastUsed: ++clock
    };
    slots.set(id, slot);
    promise.then((handle) => {
      slot.current = handle;
    }, noop);
    const forget = () => {
      if (slots.get(id) === slot) slots.delete(id);
    };
    promise.catch(forget);
    slot.leased.catch(forget);
    return slot;
  }
  function evictIdle() {
    if (slots.size < maxLive) return Promise.resolve();
    let victim = null;
    let oldest = Infinity;
    for (const [id, slot2] of slots) {
      if (slot2.pins === 0 && slot2.lastUsed < oldest) {
        oldest = slot2.lastUsed;
        victim = id;
      }
    }
    if (!victim) return Promise.resolve();
    const slot = slots.get(victim);
    slots.delete(victim);
    options.onEvict?.(victim);
    return slot.promise.then(
      (h) => h.dispose(),
      () => {
      }
      // a slot that never loaded has nothing to dispose
    );
  }
  function lease(id, handle) {
    return {
      id: handle.id,
      config: handle.config,
      async run(runOptions) {
        const slot = get(id);
        slot.pins++;
        try {
          const live = await slot.promise;
          return await live.run(runOptions);
        } finally {
          slot.pins--;
        }
      },
      // Disposing the worker behind the manager's back would leave the slot
      // handing out a dead handle.
      dispose: () => manager.dispose(id),
      // Answer for the engine the next run() would use, not for the worker
      // this lease was minted around: that one may have been evicted since,
      // and run() would transparently reload it. Reporting the dead worker
      // would have a leased handle claim "not ready" forever after an
      // eviction it is designed to survive.
      isReady: () => slots.get(id)?.current?.isReady() ?? false
    };
  }
  const manager = {
    engine: (id) => get(id).leased,
    async withEngines(ids, fn) {
      const pinned = ids.map((id) => {
        const slot = get(id);
        slot.pins++;
        return slot;
      });
      try {
        const handles = /* @__PURE__ */ new Map();
        for (let i = 0; i < ids.length; i++) {
          handles.set(ids[i], await pinned[i].leased);
        }
        return await fn(handles);
      } finally {
        for (const slot of pinned) slot.pins--;
      }
    },
    live: () => [...slots.keys()],
    async dispose(id) {
      const targets = id ? [id] : [...slots.keys()];
      await Promise.allSettled(
        targets.map((t) => {
          const slot = slots.get(t);
          if (!slot) return Promise.resolve();
          slots.delete(t);
          return slot.promise.then((h) => h.dispose());
        })
      );
    }
  };
  return manager;
}
var DEFAULT_RUN_TIMEOUT_MS = 3e5;
function limitsOf(options) {
  return {
    ...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
    ...options.signal !== void 0 ? { signal: options.signal } : {}
  };
}
var BaseEngineWrapper = class {
  constructor(options = {}) {
    this.options = options;
    if (options.engine) this.handle = options.engine;
  }
  handle = null;
  async ensureHandle() {
    if (this.handle) return this.handle;
    const { engine: _ignored, ...config } = this.options;
    this.handle = await createEngine(this.engineId, config);
    return this.handle;
  }
  /** Drop the worker if this wrapper owns one. */
  async dispose() {
    if (this.handle && !this.options.engine) {
      await this.handle.dispose();
      this.handle = null;
    }
  }
  async runRaw(args, files, extra = {}) {
    const handle = await this.ensureHandle();
    const opts = {
      args,
      files,
      cwd: extra.cwd ?? "/project"
    };
    const timeoutMs = extra.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    if (timeoutMs > 0) opts.timeoutMs = timeoutMs;
    if (extra.signal !== void 0) opts.signal = extra.signal;
    if (extra.env !== void 0) opts.env = extra.env;
    return handle.run(opts);
  }
};
var PdfLatex = class extends BaseEngineWrapper {
  engineId = "pdflatex";
  async compile(options) {
    const args = [
      "--no-shell-escape",
      `--interaction=${options.interaction ?? "nonstopmode"}`,
      ...options.haltOnError !== false ? ["--halt-on-error"] : [],
      `--output-format=${options.outputFormat ?? "pdf"}`,
      ...options.extraArgs ?? [],
      options.mainTex
    ];
    return this.runRaw(args, options.files ?? [], limitsOf(options));
  }
};
var XeLatex = class extends BaseEngineWrapper {
  engineId = "xelatex";
  async compile(options) {
    const args = [
      "--no-shell-escape",
      `--interaction=${options.interaction ?? "nonstopmode"}`,
      ...options.haltOnError !== false ? ["--halt-on-error"] : [],
      ...options.noPdf !== false ? ["--no-pdf"] : [],
      ...options.extraArgs ?? [],
      options.mainTex
    ];
    return this.runRaw(args, options.files ?? [], limitsOf(options));
  }
};
var LuaLatex = class extends BaseEngineWrapper {
  engineId = "lualatex";
  async compile(options) {
    const args = [
      "--no-shell-escape",
      `--interaction=${options.interaction ?? "nonstopmode"}`,
      ...options.haltOnError !== false ? ["--halt-on-error"] : [],
      ...options.noSocket !== false ? ["--nosocket"] : [],
      ...options.extraArgs ?? [],
      options.mainTex
    ];
    return this.runRaw(args, options.files ?? [], limitsOf(options));
  }
};
var Bibtexu = class extends BaseEngineWrapper {
  engineId = "bibtexu";
  async run(options) {
    const args = [...options.extraArgs ?? [], options.auxFile];
    return this.runRaw(args, options.files ?? [], limitsOf(options));
  }
};
var Biber = class extends BaseEngineWrapper {
  engineId = "biber";
  async run(options) {
    const jobname = options.jobname.replace(/\.bcf$/i, "");
    const args = ["/biber/bin/biber", "--noconf", ...options.extraArgs ?? [], jobname];
    return this.runRaw(args, options.files ?? [], limitsOf(options));
  }
};
var Makeindex = class extends BaseEngineWrapper {
  engineId = "makeindex";
  async run(options) {
    const args = [
      ...options.style ? ["-s", options.style] : [],
      ...options.output ? ["-o", options.output] : [],
      ...options.extraArgs ?? [],
      options.idxFile
    ];
    return this.runRaw(args, options.files ?? [], limitsOf(options));
  }
};
var Xdvipdfmx = class extends BaseEngineWrapper {
  engineId = "xdvipdfmx";
  async run(options) {
    const args = ["-o", options.pdf, ...options.extraArgs ?? [], options.xdv];
    return this.runRaw(args, options.files ?? [], limitsOf(options));
  }
};
var RERUN_PATTERNS = [
  /Rerun to get cross-references right/,
  /Rerun to get citations correct/,
  /Label\(s\) may have changed/,
  /No file [^.]+\.toc/,
  /Package rerunfilecheck Warning/,
  // biblatex's generic rerun request (it settles labels/backrefs late).
  /Please rerun LaTeX/,
  /Please \(re\)run Biber/
];
var DEFAULT_MAX_PASSES = 4;
var BIBLATEX_MAX_PASSES = 5;
async function latexmk(opts) {
  const stripExt = (p) => p.replace(/\.tex$/i, "");
  const base = stripExt(opts.mainTex).split("/").pop();
  const auxPath = `${base}.aux`;
  const bcfPath = `${base}.bcf`;
  const idxPath = `${base}.idx`;
  const xdvPath = `${base}.xdv`;
  const pdfPath = `${base}.pdf`;
  const logPath = `${base}.log`;
  const synctexPath = `${base}.synctex.gz`;
  const logs = [];
  const isXetex = opts.engine === "xelatex";
  const biblatexMode = usesBiblatex(opts.files);
  const rerunMode = opts.rerun ?? "auto";
  const maxPasses = rerunMode === false ? 1 : typeof rerunMode === "object" ? Math.max(1, rerunMode.maxPasses) : biblatexMode ? BIBLATEX_MAX_PASSES : DEFAULT_MAX_PASSES;
  const needBibtex = resolveAuto(opts.bibtex, () => detectBibtex(opts.files, biblatexMode));
  const needBiber = !needBibtex && resolveAuto(opts.biber, () => biblatexMode && !biblatexBackendIsBibtex(opts.files));
  const needMakeindex = resolveAuto(opts.makeindex, () => detectMakeindex(opts.files));
  const texExtraArgs = opts.synctex ? ["-synctex=1"] : [];
  let lastAux = null;
  let lastBcf = null;
  let lastIdx = null;
  let pass = 0;
  let exitCode = 0;
  let outputs = /* @__PURE__ */ new Map();
  const materialize = () => {
    const merged = /* @__PURE__ */ new Map();
    for (const f of opts.files) merged.set(f.path.replace(/^\/+/, ""), f);
    for (const [path, content] of outputs) merged.set(path, { path, content });
    return [...merged.values()];
  };
  const tex = buildTexEngine(opts);
  let bibtexWrapper = null;
  let biberWrapper = null;
  let makeindexWrapper = null;
  let xdvipdfmxWrapper = null;
  const pushLog = (cmd, r) => {
    logs.push({ cmd, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, log: r.log });
  };
  const deadline = opts.timeoutMs !== void 0 ? performance.now() + opts.timeoutMs : null;
  const budget = () => {
    const limits = {};
    if (opts.signal) limits.signal = opts.signal;
    if (deadline !== null) {
      const left = Math.ceil(deadline - performance.now());
      if (left <= 0) {
        throw new Error(`latexmk: pipeline exceeded timeoutMs=${opts.timeoutMs}`);
      }
      limits.timeoutMs = left;
    }
    return limits;
  };
  try {
    while (pass < maxPasses) {
      pass++;
      const result2 = await tex.compile({
        mainTex: opts.mainTex,
        files: pass === 1 ? opts.files : materialize(),
        extraArgs: texExtraArgs,
        ...budget(),
        // XeTeX in WASM cannot spawn xdvipdfmx itself (no popen); we always
        // hold the .xdv and finalize with our own xdvipdfmx pass below.
        ...isXetex ? { noPdf: true } : {}
      });
      pushLog(`${opts.engine} ${opts.mainTex}`, result2);
      exitCode = result2.exitCode;
      outputs = mergeOutputs(outputs, result2.outputs);
      if (exitCode !== 0) break;
      let helpersRan = false;
      if (pass === 1 && needBibtex && outputs.has(auxPath)) {
        bibtexWrapper ??= new Bibtexu(wrapperConfig(opts, "bibtexu", opts.handles?.bibtex));
        const r = await bibtexWrapper.run({
          auxFile: auxPath,
          files: materialize(),
          ...budget(),
          // biblatex's aux needs bibtex8's "wolfgang" capacity mode; the
          // switch is harmless for classic .bst documents but only biblatex
          // requires it, so keep classic invocations byte-identical.
          ...biblatexMode ? { extraArgs: ["--wolfgang"] } : {}
        });
        pushLog(`bibtexu ${auxPath}`, r);
        outputs = mergeOutputs(outputs, r.outputs);
        if (r.exitCode >= 2) {
          exitCode = r.exitCode;
          break;
        }
        helpersRan = true;
      }
      if (needBiber && outputs.has(bcfPath)) {
        const bcfNow = bytesToString(outputs.get(bcfPath));
        if (bcfNow !== lastBcf) {
          lastBcf = bcfNow;
          biberWrapper ??= new Biber(wrapperConfig(opts, "biber", opts.handles?.biber));
          const r = await biberWrapper.run({ jobname: base, files: materialize(), ...budget() });
          pushLog(`biber ${base}`, r);
          outputs = mergeOutputs(outputs, r.outputs);
          if (r.exitCode >= 2) {
            exitCode = r.exitCode;
            break;
          }
          helpersRan = true;
        }
      }
      if (needMakeindex && outputs.has(idxPath)) {
        const idxNow = bytesToString(outputs.get(idxPath));
        if (idxNow !== lastIdx) {
          lastIdx = idxNow;
          makeindexWrapper ??= new Makeindex(
            wrapperConfig(opts, "makeindex", opts.handles?.makeindex)
          );
          const r = await makeindexWrapper.run({
            idxFile: idxPath,
            files: materialize(),
            ...budget()
          });
          pushLog(`makeindex ${idxPath}`, r);
          outputs = mergeOutputs(outputs, r.outputs);
          if (r.exitCode !== 0) {
            exitCode = r.exitCode;
            break;
          }
          helpersRan = true;
        }
      }
      if (pass >= maxPasses) break;
      const aux = bytesToString(outputs.get(auxPath));
      const log = bytesToString(outputs.get(logPath));
      const rerunRequested = RERUN_PATTERNS.some((re) => re.test(log));
      const auxStable = lastAux !== null && aux === lastAux;
      lastAux = aux;
      if (helpersRan) continue;
      if (auxStable && !rerunRequested) break;
    }
    if (isXetex && exitCode === 0 && outputs.has(xdvPath)) {
      xdvipdfmxWrapper ??= new Xdvipdfmx(wrapperConfig(opts, "xdvipdfmx", opts.handles?.xdvipdfmx));
      const r = await xdvipdfmxWrapper.run({
        xdv: xdvPath,
        pdf: pdfPath,
        files: materialize(),
        ...budget()
      });
      pushLog(`xdvipdfmx -o ${pdfPath} ${xdvPath}`, r);
      outputs = mergeOutputs(outputs, r.outputs);
      if (r.exitCode !== 0) exitCode = r.exitCode;
    }
  } finally {
    await Promise.allSettled(
      [tex, bibtexWrapper, biberWrapper, makeindexWrapper, xdvipdfmxWrapper].filter((w) => w !== null).map((w) => w.dispose())
    );
  }
  const result = {
    success: exitCode === 0 && outputs.has(pdfPath),
    log: bytesToString(outputs.get(logPath)),
    logs,
    exitCode,
    passes: pass
  };
  const pdf = outputs.get(pdfPath);
  if (pdf) result.pdf = pdf;
  const synctex = outputs.get(synctexPath);
  if (synctex) result.synctex = synctex;
  return result;
}
function resolveAuto(value, autoFn) {
  if (value === true) return true;
  if (value === false) return false;
  return autoFn();
}
function contentToString(content) {
  if (typeof content === "string") return content;
  return new TextDecoder("utf-8", { fatal: false }).decode(content);
}
var BIBLATEX_LOAD = /\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{\s*biblatex\s*\}/;
var BIBLATEX_PASS_OPTS = /\\PassOptionsToPackage\s*\{([^}]*)\}\s*\{\s*biblatex\s*\}/;
var BACKEND_BIBTEX = /backend\s*=\s*bibtex8?\s*(?:[,\]}]|$)/m;
function usesBiblatex(files) {
  return files.some((f) => BIBLATEX_LOAD.test(contentToString(f.content)));
}
function biblatexBackendIsBibtex(files) {
  return files.some((f) => {
    const text = contentToString(f.content);
    const load = BIBLATEX_LOAD.exec(text);
    if (load?.[1] && BACKEND_BIBTEX.test(load[1])) return true;
    const pass = BIBLATEX_PASS_OPTS.exec(text);
    return pass?.[1] !== void 0 && BACKEND_BIBTEX.test(pass[1]);
  });
}
function willRunBibtex(files) {
  return detectBibtex(files, usesBiblatex(files));
}
function willRunBiber(files) {
  return usesBiblatex(files) && !biblatexBackendIsBibtex(files);
}
function detectBibtex(files, biblatexMode) {
  if (biblatexMode) return biblatexBackendIsBibtex(files);
  return files.some((f) => contentToString(f.content).includes("\\bibliography{"));
}
function detectMakeindex(files) {
  return files.some((f) => {
    const text = contentToString(f.content);
    return text.includes("\\makeindex") || text.includes("\\printindex");
  });
}
function bytesToString(bytes) {
  if (!bytes) return "";
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
function mergeOutputs(base, add) {
  for (const [k, v] of add) base.set(k, v);
  return base;
}
function wrapperConfig(opts, id, handle) {
  if (handle) return { engine: handle };
  const config = typeof opts.engineConfig === "function" ? opts.engineConfig(id) : opts.engineConfig ?? {};
  const { useWorker: _useWorker, ...wrapperSafe } = config;
  return {
    ...wrapperSafe,
    ...opts.verbose ? { verbose: opts.verbose } : {}
  };
}
function buildTexEngine(opts) {
  const config = wrapperConfig(opts, opts.engine, opts.handles?.tex);
  if (opts.engine === "pdflatex") return new PdfLatex(config);
  if (opts.engine === "xelatex") return new XeLatex(config);
  return new LuaLatex(config);
}
function strFromU8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}
async function gunzip(bytes) {
  const Ctor = globalThis.DecompressionStream;
  if (!Ctor) {
    throw new Error(
      "DecompressionStream is not available; ship a gzip polyfill or upgrade Node/browser."
    );
  }
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const stream = new Blob([ab]).stream().pipeThrough(new Ctor("gzip"));
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}
async function createSynctex(bytes) {
  const decompressed = isGzip(bytes) ? await gunzip(bytes) : bytes;
  const text = strFromU8(decompressed);
  const parsed = parseSynctex(text);
  return {
    forward(_file, _line, _column) {
      return [];
    },
    reverse(_page, _x, _y) {
      return [];
    },
    files() {
      return Object.values(parsed.inputs);
    }
  };
}
function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139;
}
function parseSynctex(text) {
  const inputs = {};
  const records = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("Input:")) {
      const rest = line.slice("Input:".length);
      const colon = rest.indexOf(":");
      if (colon > 0) {
        const id = rest.slice(0, colon);
        const name = rest.slice(colon + 1);
        inputs[id] = name;
      }
    } else if (line.length > 0) {
      records.push(line);
    }
  }
  return { inputs, records };
}
export {
  Biber,
  Bibtexu,
  DEFAULT_RUN_TIMEOUT_MS,
  LuaLatex,
  Makeindex,
  PdfLatex,
  Xdvipdfmx,
  XeLatex,
  createBundleFs,
  createEngine,
  createEngineManager,
  createFetchFs,
  createOpfsFs,
  createSynctex,
  defaultBackends,
  expectedSha256,
  latexmk,
  loadManifest,
  sha256Hex,
  willRunBiber,
  willRunBibtex,
  withIntegrity
};
/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
