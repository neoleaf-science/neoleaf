// ZIP in the browser: reading ("stored" and "deflate" methods, the latter via DecompressionStream) and writing (stored).
// Used for exporting and importing projects, without going through the server.
(function () {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }

  /** files: [{ name, bytes: Uint8Array }] -> Uint8Array (uncompressed ZIP, UTF-8 names). */
  function write(files) {
    const enc = new TextEncoder();
    const { time, date } = dosTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.bytes;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nomes em UTF-8
      local.setUint16(8, 0, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // Inflates at most `limit` bytes: the size a ZIP announces is data from the file, so what really comes out is what is counted
  async function inflateRaw(bytes, limit) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed ZIPs (DecompressionStream is missing).');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error('ZIP too large.'); }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  /** bytes -> [{ name, bytes }] (files only; folders are ignored). Limits against "zip bombs". */
  async function read(bytes, { maxEntries = 6000, maxTotal = 200 * 1024 * 1024 } = {}) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid ZIP file.');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    if (count > maxEntries) throw new Error(`ZIP has too many files (maximum ${maxEntries}).`);
    const dec = new TextDecoder();
    const out = [];
    let total = 0;
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupted ZIP.');
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const csize = view.getUint32(p + 20, true);
      const usize = view.getUint32(p + 24, true);
      const nlen = view.getUint16(p + 28, true);
      const elen = view.getUint16(p + 30, true);
      const clen = view.getUint16(p + 32, true);
      const lho = view.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      if (flags & 1) throw new Error('Encrypted ZIP is not supported.');
      total += usize;
      if (total > maxTotal) throw new Error('ZIP too large.');
      if (usize > maxTotal) throw new Error('ZIP too large.');
      const lnlen = view.getUint16(lho + 26, true);
      const lelen = view.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      const raw = bytes.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await inflateRaw(raw, Math.min(usize, maxTotal - (total - usize)));
      else throw new Error(`Compression method ${method} not supported (${name}).`);
      if (data.length !== usize) throw new Error(`Corrupted ZIP (${name}).`);
      out.push({ name, bytes: data });
    }
    return out;
  }

  window.Zip = { write, read, crc32 };
})();
