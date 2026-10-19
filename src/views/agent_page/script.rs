/// Page script (live status, copy buttons, install tabs).
pub(super) fn script() -> &'static str {
    r##"    <script>
        (function () {
            // outside the official domains (development), the command points to the server itself
            const t = document.getElementById('install-cmd-text');
            if (t && !/(^|\.)neoleaf\.(science|duckdns\.org)$/.test(location.hostname)) t.textContent = 'curl -fsSL ' + location.origin + '/install.sh | sh';
            var tw = document.getElementById('install-cmd-text-win');
            if (tw && !/(^|\.)neoleaf\.(science|duckdns\.org)$/.test(location.hostname)) tw.textContent = 'irm ' + location.origin + '/install.ps1 | iex';
        })();
        function copyCode(btn) {
            const pre = btn.parentElement;
            const text = pre.innerText.replace(btn.textContent, '').trim();
            navigator.clipboard.writeText(text).then(() => {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = orig; }, 2000);
            });
        }

        async function checkAgentStatus() {
            const box = document.getElementById('live-agent-status');
            const title = document.getElementById('live-status-title');
            const desc = document.getElementById('live-status-desc');
            const action = document.getElementById('live-status-action');

            try {
                const ctl = new AbortController();
                const timer = setTimeout(() => ctl.abort(), 2000);
                const r = await fetch('http://127.0.0.1:47474/v1/status', {
                    headers: { 'Origin': 'https://neoleaf.science' },
                    signal: ctl.signal
                });
                clearTimeout(timer);

                if (r.ok) {
                    const data = await r.json();
                    box.className = 'status-box online';
                    title.innerHTML = T('● Local agent detected and active on this machine!');
                    const engineList = (data.engines || []).map(e => e.name).join(', ') || T('no LaTeX compiler detected in the PATH');
                    desc.innerHTML = T('Version <strong>{0}</strong> active at <code>127.0.0.1:47474</code>. Available compilers: <strong>{1}</strong>.', data.version || '0.1.0', engineList);
                    action.innerHTML = '<span class="agent-badge badge-agent" style="padding: 6px 14px; font-size: 13px;">Ready to use</span>';
                    return;
                }
            } catch (_) {}

            box.className = 'status-box offline';
            title.innerHTML = T('○ Local agent not detected on this machine');
            desc.innerHTML = T('The browser is ready to compile via <strong>WebAssembly</strong>. To use your machine\'s native compilers, download and install the agent below.');
            action.innerHTML = '<a href="#download-section" class="btn btn-primary" style="font-size: 12px; padding: 6px 12px;">How to Install ↓</a>';
        }

        checkAgentStatus();
    </script>
"##
}
