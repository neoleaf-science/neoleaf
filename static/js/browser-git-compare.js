// NeoLeaf Browser-First Git Engine (part 3): compare with GitHub, history, blame, reset and conflict helpers.
// Adds methods to window.BrowserGit; shares internals through window.__BG (see browser-git.js).
(function () {
  'use strict';
  const { initFs, isIgnoredPath } = window.__BG;
  const __BG = window.__BG;
  let deepened = false;

  Object.assign(window.BrowserGit, {
    // ---- comparison with GitHub (pull/push dialogs and automatic pull) ----

    /** Fetches and compares the local branch with the remote: commits and files coming in and going out. */
    async compare({ fetch = true } = {}) {
      const { fs, pfs } = initFs();
      const dir = __BG.dir();
      const branch = (await git.currentBranch({ fs, dir }).catch(() => null)) || 'main';
      if (fetch) {
        await git.fetch({ fs, http: GitHttp, dir, url: `${window.location.origin}/api/git/${__BG.owner()}/${__BG.repo()}`, singleBranch: true });
      }
      const empty = { branch, ahead: 0, behind: 0, localOid: null, remoteOid: null, baseOid: null, incoming: { commits: [], files: [] }, outgoing: { commits: [], files: [] } };
      const localOid = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` }).catch(() => null);
      const remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` }).catch(() => null);
      if (!localOid || !remoteOid || localOid === remoteOid) return { ...empty, localOid, remoteOid };
      const [l, r] = await Promise.all([git.log({ fs, dir, ref: localOid, depth: 300 }), git.log({ fs, dir, ref: remoteOid, depth: 300 })]);
      const lset = new Set(l.map(c => c.oid));
      const rset = new Set(r.map(c => c.oid));
      const slim = c => ({ oid: c.oid, message: c.commit.message, author: c.commit.author.name, time: c.commit.author.timestamp });
      const incomingCommits = r.filter(c => !lset.has(c.oid)).map(slim);
      const outgoingCommits = l.filter(c => !rset.has(c.oid)).map(slim);
      const baseOid = ((await git.findMergeBase({ fs, dir, oids: [localOid, remoteOid] }).catch(() => [])) || [])[0] || null;
      const incomingFiles = incomingCommits.length ? await treeDiff(baseOid, remoteOid) : [];
      const outgoingFiles = outgoingCommits.length ? await treeDiff(baseOid, localOid) : [];
      return { branch, ahead: outgoingCommits.length, behind: incomingCommits.length, localOid, remoteOid, baseOid, incoming: { commits: incomingCommits, files: incomingFiles }, outgoing: { commits: outgoingCommits, files: outgoingFiles } };
    },

    getGit() {
      const { fs, pfs } = initFs();
      return { git: window.git, fs };
    },

    /** The clone is shallow (depth 1) to open fast; history and authorship (blame) need more commits: deepen once. */
    async deepen(depth = 300) {
      if (deepened) return;
      deepened = true;
      const { fs, pfs } = initFs();
      try {
        await git.fetch({ fs, http: GitHttp, dir: __BG.dir(), url: `${window.location.origin}/api/git/${__BG.owner()}/${__BG.repo()}`, singleBranch: true, depth });
      } catch (err) {
        deepened = false;
        console.warn('Could not deepen the history:', err);
      }
    },

    /** Commits that changed the file (most recent first). */
    async fileLog(path, depth = 100) {
      await this.deepen();
      const { fs } = initFs();
      return await git.log({ fs, dir: __BG.dir(), filepath: path, depth });
    },

    /** Line-by-line authorship: [{ commit, author, email, timestamp, summary }] (one item per line of the current file). */
    async blame(path) {
      const lineDiff = window.GitReview && GitReview.lineDiff;
      if (!lineDiff) throw new Error(T('Diff unavailable'));
      const cur = await this.readFile(path, 'utf8');
      const logs = (await this.fileLog(path, 60)).slice(0, 60);
      if (!logs.length) return [];
      const dec = new TextDecoder();
      const versions = [];
      for (const c of logs) {
        const bytes = await this.readAt(c.oid, path);
        versions.push(bytes ? dec.decode(bytes) : '');
      }
      // for each line of `b`, the matching line in `a` (or null if it was added in `b`)
      const mapNew = (a, b) => {
        const ops = lineDiff(a, b);
        const map = [];
        let ia = 0, ib = 0;
        for (const op of ops) {
          if (op.t === ' ') { map[ib++] = ia++; }
          else if (op.t === '+') { map[ib++] = null; }
          else ia++;
        }
        return map;
      };
      const total = cur.split('\n').length;
      const out = new Array(total).fill(null);
      const mine = { commit: '', author: T('You (not committed yet)'), email: '', timestamp: Math.floor(Date.now() / 1000), summary: T('Change not committed yet') };
      const first = mapNew(versions[0], cur);
      const ptr = first.slice(0, total);
      for (let i = 0; i < total; i++) if (ptr[i] === null || ptr[i] === undefined) { out[i] = mine; ptr[i] = null; }
      const info = c => ({ commit: c.oid, author: c.commit.author.name, email: c.commit.author.email, timestamp: c.commit.author.timestamp, summary: (c.commit.message || '').split('\n')[0] });
      for (let k = 0; k < logs.length; k++) {
        const older = k + 1 < logs.length ? versions[k + 1] : '';
        const m = mapNew(older, versions[k]);
        for (let i = 0; i < total; i++) {
          if (out[i] || ptr[i] === null) continue;
          const j = ptr[i];
          if (m[j] === null || m[j] === undefined || k === logs.length - 1) { out[i] = info(logs[k]); ptr[i] = null; }
          else ptr[i] = m[j];
        }
      }
      return out.map(x => x || info(logs[logs.length - 1]));
    },

    /** Reset: the local clone becomes exactly the GitHub branch (discards changes, unpushed commits and new files). */
    async resetToRemote() {
      const { fs, pfs } = initFs();
      const dir = __BG.dir();
      const branch = (await git.currentBranch({ fs, dir }).catch(() => null)) || 'main';
      await git.fetch({ fs, http: GitHttp, dir, url: `${window.location.origin}/api/git/${__BG.owner()}/${__BG.repo()}`, singleBranch: true });
      const remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` });
      await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: remoteOid, force: true });
      await git.checkout({ fs, dir, ref: branch, force: true });
      // new files (not on GitHub) and merge leftovers
      const matrix = await git.statusMatrix({ fs, dir, filter: f => !isIgnoredPath(f) });
      for (const [file, head, workdir] of matrix) {
        if (head === 0 && workdir !== 0) await pfs.unlink(`${dir}/${file}`).catch(() => {});
      }
      for (const f of ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE', 'ORIG_HEAD']) await pfs.unlink(`${dir}/.git/${f}`).catch(() => {});
      return remoteOid;
    },

    /** Text of a file at a commit (null if it does not exist there). */
    async readAt(oid, filepath) {
      const { fs, pfs } = initFs();
      if (!oid) return null;
      try {
        return (await git.readBlob({ fs, dir: __BG.dir(), oid, filepath })).blob;
      } catch (_) {
        return null;
      }
    },

    /** The two sides of a file to show the diff. "incoming": what GitHub brought since the common ancestor;
     *  "outgoing": what will be pushed (the working folder against the common ancestor). */
    async changeSides(kind, filepath, info) {
      const { fs, pfs } = initFs();
      const base = info.baseOid || (kind === 'outgoing' ? info.remoteOid : null);
      const oldBytes = await this.readAt(base, filepath);
      let newBytes = null;
      if (kind === 'incoming') newBytes = await this.readAt(info.remoteOid, filepath);
      else newBytes = await this.readFile(filepath, 'uint8array').catch(() => null);
      return { oldBytes, newBytes };
    },

    async getConflictData(filepath) {
      const { fs, pfs } = initFs();
      let localText = '';
      let remoteText = '';
      try {
        localText = await this.readFile(filepath, 'utf8');
      } catch (_) {}

      try {
        const currentBranch = (await git.currentBranch({ fs, dir: __BG.dir() }).catch(() => null)) || 'main';
        const remoteRef = `refs/remotes/origin/${currentBranch}`;
        const remoteOid = await git.resolveRef({ fs, dir: __BG.dir(), ref: remoteRef });
        const { blob } = await git.readBlob({ fs, dir: __BG.dir(), oid: remoteOid, filepath });
        remoteText = new TextDecoder().decode(blob);
      } catch (e) {
        console.warn('Could not get the remote version of the file in the browser:', e);
      }

      return { filepath, local: localText, remote: remoteText };
    },

    async resolveConflict(filepath, choice, customContent) {
      const { fs, pfs } = initFs();
      if (choice === 'local') {
        await git.add({ fs, dir: __BG.dir(), filepath });
      } else if (choice === 'remote') {
        const data = await this.getConflictData(filepath);
        if (data.remote) {
          await this.writeFile(filepath, data.remote);
          await git.add({ fs, dir: __BG.dir(), filepath });
        }
      } else if (choice === 'custom' && typeof customContent === 'string') {
        await this.writeFile(filepath, customContent);
        await git.add({ fs, dir: __BG.dir(), filepath });
      }

      try {
        const author = {
          name: __BG.user().name || __BG.user().login || 'NeoLeaf Author',
          email: __BG.user().email || `${__BG.user().login || 'user'}@users.noreply.github.com`
        };
        const sha = await git.commit({
          fs,
          dir: __BG.dir(),
          author: author,
          message: `Merge and conflict resolution in ${filepath}`
        });
        console.log('Merge finished successfully:', sha);
        return { success: true, sha };
      } catch (_) {
        return { success: true };
      }
    },

    async abortMerge() {
      const { fs, pfs } = initFs();
      try {
        await git.abortMerge({ fs, dir: __BG.dir() });
        return true;
      } catch (e) {
        console.warn('Error aborting the merge in the browser:', e);
        return false;
      }
    },

    async getAllTexAndAssetFiles() {
      const { fs, pfs } = initFs();
      const files = await this.listFiles();
      const results = {};

      for (const f of files) {
        if (f.is_folder) continue;
        try {
          if (f.name.endsWith('.tex') || f.name.endsWith('.bib') || f.name.endsWith('.cls') || f.name.endsWith('.sty') || f.name.endsWith('.txt')) {
            results[f.path] = await this.readFile(f.path, 'utf8');
          } else {
            // Binary file (png, jpg or pdf figure)
            const buf = await this.readFile(f.path, 'uint8array');
            results[f.path] = buf;
          }
        } catch (_) {}
      }

      return results;
    }
  });


  /** Files that change between two commits (a may be null: everything is new). */
  async function treeDiff(aOid, bOid) {
    const { fs } = initFs();
    const out = [];
    const trees = [aOid ? git.TREE({ ref: aOid }) : git.TREE({ ref: bOid }), git.TREE({ ref: bOid })];
    await git.walk({
      fs,
      dir: __BG.dir(),
      trees,
      map: async (filepath, [A, B]) => {
        if (filepath === '.') return;
        if (isIgnoredPath(filepath)) return null;
        const ta = A && (await A.type());
        const tb = B && (await B.type());
        if (ta === 'tree' || tb === 'tree') return; // descend into the children
        const oa = aOid && A && ta === 'blob' ? await A.oid() : null;
        const ob = B && tb === 'blob' ? await B.oid() : null;
        if (oa === ob) return;
        out.push({ path: filepath, status: !oa ? 'added' : !ob ? 'deleted' : 'modified' });
      }
    });
    return out;
  }
})();
