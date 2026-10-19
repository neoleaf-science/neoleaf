// If the provider rejects the token (revoked/expired), API calls answer with `auth_expired: true`:
// instead of leaving the person on a screen full of errors, it clears the session and sends them to login.
(function () {
  const orig = window.fetch;
  let fired = false;
  window.fetch = async function (input) {
    const res = await orig.apply(this, arguments);
    try {
      if (!fired) {
        const u = new URL(typeof input === 'string' ? input : input.url, location.href);
        const ct = res.headers.get('content-type') || '';
        const len = Number(res.headers.get('content-length') || 0);
        // error responses are small: only those are read (does not duplicate the body of large files)
        if (u.origin === location.origin && u.pathname.startsWith('/api/') && ct.includes('application/json') && len > 0 && len < 4096) {
          res.clone().json().then(d => {
            if (d && d.auth_expired && !fired) { fired = true; location.href = '/auth/logout?expired=1'; }
          }).catch(() => {});
        }
      }
    } catch (_) { /* never gets in the way of the original call */ }
    return res;
  };
})();
