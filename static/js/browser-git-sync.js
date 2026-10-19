// NeoLeaf Browser-First Git Engine (part 2): status, commit, push, pull and remote change check.
// Adds methods to window.BrowserGit; shares internals through window.__BG (see browser-git.js).
(function () {
  'use strict';
  const { initFs, isIgnoredPath } = window.__BG;
  const __BG = window.__BG;

  Object.assign(window.BrowserGit, {
    async status() {
      const { fs, pfs } = initFs();
      if (!(await this.isCloned())) {
        return { uncommitted: false, changes: [] };
      }

      try {
        const matrix = await git.statusMatrix({
          fs,
          dir: __BG.dir(),
          filter: f => !isIgnoredPath(f)
        });

        // statusMatrix: [filepath, HEAD, WORKDIR, STAGE]
        // [1, 1, 1] unmodified
        // [0, 2, 0] new, unstaged
        // [1, 2, 1] modified, unstaged
        // [1, 0, 1] deleted, unstaged
        const modified = matrix.filter(([file, head, workdir, stage]) => {
          return !(head === 1 && workdir === 1 && stage === 1);
        });

        return {
          uncommitted: modified.length > 0,
          changes: modified.map(([file, head, workdir, stage]) => ({
            file,
            isNew: head === 0,
            isModified: head === 1 && workdir === 2,
            isDeleted: workdir === 0
          }))
        };
      } catch (err) {
        console.warn('Error getting git status in the browser:', err);
        return { uncommitted: false, changes: [] };
      }
    },

    async commit(message) {
      const { fs, pfs } = initFs();
      const statusInfo = await this.status();

      // Add all changed files
      for (const change of statusInfo.changes) {
        // the status may list a file that is no longer on disk (e.g. a previous add that failed): treat it as deleted
        const exists = await pfs.stat(`${__BG.dir()}/${change.file}`).then(() => true).catch(() => false);
        if (change.isDeleted || !exists) {
          await git.remove({ fs, dir: __BG.dir(), filepath: change.file }).catch(() => {});
        } else {
          await git.add({ fs, dir: __BG.dir(), filepath: change.file });
        }
      }

      const author = {
        name: __BG.user().name || __BG.user().login || 'NeoLeaf Author',
        email: __BG.user().email || `${__BG.user().login || 'user'}@users.noreply.github.com`
      };

      const sha = await git.commit({
        fs,
        dir: __BG.dir(),
        author: author,
        message: message || 'Update via NeoLeaf'
      });

      console.log('Local commit created in the browser:', sha);
      return sha;
    },

    async push(commitMessage) {
      const { fs, pfs } = initFs();
      if (commitMessage) {
        await this.commit(commitMessage);
      }

      const url = `${window.location.origin}/api/git/${__BG.owner()}/${__BG.repo()}`;
      console.log('Pushing from the browser to:', url);

      let currentBranch = 'main';
      try {
        currentBranch = (await git.currentBranch({ fs, dir: __BG.dir() })) || 'main';
      } catch (_) {}

      const res = await git.push({
        fs,
        http: GitHttp,
        dir: __BG.dir(),
        url: url,
        ref: currentBranch
      });

      console.log('Git push finished successfully:', res);
      return res;
    },

    async pull() {
      const { fs, pfs } = initFs();
      const url = `${window.location.origin}/api/git/${__BG.owner()}/${__BG.repo()}`;
      console.log('Pulling from GitHub into the browser:', url);

      const author = {
        name: __BG.user().name || __BG.user().login || 'NeoLeaf Author',
        email: __BG.user().email || `${__BG.user().login || 'user'}@users.noreply.github.com`
      };

      try {
        await git.pull({
          fs,
          http: GitHttp,
          dir: __BG.dir(),
          url: url,
          singleBranch: true,
          author: author
        });
        console.log('Git pull finished successfully');
        return { success: true };
      } catch (err) {
        console.warn('Error during git.pull in the browser:', err);
        const filepaths = (err.data && err.data.filepaths) || [];
        if (err.name === 'MergeConflictError' || filepaths.length > 0) {
          return { success: false, conflict: true, files: filepaths, error: err.message };
        }
        throw err;
      }
    },

    async hasRemoteChanges() {
      const { fs, pfs } = initFs();
      try {
        const currentBranch = (await git.currentBranch({ fs, dir: __BG.dir() }).catch(() => null)) || 'main';
        const url = `${window.location.origin}/api/git/${__BG.owner()}/${__BG.repo()}`;
        await git.fetch({
          fs,
          http: GitHttp,
          dir: __BG.dir(),
          url: url,
          singleBranch: true
        });
        const localOid = await git.resolveRef({ fs, dir: __BG.dir(), ref: `refs/heads/${currentBranch}` }).catch(() => null);
        const remoteOid = await git.resolveRef({ fs, dir: __BG.dir(), ref: `refs/remotes/origin/${currentBranch}` }).catch(() => null);
        if (!localOid || !remoteOid) return false;
        return localOid !== remoteOid;
      } catch (err) {
        console.debug('Error checking remote changes in the browser:', err);
        return false;
      }
    }
  });
})();
