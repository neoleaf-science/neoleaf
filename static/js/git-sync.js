// Automatic periodic pull and push, and the manual Ctrl+S sync.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// -------------------------------------------------------------
// Automatic periodic Git sync (Auto Pull & Push)
// -------------------------------------------------------------
let isAutoSyncing = false;
let autoSyncTimer = null;

async function performAutoSync() {
  if (isAutoSyncing) return;
  if (conflictState !== null) {
    console.debug('Auto-sync skipped: conflict resolution in progress.');
    return;
  }
  if (!projectConfig || !projectConfig.autoSync) return;

  isAutoSyncing = true;
  try {
    // 1. Always check first whether the remote repository has changes
    await checkGitStatus();

    const hasRemote = gitStatusState && (gitStatusState.behind > 0);
    if (hasRemote) {
      console.log('Auto-sync: remote changes detected. Running Git Pull...');
      await gitPull();
      if (conflictState !== null) {
        console.warn('Auto-sync: conflict after Git Pull. Waiting for the user to resolve it.');
        return;
      }
      await checkGitStatus();
    }

    // 2. Check whether there are local (in-browser) changes to push
    if (isDirty) {
      await saveCurrentFile();
      await checkGitStatus();
    }

    const hasLocal = isDirty || (gitStatusState && (gitStatusState.ahead > 0 || gitStatusState.uncommitted_changes > 0));
    if (hasLocal) {
      console.log('Auto-sync: local changes detected. Running Git Push with date and time...');
      const msg = formatDefaultCommitMsg();

      if (window.BrowserGit && await BrowserGit.isCloned()) {
        updateStatus('saving', 'Auto-sync: pushing local changes (Push)...');
        await BrowserGit.push(msg);
        updateStatus('saved', 'Auto-sync completed successfully!');
        await checkGitStatus();
      }
    }
  } catch (err) {
    console.warn('Error during auto-sync:', err);
  } finally {
    isAutoSyncing = false;
  }
}

function initAutoSync() {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (projectConfig && projectConfig.autoSync) {
    const mins = Math.max(1, parseInt(projectConfig.autoSyncInterval, 10) || 5);
    const ms = mins * 60 * 1000;
    console.log(`Auto-sync enabled with an interval of ${mins} minute(s)`);
    autoSyncTimer = setInterval(performAutoSync, ms);
  }
}
window.initAutoSync = initAutoSync;
window.performAutoSync = performAutoSync;

// -------------------------------------------------------------
// Manual sync by shortcut (Ctrl+S / Cmd+S: Pull & Push)
// -------------------------------------------------------------
async function syncPullPush() {
  if (isAutoSyncing) {
    updateStatus('saving', 'Sync already in progress...');
    return;
  }
  if (conflictState !== null) {
    updateStatus('error', 'Resolve the Git conflicts before syncing');
    return;
  }

  isAutoSyncing = true;
  updateStatus('saving', 'Syncing with GitHub...');

  try {
    // 1. Save the current file in the browser if there are unsaved edits
    if (isDirty) {
      await saveCurrentFile();
    }

    // 2. Always check first whether the remote repository has changes
    await checkGitStatus();

    const hasRemote = gitStatusState && (gitStatusState.behind > 0);
    if (hasRemote) {
      updateStatus('saving', 'Pulling remote changes (Pull)...');
      await gitPull();
      if (conflictState !== null) {
        // Conflict detected in the pull: the conflict dialog was already opened by gitPull()
        return;
      }
      await checkGitStatus();
    }

    // 3. Check whether there are local changes to push
    if (isDirty) {
      await saveCurrentFile();
      await checkGitStatus();
    }

    const hasLocal = isDirty || (gitStatusState && (gitStatusState.ahead > 0 || gitStatusState.uncommitted_changes > 0));
    if (hasLocal) {
      updateStatus('saving', 'Pushing local changes (Push)...');
      const msg = formatDefaultCommitMsg();

      if (window.BrowserGit && await BrowserGit.isCloned()) {
        await BrowserGit.push(msg);
      }

      await checkGitStatus();
      updateStatus('saved', 'Synced: Push sent successfully!');
    } else {
      if (hasRemote) {
        updateStatus('saved', 'Synced: Pull completed!');
      } else {
        updateStatus('saved', 'Synced: everything up to date');
      }
    }
  } catch (err) {
    console.warn('Error during Ctrl+S sync:', err);
    updateStatus('error', 'Error syncing: ' + (err.message || err));
  } finally {
    isAutoSyncing = false;
  }
}
window.syncPullPush = syncPullPush;

window.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    syncPullPush();
  }
});
