// `Project` (part 3): texts, build payload, file bytes and ZIP export. Shares internals through window.__PS
// (see project-store.js) and adds them to `Project`.
(function () {
  'use strict';
  const { isText, isAsset, git, readText, projectFiles, loadConfig, bytesOrNull, MAX_TEXT, MAX_ASSET, texmfItems, migrateTexmf } = window.__PS;
  // ---------------------------------------------------------------- texts / build / export

  async function textsPayload() {
    const files = [];
    for (const f of await projectFiles()) {
      if (!isText(f.path) || (f.size || 0) > MAX_TEXT) continue;
      const live = (typeof currentFileId !== 'undefined' && f.path === currentFileId && typeof editor !== 'undefined' && editor) ? editor.getValue() : await readText(f.path);
      if (live !== null) files.push({ path: f.path, id: f.path, text: live });
    }
    return { files };
  }

  async function buildPayload() {
    const config = await loadConfig();
    const all = await projectFiles();
    const assets = all.filter(f => isAsset(f.path) && (f.size || 0) <= MAX_ASSET).map(f => ({ path: f.path, id: f.path, md5: null, size: f.size || 0 }));
    const { files } = await textsPayload();
    // global first: the project's override
    await migrateTexmf();
    return { config, files, assets, texmf: [...(await texmfItems('global')), ...(await texmfItems('cache')), ...(await texmfItems('project'))] };
  }

  async function exportZip() {
    const files = [];
    for (const f of await projectFiles()) files.push({ name: f.path, bytes: await BrowserGit.readFile(f.path, 'uint8array') });
    if (!files.length) throw new Error('The project has no files');
    const name = ((typeof projectId !== 'undefined' && projectId) ? projectId.split('__').slice(1).join('__') : 'project').replace(/[^A-Za-z0-9_-]/g, '_') || 'project';
    return { blob: new Blob([Zip.write(files)], { type: 'application/zip' }), name: `${name}.zip` };
  }

  Object.assign(window.Project, {
    /** Project texts (including what is open in the editor): { files: [{ path, id, text }] }. */
    async texts() { await git(); return textsPayload(); },
    /** Everything needed to compile: { config, files, assets, texmf }. */
    async build() { await git(); return buildPayload(); },
    /** Bytes of a project file (images, fonts...). */
    async fileBytes(id) {
      await git();
      const b = await bytesOrNull(decodeURIComponent(String(id)));
      if (!b) throw new Error('File not found');
      if (b.length > MAX_ASSET) throw new Error('File too large');
      return b;
    },
    /** The source code as a ZIP, built here: { blob, name }. */
    async exportZip() { await git(); return exportZip(); }
  });
})();
