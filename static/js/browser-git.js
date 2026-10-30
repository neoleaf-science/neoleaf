// =====================================================================
// NeoLeaf Browser-First Git Engine
// Uses isomorphic-git and LightningFS (IndexedDB) in the browser
// =====================================================================

(function () {
  'use strict';

  let fs = null;
  let pfs = null;
  let currentRepoDir = '';
  let currentOwner = '';
  let currentRepo = '';
  let currentUser = { name: 'NeoLeaf User', email: 'user@neoleaf.io', login: 'user' };

  class CloneError extends Error {
    constructor(message, cause) { super(message); this.name = 'CloneError'; this.cause = cause; }
  }

  /** Clear message for a failure when querying or downloading the project. */
  function describeCloneError(err) {
    const status = err && (err.data && err.data.statusCode || err.statusCode);
    const msg = String((err && err.message) || err || '');
    if (status === 401 || /401/.test(msg)) return T('Your GitHub session expired. Sign in again to open the project.');
    if (status === 403 || status === 404 || /\b40[34]\b/.test(msg)) return T('I could not open the project on GitHub: it does not exist or you no longer have access.');
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return T('No connection to the server. Check your internet and try again.');
    return T('I could not download the project from GitHub') + ' (' + msg + ').';
  }

  function initFs() {
    if (!fs) {
      const LFS = typeof LightningFS !== 'undefined' ? LightningFS : (typeof window !== 'undefined' ? window.LightningFS : null);
      if (!LFS) {
        console.warn('LightningFS not loaded in scope yet');
        return { fs: null, pfs: null };
      }
      fs = new LFS('neoleaf-git', { wipe: false });
      pfs = fs.promises;
    }
    return { fs, pfs };
  }

  /** Provider id of a signed-in user (`github`, `codeberg` or the id of the institution's own Git server). */
  function providerOf(user) {
    return user && typeof user.provider === 'string' && /^[a-z][a-z0-9-]*$/.test(user.provider) ? user.provider : 'github';
  }

  /** Local folder prefix: GitHub has none; every other provider gets `<id>.` (a GitHub login has no dot, so the two never clash). */
  function dirPrefix(user) {
    const p = providerOf(user);
    return p === 'github' ? '' : p + '.';
  }

  /** Which account opened this local copy (the Storage tab lists only the copies of the account that is signed in). */
  async function rememberAccount(pfs, dirOwner, repo) {
    try {
      if (!currentUser || !currentUser.login) return;
      await pfs.mkdir('/meta').catch(() => {});
      const rec = { login: String(currentUser.login), provider: providerOf(currentUser), at: Date.now() };
      await pfs.writeFile('/meta/' + encodeURIComponent(`${dirOwner}/${repo}`) + '.json', JSON.stringify(rec));
    } catch (_) { /* only a convenience: the list falls back to the owner's name */ }
  }

  const BrowserGit = {
    async init(owner, repo, user) {
      currentOwner = owner;
      currentRepo = repo;
      if (user) currentUser = user;
      // the same owner/repo on two providers are different projects: every provider but GitHub gets a prefix in the local folder
      const dirOwner = dirPrefix(currentUser) + owner;
      currentRepoDir = `/repos/${dirOwner}/${repo}`;

      const { pfs } = initFs();
      if (pfs) {
        try {
          await pfs.mkdir('/repos');
        } catch (_) {}
        try {
          await pfs.mkdir(`/repos/${dirOwner}`);
        } catch (_) {}
        try {
          await pfs.mkdir(currentRepoDir);
        } catch (_) {}
        await rememberAccount(pfs, dirOwner, repo);
      }

      return this;
    },

    getDir() {
      return currentRepoDir;
    },

    getFs() {
      return initFs();
    },

    async isCloned() {
      if (!currentRepoDir) {
        if (typeof projectOwner !== 'undefined' && typeof projectRepo !== 'undefined' && projectOwner && projectRepo) {
          await this.init(projectOwner, projectRepo, typeof currentUser !== 'undefined' ? currentUser : null);
        } else {
          return false;
        }
      }
      const { pfs } = initFs();
      if (!pfs) return false;
      try {
        const stat = await pfs.stat(`${currentRepoDir}/.git`);
        if (!(stat && stat.isDirectory())) return false;
        // an empty `.git` skeleton (refs/ and objects/ left behind, no HEAD) is not a clone: treating it as one made
        // the redo of a stuck clone return without downloading anything
        await pfs.stat(`${currentRepoDir}/.git/HEAD`);
        return true;
      } catch (_) {
        return false;
      }
    },

    /** Is the project's remote empty (new repository, no commits)? Throws if it cannot be queried (network, access). */
    async remoteIsEmpty() {
      initFs();
      const url = `${window.location.origin}/api/git/${currentOwner}/${currentRepo}`;
      const info = await git.getRemoteInfo({ http: GitHttp, url });
      const heads = (info && info.refs && info.refs.heads) || {};
      return Object.keys(heads).length === 0 && !(info && info.HEAD);
    },

    /** Deletes everything from this project's local clone (only after a failure, or when redoing an empty clone). */
    async wipe() {
      initFs();
      const rmTree = async dir => {
        let names = [];
        try { names = await pfs.readdir(dir); } catch (_) { return; }
        for (const n of names) {
          const p = `${dir}/${n}`;
          let st;
          try { st = await pfs.stat(p); } catch (_) { continue; }
          if (st.isDirectory()) { await rmTree(p); await pfs.rmdir(p).catch(() => {}); } else { await pfs.unlink(p).catch(() => {}); }
        }
      };
      // lightning-fs can leave an entry behind when other writes are still in flight: check, and try again
      for (let pass = 0; pass < 5; pass++) {
        await rmTree(currentRepoDir);
        const left = await pfs.stat(`${currentRepoDir}/.git`).then(() => true).catch(() => false);
        if (!left) return;
        await new Promise(r => setTimeout(r, 150 * (pass + 1)));
      }
      throw new Error('Could not clear the local copy of the project (the browser storage is busy). Reload the page and try again.');
    },

    /** A clone left with no commit (HEAD without a commit) while GitHub has content: the stuck state from old versions. */
    async isStuckEmpty() {
      initFs();
      if (!(await this.isCloned())) return false;
      const hasCommits = await git.resolveRef({ fs, dir: currentRepoDir, ref: 'HEAD' }).then(() => true).catch(() => false);
      if (hasCommits) return false;
      try { return !(await this.remoteIsEmpty()); } catch (_) { return false; } // if it cannot be queried: leave it alone
    },

    /** Clones the project. On failure it leaves NOTHING behind and throws the error (it never becomes an empty repository). */
    async clone(onProgress) {
      initFs();
      const url = `${window.location.origin}/api/git/${currentOwner}/${currentRepo}`;

      if (await this.isCloned()) {
        console.log('Repository already cloned locally in the browser:', currentRepoDir);
        return true;
      }

      let empty;
      try {
        empty = await this.remoteIsEmpty();
      } catch (err) {
        await this.wipe();
        throw new CloneError(describeCloneError(err), err);
      }

      if (empty) {
        // new repository, no commits (just-created or imported project): the first commit is born on "main"
        await this.wipe();
        await git.init({ fs, dir: currentRepoDir, defaultBranch: 'main' });
        await git.writeRef({ fs, dir: currentRepoDir, ref: 'HEAD', value: 'refs/heads/main', symbolic: true, force: true });
      } else {
        console.log('Cloning repository in the browser:', url);
        try {
          await git.clone({ fs, http: GitHttp, dir: currentRepoDir, url, singleBranch: true, depth: 1, onProgress: typeof onProgress === 'function' ? onProgress : undefined });
        } catch (err) {
          await this.wipe();
          throw new CloneError(describeCloneError(err), err);
        }
      }

      try {
        await git.setConfig({ fs, dir: currentRepoDir, path: 'remote.origin.url', value: url });
      } catch (_) {}
      return true;
    },

    async listFiles(subPath = '') {
      initFs();
      const targetDir = subPath ? `${currentRepoDir}/${subPath}` : currentRepoDir;
      const entries = [];

      async function scan(dir, relPrefix) {
        let items = [];
        try {
          items = await pfs.readdir(dir);
        } catch (_) {
          return;
        }

        for (const item of items) {
          if (item === '.git' || item.startsWith('.')) continue;
          const fullPath = `${dir}/${item}`;
          const relPath = relPrefix ? `${relPrefix}/${item}` : item;

          try {
            const stat = await pfs.stat(fullPath);
            if (stat.isDirectory()) {
              entries.push({ name: item, path: relPath, is_folder: true });
              await scan(fullPath, relPath);
            } else {
              entries.push({ name: item, path: relPath, is_folder: false, size: stat.size });
            }
          } catch (_) {}
        }
      }

      await scan(targetDir, subPath);
      return entries;
    },

    async readFile(relPath, encoding = 'utf8') {
      initFs();
      const cleanPath = guardPath(relPath);
      const fullPath = `${currentRepoDir}/${cleanPath}`;
      const enc = (encoding === 'uint8array' || !encoding) ? undefined : encoding;
      return await pfs.readFile(fullPath, enc);
    },

    async writeFile(relPath, content) {
      initFs();
      const cleanPath = guardPath(relPath, true);
      const fullPath = `${currentRepoDir}/${cleanPath}`;

      // Make sure parent directories exist
      const parts = cleanPath.split('/');
      let curr = currentRepoDir;
      for (let i = 0; i < parts.length - 1; i++) {
        curr += `/${parts[i]}`;
        try {
          await pfs.mkdir(curr);
        } catch (_) {}
      }

      await pfs.writeFile(fullPath, content);
      return true;
    },

    async deleteFile(relPath) {
      initFs();
      const cleanPath = guardPath(relPath, true);
      const fullPath = `${currentRepoDir}/${cleanPath}`;
      const rmTree = async dir => {
        for (const name of await pfs.readdir(dir)) {
          const p = `${dir}/${name}`;
          if ((await pfs.stat(p)).isDirectory()) await rmTree(p); else await pfs.unlink(p);
        }
        await pfs.rmdir(dir);
      };
      const stat = await pfs.stat(fullPath);
      if (stat.isDirectory()) {
        await rmTree(fullPath);
      } else {
        await pfs.unlink(fullPath);
      }
      return true;
    }
  };

  // Paths come from repositories, ZIPs and other people: they never leave the clone folder, and writes never touch .git
  function guardPath(relPath, mutating) {
    const clean = String(relPath || '').replace(/^\/+/, '');
    const segs = clean.split('/');
    if (!clean || segs.some(sg => !sg || sg === '.' || sg === '..' || /[\\\u0000-\u001f\u007f]/.test(sg))) throw new Error('Invalid file path: ' + relPath);
    if (mutating && segs.some(sg => sg.toLowerCase() === '.git')) throw new Error('Writing inside .git is not allowed: ' + relPath);
    return clean;
  }

  const isIgnoredPath = f => f === '.git' || f.startsWith('.git/') || f.startsWith('.neoleaf/last.') || f.startsWith('.neoleaf/cache/');

  window.BrowserGit = BrowserGit;
  window.CloneError = CloneError;
  // internals for the other parts (browser-git-sync.js, browser-git-compare.js), which add methods to BrowserGit
  window.__BG = { initFs, isIgnoredPath, dir: () => currentRepoDir, owner: () => currentOwner, repo: () => currentRepo, user: () => currentUser };
})();
