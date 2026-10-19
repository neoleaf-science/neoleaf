(async ()=>{
    const proxyMarker = Symbol("Comlink.proxy");
    const createEndpoint = Symbol("Comlink.endpoint");
    const releaseProxy = Symbol("Comlink.releaseProxy");
    const finalizer = Symbol("Comlink.finalizer");
    const throwMarker = Symbol("Comlink.thrown");
    const isObject = (val)=>(typeof val === "object" && val !== null) || typeof val === "function";
    const proxyTransferHandler = {
        canHandle: (val)=>isObject(val) && val[proxyMarker],
        serialize (obj) {
            const { port1, port2 } = new MessageChannel();
            expose(obj, port1);
            return [
                port2,
                [
                    port2
                ]
            ];
        },
        deserialize (port) {
            port.start();
            return wrap(port);
        }
    };
    const throwTransferHandler = {
        canHandle: (value)=>isObject(value) && throwMarker in value,
        serialize ({ value }) {
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
                serialized = {
                    isError: false,
                    value
                };
            }
            return [
                serialized,
                []
            ];
        },
        deserialize (serialized) {
            if (serialized.isError) {
                throw Object.assign(new Error(serialized.value.message), serialized.value);
            }
            throw serialized.value;
        }
    };
    const transferHandlers = new Map([
        [
            "proxy",
            proxyTransferHandler
        ],
        [
            "throw",
            throwTransferHandler
        ]
    ]);
    function isAllowedOrigin(allowedOrigins, origin) {
        for (const allowedOrigin of allowedOrigins){
            if (origin === allowedOrigin || allowedOrigin === "*") {
                return true;
            }
            if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
                return true;
            }
        }
        return false;
    }
    function expose(obj, ep = globalThis, allowedOrigins = [
        "*"
    ]) {
        ep.addEventListener("message", function callback(ev) {
            if (!ev || !ev.data) {
                return;
            }
            if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
                console.warn(`Invalid origin '${ev.origin}' for comlink proxy`);
                return;
            }
            const { id, type, path } = Object.assign({
                path: []
            }, ev.data);
            const argumentList = (ev.data.argumentList || []).map(fromWireValue);
            let returnValue;
            try {
                const parent = path.slice(0, -1).reduce((obj, prop)=>obj[prop], obj);
                const rawValue = path.reduce((obj, prop)=>obj[prop], obj);
                switch(type){
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
                            returnValue = transfer(port1, [
                                port1
                            ]);
                        }
                        break;
                    case "RELEASE":
                        {
                            returnValue = undefined;
                        }
                        break;
                    default:
                        return;
                }
            } catch (value) {
                returnValue = {
                    value,
                    [throwMarker]: 0
                };
            }
            Promise.resolve(returnValue).catch((value)=>{
                return {
                    value,
                    [throwMarker]: 0
                };
            }).then((returnValue)=>{
                const [wireValue, transferables] = toWireValue(returnValue);
                ep.postMessage(Object.assign(Object.assign({}, wireValue), {
                    id
                }), transferables);
                if (type === "RELEASE") {
                    ep.removeEventListener("message", callback);
                    closeEndPoint(ep);
                    if (finalizer in obj && typeof obj[finalizer] === "function") {
                        obj[finalizer]();
                    }
                }
            }).catch((error)=>{
                const [wireValue, transferables] = toWireValue({
                    value: new TypeError("Unserializable return value"),
                    [throwMarker]: 0
                });
                ep.postMessage(Object.assign(Object.assign({}, wireValue), {
                    id
                }), transferables);
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
        if (isMessagePort(endpoint)) endpoint.close();
    }
    function wrap(ep, target) {
        const pendingListeners = new Map();
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
            } finally{
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
        return requestResponseMessage(ep, new Map(), {
            type: "RELEASE"
        }).then(()=>{
            closeEndPoint(ep);
        });
    }
    const proxyCounter = new WeakMap();
    const proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((ep)=>{
        const newCount = (proxyCounter.get(ep) || 0) - 1;
        proxyCounter.set(ep, newCount);
        if (newCount === 0) {
            releaseEndpoint(ep);
        }
    });
    function registerProxy(proxy, ep) {
        const newCount = (proxyCounter.get(ep) || 0) + 1;
        proxyCounter.set(ep, newCount);
        if (proxyFinalizers) {
            proxyFinalizers.register(proxy, ep, proxy);
        }
    }
    function unregisterProxy(proxy) {
        if (proxyFinalizers) {
            proxyFinalizers.unregister(proxy);
        }
    }
    function createProxy(ep, pendingListeners, path = [], target = function() {}) {
        let isProxyReleased = false;
        const proxy = new Proxy(target, {
            get (_target, prop) {
                throwIfProxyReleased(isProxyReleased);
                if (prop === releaseProxy) {
                    return ()=>{
                        unregisterProxy(proxy);
                        releaseEndpoint(ep);
                        pendingListeners.clear();
                        isProxyReleased = true;
                    };
                }
                if (prop === "then") {
                    if (path.length === 0) {
                        return {
                            then: ()=>proxy
                        };
                    }
                    const r = requestResponseMessage(ep, pendingListeners, {
                        type: "GET",
                        path: path.map((p)=>p.toString())
                    }).then(fromWireValue);
                    return r.then.bind(r);
                }
                return createProxy(ep, pendingListeners, [
                    ...path,
                    prop
                ]);
            },
            set (_target, prop, rawValue) {
                throwIfProxyReleased(isProxyReleased);
                const [value, transferables] = toWireValue(rawValue);
                return requestResponseMessage(ep, pendingListeners, {
                    type: "SET",
                    path: [
                        ...path,
                        prop
                    ].map((p)=>p.toString()),
                    value
                }, transferables).then(fromWireValue);
            },
            apply (_target, _thisArg, rawArgumentList) {
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
                    path: path.map((p)=>p.toString()),
                    argumentList
                }, transferables).then(fromWireValue);
            },
            construct (_target, rawArgumentList) {
                throwIfProxyReleased(isProxyReleased);
                const [argumentList, transferables] = processArguments(rawArgumentList);
                return requestResponseMessage(ep, pendingListeners, {
                    type: "CONSTRUCT",
                    path: path.map((p)=>p.toString()),
                    argumentList
                }, transferables).then(fromWireValue);
            }
        });
        registerProxy(proxy, ep);
        return proxy;
    }
    function myFlat(arr) {
        return Array.prototype.concat.apply([], arr);
    }
    function processArguments(argumentList) {
        const processed = argumentList.map(toWireValue);
        return [
            processed.map((v)=>v[0]),
            myFlat(processed.map((v)=>v[1]))
        ];
    }
    const transferCache = new WeakMap();
    function transfer(obj, transfers) {
        transferCache.set(obj, transfers);
        return obj;
    }
    function proxy(obj) {
        return Object.assign(obj, {
            [proxyMarker]: true
        });
    }
    function toWireValue(value) {
        for (const [name, handler] of transferHandlers){
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
        switch(value.type){
            case "HANDLER":
                return transferHandlers.get(value.name).deserialize(value.value);
            case "RAW":
                return value.value;
        }
    }
    function requestResponseMessage(ep, pendingListeners, msg, transfers) {
        return new Promise((resolve)=>{
            const id = generateUUID();
            pendingListeners.set(id, resolve);
            if (ep.start) {
                ep.start();
            }
            ep.postMessage(Object.assign({
                id
            }, msg), transfers);
        });
    }
    function generateUUID() {
        return new Array(4).fill(0).map(()=>Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)).join("-");
    }
    async function loadManifest(url) {
        const r = await fetch(url, {
            cache: "force-cache"
        });
        if (!r.ok) {
            throw new Error(`Failed to load manifest from ${url}: HTTP ${r.status}`);
        }
        const json = await r.json();
        if (json.schema !== 1) {
            throw new Error(`Unsupported manifest schema: ${json.schema}`);
        }
        return json;
    }
    async function sha256Hex(bytes) {
        const view = new Uint8Array(bytes.byteLength);
        view.set(bytes);
        const digest = await crypto.subtle.digest("SHA-256", view);
        return [
            ...new Uint8Array(digest)
        ].map((b)=>b.toString(16).padStart(2, "0")).join("");
    }
    async function assertSha256(bytes, expected, what) {
        const actual = await sha256Hex(bytes);
        if (actual !== expected.toLowerCase()) {
            throw new Error(`texlive-wasm: integrity check failed for ${what}: expected sha256 ${expected}, got ${actual}`);
        }
    }
    function safeRelativePath(path) {
        const segments = path.split(/[/\\]+/).filter((s)=>s !== "" && s !== ".");
        if (segments.length === 0) return null;
        if (segments.some((s)=>s === "..")) return null;
        if (/^[a-z]:$/i.test(segments[0])) return null;
        if (segments.some((s)=>s.includes("\0"))) return null;
        return segments.join("/");
    }
    function safeResolve(root, path) {
        const base = root.replace(/\/+$/, "");
        const inRoot = path === base || path.startsWith(`${base}/`);
        if (!inRoot && path.startsWith("/")) return null;
        const rest = inRoot ? path.slice(base.length) : path;
        if (rest === "" || rest === "/") return base;
        const rel = safeRelativePath(rest);
        return rel === null ? null : `${base}/${rel}`;
    }
    const MAX_TAR_ENTRIES = 25e4;
    function untar(bytes, options = {}) {
        const maxEntries = options.maxEntries ?? MAX_TAR_ENTRIES;
        const out = [];
        const decoder = new TextDecoder();
        let offset = 0;
        let pendingLongName = null;
        while(offset + 512 <= bytes.length){
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
                throw new Error(`texlive-wasm: tar entry "${fullPath}" declares ${size} bytes, past the end of the archive`);
            }
            const contentBlocks = Math.ceil(size / 512);
            const content = bytes.subarray(offset, offset + size);
            offset += contentBlocks * 512;
            if (out.length >= maxEntries) {
                throw new Error(`texlive-wasm: tar archive has more than ${maxEntries} entries; refusing to continue`);
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
            out.push({
                path: fullPath,
                content: type === "file" ? content : new Uint8Array(),
                type
            });
        }
        return out;
    }
    function parsePaxPath(body) {
        let i = 0;
        while(i < body.length){
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
        while(end < start + len && block[end] !== 0)end++;
        return new TextDecoder().decode(block.subarray(start, end));
    }
    function parseOctal(block, start, len) {
        let n = 0;
        for(let i = start; i < start + len; i++){
            const c = block[i];
            if (c === void 0 || c === 0 || c === 32) continue;
            if (c < 48 || c > 55) break;
            n = n * 8 + (c - 48);
        }
        return n;
    }
    function isAllZero(block) {
        for(let i = 0; i < block.length; i++)if (block[i] !== 0) return false;
        return true;
    }
    const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
    async function decompress(bytes, format, maxBytes = MAX_DECOMPRESSED_BYTES) {
        const Ctor = globalThis.DecompressionStream;
        if (!Ctor) {
            throw new Error(`DecompressionStream not available; can't decompress ${format}`);
        }
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        const stream = new Blob([
            ab
        ]).stream().pipeThrough(new Ctor(format)).pipeThrough(limitBytes(maxBytes, format));
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
    }
    function limitBytes(maxBytes, format) {
        let seen = 0;
        return new TransformStream({
            transform (chunk, controller) {
                seen += chunk.byteLength;
                if (seen > maxBytes) {
                    controller.error(new Error(`texlive-wasm: ${format} stream expands past the ${maxBytes}-byte limit; refusing to continue`));
                    return;
                }
                controller.enqueue(chunk);
            }
        });
    }
    const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
    async function createBundleFs(opts) {
        const files = new Map();
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
                    throw new Error(`BundleFs: ${bundleUrl} is ${bytes.byteLength} bytes, past the ${maxCompressed}-byte download limit; refusing to unpack it`);
                }
            }
            if (!bytes) return;
            if (expectedSha) {
                await assertSha256(bytes, expectedSha, bundleUrl ?? "bundle");
            }
            const format = opts.format ?? detectFormat(bundleUrl, bytes);
            if (!format) {
                throw new Error(`BundleFs: cannot tell what ${bundleUrl ?? "the supplied bundle"} is compressed with — it is neither gzip nor a plain tar. Brotli has no magic bytes, so name the file .tar.br or pass format: 'br' explicitly.`);
            }
            const tar = format === "raw" ? bytes : await decompress(bytes, format, opts.maxBytes);
            let rejected = 0;
            let firstRejected = "";
            let duplicates = 0;
            for (const entry of untar(tar)){
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
                console.warn(`texlive-wasm: BundleFs dropped ${rejected} archive entr${rejected === 1 ? "y" : "ies"} with an escaping path (first: ${firstRejected}) from ${bundleUrl ?? "the supplied bundle"}`);
            }
            if (duplicates > 0) {
                console.warn(`texlive-wasm: BundleFs dropped ${duplicates} duplicate archive entr${duplicates === 1 ? "y" : "ies"} from ${bundleUrl ?? "the supplied bundle"}; the first copy of each name is the one served`);
            }
        }
        return {
            id: "bundlefs",
            read (tdsPath) {
                return files.get(stripLeading(tdsPath)) ?? null;
            },
            exists (tdsPath) {
                return files.has(stripLeading(tdsPath));
            },
            list (prefix) {
                const p = stripLeading(prefix);
                const out = [];
                for (const path of files.keys()){
                    if (path.startsWith(p)) out.push(path);
                }
                return out;
            },
            async init () {
                await load();
            }
        };
    }
    function stripLeading(p) {
        return p.replace(/^\/+/, "");
    }
    function requireIntegrity(bundleUrl, sha256, allow) {
        if (sha256 || allow || isSameOrigin(bundleUrl)) return;
        throw new Error(`BundleFs: refusing to load ${bundleUrl} — no SHA-256 for it. Publish the digest in the manifest (coreBundleSha256), pass it as \`sha256\`, or serve the bundle from the app's own origin. For development only, set allowUnverified/allowUnverifiedAssets.`);
    }
    function isSameOrigin(url) {
        if (typeof location === "undefined") return false;
        try {
            return new URL(url, location.href).origin === location.origin;
        } catch  {
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
        if (bytes.length >= 262 && bytes[257] === 117 && bytes[258] === 115 && bytes[259] === 116 && bytes[260] === 97 && bytes[261] === 114) {
            return "raw";
        }
        return null;
    }
    function buildLsR(paths) {
        const byDir = new Map();
        const entry = (dir, name)=>{
            let set = byDir.get(dir);
            if (!set) byDir.set(dir, set = new Set());
            set.add(name);
        };
        for (const path of paths){
            if (path === "ls-R") continue;
            const parts = path.split("/");
            for(let i = 0; i < parts.length; i++){
                entry(parts.slice(0, i).join("/"), parts[i]);
            }
        }
        const lines = [
            "% ls-R -- filename database for kpathsea; do not change this line."
        ];
        for (const dir of [
            ...byDir.keys()
        ].sort()){
            lines.push("", `./${dir}:`, ...[
                ...byDir.get(dir)
            ].sort());
        }
        return lines.join("\n") + "\n";
    }
    const TEX_ENGINES = new Set([
        "pdflatex",
        "xelatex",
        "lualatex"
    ]);
    const FONTS_CONF = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/texmf-dist/fonts/opentype</dir>
  <dir>/texmf-dist/fonts/truetype</dir>
  <dir>/texmf-dist/fonts/type1</dir>
  <cachedir>/tmp/fontcache</cachedir>
  <config>
    <rescan><int>0</int></rescan>
  </config>
</fontconfig>
`;
    const FMT_PATH = {
        pdflatex: "/texmf-dist/web2c/pdftex/pdflatex.fmt",
        xelatex: "/texmf-dist/web2c/xetex/xelatex.fmt",
        lualatex: "/texmf-dist/web2c/luatex/lualatex.fmt"
    };
    const LOG_EXT = {
        pdflatex: ".log",
        xelatex: ".log",
        lualatex: ".log",
        bibtexu: ".blg",
        biber: ".blg",
        makeindex: ".ilg"
    };
    const INPUT_ARG_RE = {
        pdflatex: /\.(tex|ltx)$/i,
        xelatex: /\.(tex|ltx)$/i,
        lualatex: /\.(tex|ltx)$/i,
        bibtexu: /\.aux$/i,
        biber: /\.bcf$/i,
        makeindex: /\.idx$/i,
        xdvipdfmx: /\.xdv$/i
    };
    function selectsOwnFormat(args) {
        return args.some((a)=>/^--?(fmt|ini|initialize)\b/.test(a));
    }
    class WorkerImpl {
        engineId = null;
        config = null;
        backends = [];
        glueFactory = null;
        wasmModule = null;
        icuData = null;
        tdsFiles = new Map();
        varFiles = new Map();
        nameIndex = new Map();
        lazyMounted = false;
        eagerWarned = false;
        stdoutBuf = "";
        stderrBuf = "";
        async init(opts, host) {
            this.engineId = opts.engineId;
            this.config = opts.config;
            this.backends = (opts.backendMeta ?? []).map((meta, i)=>reconstructBackend(meta, i, host ?? null));
            const allowUnverified = opts.config.allowUnverifiedAssets === true;
            if (opts.config.bundleUrl) {
                this.backends.unshift(await createBundleFs({
                    bundleUrl: opts.config.bundleUrl,
                    ...opts.config.bundleSha256 ? {
                        sha256: opts.config.bundleSha256
                    } : {},
                    allowUnverified
                }));
            } else if (opts.bundleFromManifest && opts.config.manifestUrl) {
                this.backends.unshift(await createBundleFs({
                    manifestUrl: opts.config.manifestUrl,
                    allowUnverified
                }));
            }
            for (const b of this.backends){
                await b.init?.();
            }
            const glueUrl = this.resolveEngineGlueUrl();
            this.glueFactory = (await import(glueUrl).then(async (m)=>{
                await m.__tla;
                return m;
            })).default;
            if (this.config.enginePath) {
                try {
                    const r = await fetch(this.config.enginePath);
                    if (r.ok) {
                        this.wasmModule = await WebAssembly.compile(await r.arrayBuffer());
                    }
                } catch  {
                    this.wasmModule = null;
                }
            }
            this.icuData = opts.icuData ?? null;
            if (!this.icuData && opts.config.icuDataUrl) {
                const r = await fetch(opts.config.icuDataUrl);
                if (!r.ok) {
                    throw new Error(`texlive-wasm: HTTP ${r.status} fetching icuDataUrl ${opts.config.icuDataUrl}`);
                }
                this.icuData = new Uint8Array(await r.arrayBuffer());
            }
            for (const backend of this.backends){
                if (!backend.list) continue;
                const paths = await backend.list("");
                for (const tdsPath of paths){
                    const rel = safeRelativePath(tdsPath);
                    if (!rel) continue;
                    const bytes = await backend.read(tdsPath);
                    if (bytes) this.tdsFiles.set(rel, bytes);
                }
            }
            if (opts.config.manifestUrl) {
                try {
                    const manifest = await loadManifest(opts.config.manifestUrl);
                    for (const path of Object.keys(manifest.files)){
                        const name = path.slice(path.lastIndexOf("/") + 1);
                        const existing = this.nameIndex.get(name);
                        if (existing) existing.push(path);
                        else this.nameIndex.set(name, [
                            path
                        ]);
                    }
                } catch  {
                    this.nameIndex.clear();
                }
            }
        }
        async createInstance() {
            if (!this.engineId || !this.glueFactory) {
                throw new Error("Worker.init() must be called before run()");
            }
            const cachedModule = this.wasmModule;
            const module = await this.glueFactory({
                noInitialRun: true,
                thisProgram: `/bin/${this.engineId}`,
                print: (line)=>{
                    this.stdoutBuf += line + "\n";
                },
                printErr: (line)=>{
                    this.stderrBuf += line + "\n";
                },
                ...cachedModule ? {
                    instantiateWasm: (imports, done)=>{
                        void WebAssembly.instantiate(cachedModule, imports).then((instance)=>done(instance, cachedModule));
                        return {};
                    }
                } : {}
            });
            if (this.icuData && module._udata_setCommonData_78) {
                const ptr = module._malloc(this.icuData.length);
                module.HEAPU8.set(this.icuData, ptr);
                const errPtr = module._malloc(4);
                module.HEAPU32[errPtr >> 2] = 0;
                module._udata_setCommonData_78(ptr, errPtr);
            }
            const FS = module.FS;
            const dirs = new Set([
                "/"
            ]);
            mkdirCached(FS, "/bin", dirs);
            FS.writeFile(`/bin/${this.engineId}`, new Uint8Array());
            mkdirCached(FS, "/project", dirs);
            if (this.engineId === "xelatex") {
                mkdirCached(FS, "/etc/fonts", dirs);
                mkdirCached(FS, "/usr/local/etc/fonts", dirs);
                mkdirCached(FS, "/tmp/fontcache", dirs);
                FS.writeFile("/etc/fonts/fonts.conf", FONTS_CONF);
                FS.writeFile("/usr/local/etc/fonts/fonts.conf", FONTS_CONF);
            }
            if (!pathExists(FS, "/tmp")) FS.mkdir("/tmp");
            dirs.add("/tmp");
            mkdirCached(FS, "/tmp/texmf-var", dirs);
            for (const [rel, bytes] of this.varFiles){
                const absolute = `/tmp/texmf-var/${rel}`;
                mkdirCached(FS, dirname(absolute), dirs);
                FS.writeFile(absolute, bytes);
            }
            this.lazyMounted = this.engineId === "biber" ? false : this.tryMountLazyTds(module, dirs);
            if (!this.lazyMounted) {
                const fsRoot = this.engineId === "biber" ? "" : "/texmf-dist";
                if (fsRoot) mkdirCached(FS, fsRoot, dirs);
                for (const [tdsPath, bytes] of this.tdsFiles){
                    const absolute = `${fsRoot}/${tdsPath}`;
                    mkdirCached(FS, dirname(absolute), dirs);
                    FS.writeFile(absolute, bytes);
                }
            }
            if (this.engineId !== "biber") {
                FS.writeFile("/texmf-dist/ls-R", buildLsR(this.tdsFiles.keys()));
            }
            return module;
        }
        tryMountLazyTds(module, dirs) {
            if (this.config?.lazyTds === false) return false;
            const m = module;
            if (!m._texlive_mount_lazy || !m._texlive_touch || !m.stringToUTF8) {
                this.warnEagerFallback("the engine artifact does not export the lazy WASMFS backend (rebuild it)");
                return false;
            }
            try {
                const fileBytes = new Map();
                let pending = null;
                m.texliveLazyBackend = {
                    allocFile: (file)=>{
                        if (pending) {
                            fileBytes.set(file, pending);
                            pending = null;
                        }
                    },
                    freeFile: (file)=>{
                        fileBytes.delete(file);
                    },
                    getSize: (file)=>fileBytes.get(file)?.length ?? 0,
                    read: (file, buffer, length, offset)=>{
                        const bytes = fileBytes.get(file);
                        if (!bytes || offset >= bytes.length) return 0;
                        const n = Math.min(length, bytes.length - offset);
                        module.HEAPU8.set(bytes.subarray(offset, offset + n), buffer);
                        return n;
                    },
                    write: (file, buffer, length, offset)=>{
                        const prev = fileBytes.get(file) ?? new Uint8Array(0);
                        let next;
                        if (prev.length >= offset + length) {
                            next = prev.slice();
                        } else {
                            next = new Uint8Array(offset + length);
                            next.set(prev);
                        }
                        next.set(module.HEAPU8.subarray(buffer, buffer + length), offset);
                        fileBytes.set(file, next);
                        return length;
                    },
                    setSize: (file, size)=>{
                        const prev = fileBytes.get(file) ?? new Uint8Array(0);
                        const next = new Uint8Array(size);
                        next.set(prev.subarray(0, Math.min(size, prev.length)));
                        fileBytes.set(file, next);
                        return 0;
                    }
                };
                const mountRc = m._texlive_mount_lazy();
                if (mountRc !== 0) {
                    this.warnEagerFallback(`texlive_mount_lazy() failed with ${mountRc}`);
                    return false;
                }
                dirs.add("/texmf-dist");
                const scratch = module._malloc(4096);
                let failedTouch = null;
                try {
                    for (const [tdsPath, bytes] of this.tdsFiles){
                        const absolute = `/texmf-dist/${tdsPath}`;
                        mkdirCached(module.FS, dirname(absolute), dirs);
                        pending = bytes;
                        m.stringToUTF8(absolute, scratch, 4096);
                        const rc = m._texlive_touch(scratch);
                        pending = null;
                        if (rc !== 0) {
                            failedTouch = `${absolute} (rc=${rc})`;
                            break;
                        }
                    }
                } finally{
                    module._free(scratch);
                }
                if (failedTouch) {
                    this.warnEagerFallback(`texlive_touch() failed for ${failedTouch}`);
                    return false;
                }
                return true;
            } catch (err) {
                this.warnEagerFallback(`lazy mount threw (${String(err)})`);
                return false;
            }
        }
        warnEagerFallback(reason) {
            if (this.eagerWarned) return;
            this.eagerWarned = true;
            console.warn(`texlive-wasm: ${this.engineId} is materializing the TeX tree eagerly because ${reason}. Every engine instance now copies the whole tree into the wasm heap; on a mobile WebView that is a likely out-of-memory.`);
        }
        async run(opts) {
            if (!this.engineId || !this.config || !this.glueFactory) {
                throw new Error("Worker.init() must be called before run()");
            }
            const startedAt = performance.now();
            const lazy = opts.lazyFetch ?? true;
            const maxRetries = lazy === false ? 0 : lazy === true ? 1 : Math.max(0, lazy.maxRetries ?? 1);
            let exitCode = 0;
            let retriesUsed = 0;
            let stdout = "";
            let stderr = "";
            let outputs = new Map();
            let log = "";
            const inputs = new Map();
            for(let attempt = 0; attempt <= maxRetries; attempt++){
                let module;
                let FS;
                try {
                    module = await this.createInstance();
                    FS = module.FS;
                    inputs.clear();
                    for (const file of opts.files ?? []){
                        const rel = safeRelativePath(file.path);
                        if (!rel) {
                            throw new Error(`texlive-wasm: refusing file input with an escaping path: ${file.path}`);
                        }
                        const bytes = normalizeBytes(file.content);
                        const absolute = `/project/${rel}`;
                        mkdirP(FS, dirname(absolute));
                        FS.writeFile(absolute, bytes);
                        inputs.set(rel, bytes);
                    }
                } catch (err) {
                    rethrowIfOom(err);
                    throw err;
                }
                const cwd = safeResolve("/project", opts.cwd ?? "/project");
                if (!cwd) {
                    throw new Error(`texlive-wasm: refusing a cwd outside /project: ${opts.cwd}`);
                }
                FS.chdir(cwd);
                const argv = [
                    ...this.standardArgs(FS, opts),
                    ...opts.args
                ];
                this.stdoutBuf = "";
                this.stderrBuf = "";
                try {
                    exitCode = module.callMain(argv);
                } catch (err) {
                    const e = err;
                    if (typeof e?.status === "number") {
                        exitCode = e.status;
                    } else {
                        rethrowIfOom(err);
                        throw err;
                    }
                }
                stdout += this.stdoutBuf;
                stderr += this.stderrBuf;
                outputs = new Map();
                collectProduced(FS, "/project", "", inputs, outputs);
                log = this.findLog(FS, opts.args);
                if (this.config?.persistTexmfVar !== false) {
                    try {
                        collectFiles(FS, "/tmp/texmf-var", "", this.varFiles);
                    } catch  {}
                }
                if (exitCode === 0 || attempt === maxRetries) break;
                const missing = parseMissingFiles(log || `${this.stdoutBuf}
${this.stderrBuf}`);
                if (missing.length === 0) break;
                const fetched = await this.fetchMissingIntoTds(missing);
                if (fetched === 0) break;
                retriesUsed++;
            }
            const result = {
                exitCode,
                stdout,
                stderr,
                outputs,
                log,
                durationMs: performance.now() - startedAt,
                lazyFetchRetries: retriesUsed,
                lazyTds: this.lazyMounted
            };
            const transferables = new Set();
            for (const bytes of outputs.values()){
                const buffer = bytes.buffer;
                if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
                    transferables.add(buffer);
                }
            }
            return transfer(result, [
                ...transferables
            ]);
        }
        standardArgs(FS, opts) {
            if (!this.engineId || !TEX_ENGINES.has(this.engineId)) return [];
            const args = [];
            const fmt = FMT_PATH[this.engineId];
            if (fmt && pathExists(FS, fmt)) {
                args.push(`-fmt=${fmt}`);
            } else if (!selectsOwnFormat(opts.args)) {
                throw new Error(`texlive-wasm: no LaTeX format for ${this.engineId} — ${fmt} is not in the TeX tree. Install the engine's core bundle ('npx @typeward/texlive-wasm download-assets') and point config.bundleUrl or config.manifestUrl at it, or pass your own -fmt=/-ini argument.`);
            }
            // NeoLeaf patch: the extra packages are written flat in the project folder (the current directory), so the font search paths
            // (TFM, VF, Type 1, encodings, maps, OpenType, TrueType) must include "." like TEXINPUTS does. Without it a package that ships its
            // own font files (for example roboto) finds its .sty and .fd but not its .tfm.
            args.push("-cnf-line=TEXMFCNF=/texmf-dist/web2c", "-cnf-line=TEXMF=/texmf-dist", "-cnf-line=TEXMFDIST=/texmf-dist", "-cnf-line=TEXMFVAR=/tmp/texmf-var", "-cnf-line=TEXMFCACHE=/tmp/texmf-var", "-cnf-line=TEXMFDBS=/texmf-dist", "-cnf-line=TEXINPUTS=.;/texmf-dist/tex//", "-cnf-line=TFMFONTS=.;/texmf-dist/fonts/tfm//", "-cnf-line=VFFONTS=.;/texmf-dist/fonts/vf//", "-cnf-line=T1FONTS=.;/texmf-dist/fonts/type1//", "-cnf-line=ENCFONTS=.;/texmf-dist/fonts/enc//", "-cnf-line=TEXFONTMAPS=.;/texmf-dist/fonts/map//", "-cnf-line=OPENTYPEFONTS=.;/texmf-dist/fonts/opentype//;/texmf-dist/fonts/truetype//;/texmf-dist/fonts/type1//", "-cnf-line=TRUETYPEFONTS=.;/texmf-dist/fonts/truetype//");
            for (const [key, value] of Object.entries(opts.env ?? {})){
                args.push(`-cnf-line=${key}=${value}`);
            }
            return args;
        }
        async fetchMissingIntoTds(missing) {
            let written = 0;
            for (const name of missing){
                const indexed = name.includes("/") ? [] : this.nameIndex.get(name) ?? [];
                const candidates = [
                    ...indexed,
                    ...expandMissingName(name)
                ].map((c)=>safeRelativePath(c)).filter((c)=>c !== null);
                for (const candidate of candidates){
                    let bytes = null;
                    for (const backend of this.backends){
                        try {
                            const r = await backend.read(candidate);
                            if (r) {
                                bytes = r;
                                break;
                            }
                        } catch  {}
                    }
                    if (bytes) {
                        this.tdsFiles.set(candidate, bytes);
                        written++;
                        break;
                    }
                }
            }
            return written;
        }
        findLog(FS, args) {
            if (!this.engineId) return "";
            const ext = LOG_EXT[this.engineId];
            if (!ext) return "";
            const stem = this.jobStem(args);
            if (!stem) return "";
            return readTextFile(FS, `/project/${stem}${ext}`);
        }
        jobStem(args) {
            const jobArg = args.find((a)=>/^--?jobname=/.test(a));
            if (jobArg) return jobArg.split("=")[1];
            const inputRe = INPUT_ARG_RE[this.engineId ?? "pdflatex"] ?? /\.(tex|ltx)$/i;
            const candidates = args.filter((a)=>!a.startsWith("-"));
            const match = candidates.find((a)=>inputRe.test(a)) ?? candidates[candidates.length - 1];
            return match?.replace(inputRe, "").split("/").pop();
        }
        async dispose() {
            for (const b of this.backends){
                await b.dispose?.();
            }
            this.glueFactory = null;
            this.wasmModule = null;
            this.tdsFiles.clear();
            this.varFiles.clear();
        }
        resolveEngineGlueUrl() {
            if (!this.config || !this.engineId) {
                throw new Error("resolveEngineGlueUrl: config missing");
            }
            if (this.config.enginePath) {
                return this.config.enginePath.replace(/\.wasm$/, ".js");
            }
            throw new Error(`texlive-wasm: config.enginePath is required. Download the engine artifacts ('npx @typeward/texlive-wasm download-assets') and pass e.g. enginePath: '/texlive-wasm/${this.engineId}/emscripten/${this.engineId}.wasm'.`);
        }
    }
    function reconstructBackend(meta, index, host) {
        if (!host) {
            throw new Error("Worker.init(): backendMeta supplied without a BackendHost proxy");
        }
        const backend = {
            id: meta.id,
            read: (tdsPath)=>host.read(index, tdsPath),
            exists: (tdsPath)=>host.exists(index, tdsPath)
        };
        if (meta.hasList) backend.list = (tdsPrefix)=>host.list(index, tdsPrefix);
        if (meta.hasInit) backend.init = ()=>host.init(index);
        if (meta.hasDispose) backend.dispose = ()=>host.dispose(index);
        return backend;
    }
    function dirname(p) {
        const i = p.lastIndexOf("/");
        return i <= 0 ? "/" : p.slice(0, i);
    }
    function rethrowIfOom(err) {
        const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        if (err instanceof RangeError || /cannot enlarge memory|out of memory|\bOOM\b/i.test(text)) {
            const oom = new Error(`engine ran out of memory (${text}); dispose idle engines or reduce concurrent workers, then retry`);
            oom.name = "EngineOutOfMemoryError";
            throw oom;
        }
    }
    function pathExists(FS, path) {
        try {
            FS.stat(path);
            return true;
        } catch  {
            return false;
        }
    }
    function isDirMode(mode) {
        return (mode & 61440) === 16384;
    }
    function mkdirP(FS, path) {
        if (!path || path === "/" || pathExists(FS, path)) return;
        mkdirP(FS, dirname(path));
        FS.mkdir(path);
    }
    function mkdirCached(FS, path, seen) {
        if (!path || seen.has(path)) return;
        const parent = dirname(path);
        if (parent !== path) mkdirCached(FS, parent, seen);
        if (!pathExists(FS, path)) FS.mkdir(path);
        seen.add(path);
    }
    function normalizeBytes(content) {
        return typeof content === "string" ? new TextEncoder().encode(content) : content;
    }
    function collectFiles(FS, absDir, relPrefix, out) {
        for (const name of FS.readdir(absDir)){
            if (name === "." || name === "..") continue;
            const abs = `${absDir}/${name}`;
            const rel = relPrefix ? `${relPrefix}/${name}` : name;
            const st = FS.stat(abs);
            if (isDirMode(st.mode)) {
                collectFiles(FS, abs, rel, out);
            } else {
                out.set(rel, FS.readFile(abs));
            }
        }
    }
    function collectProduced(FS, absDir, relPrefix, inputs, out) {
        for (const name of FS.readdir(absDir)){
            if (name === "." || name === "..") continue;
            const abs = `${absDir}/${name}`;
            const rel = relPrefix ? `${relPrefix}/${name}` : name;
            const st = FS.stat(abs);
            if (isDirMode(st.mode)) {
                collectProduced(FS, abs, rel, inputs, out);
                continue;
            }
            const input = inputs.get(rel);
            if (input && input.length === st.size) {
                const current = FS.readFile(abs);
                if (sameBytes(input, current)) continue;
                out.set(rel, current);
                continue;
            }
            out.set(rel, FS.readFile(abs));
        }
    }
    function sameBytes(a, b) {
        if (a.length !== b.length) return false;
        for(let i = 0; i < a.length; i++)if (a[i] !== b[i]) return false;
        return true;
    }
    function parseMissingFiles(log) {
        if (!log) return [];
        const out = new Set();
        const patterns = [
            /I can't find file `([^']+)'/g,
            /File `([^']+)' not found/g,
            /file `([^']+)' is not loadable/g,
            /Cannot find ([\w.-]+\.(?:sty|cls|fd|def|cfg|tfm|vf|pfb|otf|ttf|mf|enc|map))/gi,
            /I couldn't open (?:style|database|auxiliary) file ([\w./-]+)/g,
            /[Ii]ndex style file ([\w./-]+) not found/g,
            /Couldn't (?:open|find) (?:style|input) file ([\w./-]+)/g,
            /Could not open (?:file|font|CMap)[:\s]+"?([\w./-]+)"?/g,
            /Unable to find (?:file|font)[:\s]+"?([\w./-]+)"?/g
        ];
        for (const re of patterns){
            let m;
            while((m = re.exec(log)) !== null){
                const name = m[1]?.trim();
                if (name && !name.includes("//") && !name.startsWith("-")) out.add(name);
            }
        }
        return Array.from(out);
    }
    function expandMissingName(name) {
        if (name.startsWith("/")) return [
            name
        ];
        if (name.includes("/")) return [
            name
        ];
        const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
        const stem = name;
        const out = [
            stem
        ];
        if (ext === "sty" || ext === "cls" || ext === "def" || ext === "fd" || ext === "cfg") {
            out.push(`tex/latex/${stem.replace(/\.\w+$/, "")}/${stem}`);
            out.push(`tex/latex/base/${stem}`);
        } else if (ext === "tex" || ext === "ltx") {
            out.push(`tex/generic/${stem.replace(/\.\w+$/, "")}/${stem}`);
        } else if (ext === "tfm") {
            out.push(`fonts/tfm/public/${stem.replace(/\.\w+$/, "")}/${stem}`);
        } else if (ext === "otf" || ext === "ttf") {
            out.push(`fonts/opentype/public/${stem.replace(/\d.*$/, "")}/${stem}`);
            out.push(`fonts/truetype/public/${stem.replace(/\d.*$/, "")}/${stem}`);
        } else if (ext === "pfb" || ext === "pfa") {
            out.push(`fonts/type1/public/${stem.replace(/\d.*$/, "")}/${stem}`);
        } else if (ext === "map" || ext === "enc") {
            out.push(`fonts/${ext}/dvips/${stem.replace(/\.\w+$/, "")}/${stem}`);
        } else if (ext === "bst") {
            out.push(`bibtex/bst/${stem.replace(/\.\w+$/, "")}/${stem}`);
            out.push(`bibtex/bst/base/${stem}`);
        } else if (ext === "bib") {
            out.push(`bibtex/bib/${stem.replace(/\.\w+$/, "")}/${stem}`);
        } else if (ext === "ist" || ext === "mst") {
            out.push(`makeindex/${stem.replace(/\.\w+$/, "")}/${stem}`);
            out.push(`makeindex/base/${stem}`);
        } else if (ext === "" || ext === "cmap") {
            out.push(`fonts/cmap/${stem}`);
        }
        return out;
    }
    function readTextFile(FS, path) {
        if (!pathExists(FS, path)) return "";
        try {
            return new TextDecoder("utf-8", {
                fatal: false
            }).decode(FS.readFile(path));
        } catch  {
            return "";
        }
    }
    const api = new WorkerImpl();
    if (typeof globalThis.postMessage === "function") {
        expose(api);
    }
})();
