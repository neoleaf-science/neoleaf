// Passing files between pages (dashboard -> editor) through the browser's IndexedDB: creating and importing a
// project prepare the files here and the editor writes them to the local clone, commits and pushes. Nothing goes through the server.
(function () {
  'use strict';
  const DB = 'neoleaf-handoff', STORE = 'items';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(r && r.result); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  }

  /** item: { files: [{ path, bytes: Uint8Array }], message, mainFile } */
  const put = (projectId, item) => tx('readwrite', s => s.put(item, projectId));
  async function take(projectId) {
    let item = null;
    try { item = await tx('readonly', s => s.get(projectId)); } catch (_) { return null; }
    if (item) { try { await tx('readwrite', s => s.delete(projectId)); } catch (_) {} }
    return item || null;
  }

  window.Handoff = { put, take };
})();
