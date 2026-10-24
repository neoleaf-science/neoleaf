pub(super) mod style;

/// Assembles the page from its blocks, in document order.
pub fn render() -> String {
    [
        head_start(),
        style::style(),
        head_end_and_nav(),
        header(),
        section_1(),
        section_2(),
        section_3(),
        section_4(),
        section_5(),
        section_6(),
        section_7(),
        section_8(),
        footer(),
    ]
    .concat()
}

/// Document head up to the shared stylesheet link.
fn head_start() -> &'static str {
    r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy and LGPD - NeoLeaf</title>
    <link rel="icon" type="image/png" href="/static/img/favicon.png">
    <script src="/static/js/theme.js"></script>
    <script src="/static/js/i18n.js"></script>
    <link rel="stylesheet" href="/static/css/editor.css">
"##
}

/// Closes the head and opens the body with the navigation bar.
fn head_end_and_nav() -> &'static str {
    r##"    </style>
</head>
<body class="dashboard-body">
    <div class="legal-container">
        <div class="legal-nav">
            <a href="/" class="btn" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                ← Back to NeoLeaf
            </a>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span data-lang-picker></span>
                <span data-theme-picker></span>
            </div>
        </div>

        <div id="legal-lang-note" hidden role="note" style="margin: 0 0 16px; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px; background: var(--bg-secondary, rgba(255,255,255,0.04));">This page is only available in English, Portuguese, Spanish and Chinese. The English text is shown instead.</div>

"##
}

/// Page header with badge, title and last-updated line.
fn header() -> &'static str {
    r##"        <header class="legal-header">
            <div class="legal-badge">🔒 General Data Protection Law (LGPD)</div>
            <h1>Privacy Policy</h1>
            <p class="legal-updated" data-i18n-html>Last updated: October 2026 · NeoLeaf (<code>https://neoleaf.science</code>)</p>
        </header>

"##
}

/// Section 1. Commitment to Privacy and the LGPD.
fn section_1() -> &'static str {
    r##"        <div class="legal-section">
            <h2>1. Commitment to Privacy and the LGPD</h2>
            <p data-i18n-html>
                <strong>NeoLeaf</strong> values the privacy, sovereignty and security of the data of its users, researchers, academics and developers. This Privacy Policy explains clearly, transparently and accessibly how we handle data in accordance with the <strong>Brazilian General Data Protection Law (LGPD, Law No. 13.709/2018)</strong> and other applicable international legislation.
            </p>
            <p data-i18n-html>
                Our architecture was designed under the principle of <strong>Privacy by Design</strong> and <strong>Data Minimization (Art. 6, III of the LGPD)</strong>: we collect only what is strictly necessary to provide the editor experience and the synchronization with your GitHub or Codeberg.
            </p>
        </div>

"##
}

/// Section 2. Privacy-Oriented Architecture: 100% Compilation in the Browser.
fn section_2() -> &'static str {
    r##"        <div class="legal-section">
            <h2>2. Privacy-Oriented Architecture: 100% Compilation in the Browser</h2>
            <div class="highlight-box">
                <p data-i18n-html>
                    <strong>⚡ Your LaTeX code and papers are never compiled on our servers.</strong><br>
                    LaTeX documents are compiled entirely inside the user's web browser, using engines compiled to WebAssembly (WASM). The text files, bibliographies, images and the generated PDF files are processed on your machine and stored directly in your repository on GitHub or Codeberg.
                </p>
            </div>
            <p>
                Unlike legacy cloud platforms, the NeoLeaf server does not process or inspect the academic or intellectual content of your texts to generate the PDF. Your data stays under your control and on your Git infrastructure.
            </p>
        </div>

"##
}

/// Section 3. Personal Data Processed and Purposes.
fn section_3() -> &'static str {
    r##"        <div class="legal-section">
            <h2>3. Personal Data Processed and Purposes</h2>
            <p>The only data processed by NeoLeaf falls into the following categories:</p>
            <ul>
                <li data-i18n-html>
                    <strong>Authentication Data (GitHub or Codeberg OAuth)</strong>: numeric ID on the chosen service, username (<code>login</code>), public display name, registered email and public profile picture (avatar).<br>
                    <em>Purpose:</em> Identify your session, show your participation in collaborative projects and check access permissions (Legal basis: Art. 7, V of the LGPD, performance of a contract).
                </li>
                <li data-i18n-html>
                    <strong>Access Tokens (GitHub or Codeberg)</strong>: Tokens granted by you at sign-in to access repositories tagged <code>[neoleaf]</code>. On Codeberg, NeoLeaf also keeps the refresh token, used to keep the session alive. The server keeps them in an encrypted file (AES-256-GCM).<br>
                    <em>Purpose:</em> Allow cloning, commit (Push/Pull) and synchronization operations with your repository on GitHub or Codeberg (Legal basis: Art. 7, V of the LGPD).
                </li>
                <li data-i18n-html>
                    <strong>Real-Time Collaboration</strong>: Cursor presence, text selection and simultaneous edits shared among authorized collaborators.<br>
                    <em>Purpose:</em> Real-time synchronization between you and the people you invited to your repository on GitHub or Codeberg. Signaling data is ephemeral and discarded after the WebSocket session ends.
                </li>
                <li data-i18n-html>
                    <strong>Technical Connection Logs</strong>: Source IP address, date/time of the request, accessed URL and the browser's User-Agent header.<br>
                    <em>Purpose:</em> Ensure operational security, mitigate denial-of-service (DDoS) attacks and meet the legal record-keeping obligations of the Marco Civil da Internet (Law No. 12.965/2014, Art. 15).
                </li>
            </ul>
        </div>

"##
}

/// Section 4. No Advertising Trackers.
fn section_4() -> &'static str {
    r##"        <div class="legal-section">
            <h2>4. No Advertising Trackers</h2>
            <p data-i18n-html>
                NeoLeaf <strong>does not sell, rent or share</strong> users' personal data with advertising partners or data brokers.
            </p>
            <p data-i18n-html>
                Our system <strong>does not include</strong>:
            </p>
            <ul>
                <li>No tracking pixel (such as Meta Pixel or TikTok Pixel);</li>
                <li>No third-party behavioral marketing tool or invasive analytics;</li>
                <li>No targeted advertising.</li>
            </ul>
        </div>

"##
}

/// Section 5. Use of Cookies and Local Storage.
fn section_5() -> &'static str {
    r##"        <div class="legal-section">
            <h2>5. Use of Cookies and Local Storage</h2>
            <p>NeoLeaf uses only cookies and storage features that are strictly necessary for secure technical operation:</p>
            <ul>
                <li data-i18n-html><code>latex_session</code>: Cryptographic identifier of the active session, generated on the server with the <code>HttpOnly</code>, <code>Secure</code> and <code>SameSite=Lax</code> attributes (expires 30 days after sign-in).</li>
                <li data-i18n-html><code>oauth_state</code>: Temporary token protecting against cross-site request forgery (CSRF) attacks, valid for 10 minutes during sign-in.</li>
                <li data-i18n-html><code>ld_lang</code> / <code>ld_theme</code> (or LocalStorage): Records your visual preferences (light/dark theme) and selected language.</li>
                <li data-i18n-html><code>IndexedDB (Browser)</code>: The local copy of the projects you open (files and Git history), kept on your own computer so the editor is fast. <strong>NeoLeaf does not encrypt this copy.</strong> Anyone who can use your browser profile can read it with the browser's developer tools. On a shared computer, use a separate browser profile or a private window, turn on your operating system's disk encryption, and use <em>Sign out</em>: it deletes all NeoLeaf data stored in the browser (your language and theme choices stay). You can also see and remove local copies at any time in your profile, in the Storage tab.</li>
            </ul>
        </div>

"##
}

/// Section 6. Strictly Necessary Sharing with Third Parties.
fn section_6() -> &'static str {
    r##"        <div class="legal-section">
            <h2>6. Strictly Necessary Sharing with Third Parties</h2>
            <p>To keep the service online with high availability and security, data travels exclusively through the following infrastructure partners:</p>
            <ul>
                <li data-i18n-html><strong>GitHub Inc.</strong>: For authentication via the OAuth protocol and operations on the Git repository of the user who signs in with GitHub.</li>
                <li data-i18n-html><strong>Codeberg e.V.</strong>: For authentication via the OAuth protocol and operations on the Git repository of the user who signs in with Codeberg.</li>
                <li data-i18n-html><strong>Cloudflare Inc.</strong>: Content delivery network (CDN), protection against DDoS attacks and encrypted SSL/TLS termination.</li>
                <li data-i18n-html><strong>Oracle Cloud Infrastructure</strong>: Application server where the NeoLeaf binary runs in a restricted and protected way.</li>
            </ul>
            <p data-i18n-html><strong>Services your browser contacts directly,</strong> not through NeoLeaf, and only in these cases: the editor libraries (Monaco and PDF.js) are delivered by Cloudflare's cdnjs; the home page loads the Green Web Foundation badge (app.greenweb.org) to show that the hosting runs on green energy; the spell check dictionaries are downloaded from GitHub (raw.githubusercontent.com, with the jsDelivr mirror as a backup), only after you agree, and kept in your browser; when you open a Typst project, one font (New Computer Modern) is downloaded from GitHub (raw.githubusercontent.com, with the jsDelivr mirror as a backup) and kept in your browser, and the Typst packages a document imports (packages.typst.org) are downloaded when you compile it; and in the References tab your searches go from your browser to the paper services you use (Crossref, OpenAlex, PubMed, Europe PMC, DOAJ, HAL, Zenodo, OpenAIRE and Unpaywall; arXiv and DBLP are queried through the NeoLeaf server, which does not log the query). These services receive your IP address and, in the References tab, the search text, and they have their own privacy policies. NeoLeaf does not send them your project files.</p>
        </div>

"##
}

/// Section 7. Your Rights as a Data Subject (Art. 18 of the LGPD).
fn section_7() -> &'static str {
    r##"        <div class="legal-section">
            <h2>7. Your Rights as a Data Subject (Art. 18 of the LGPD)</h2>
            <p>You have the full rights provided for by Article 18 of the LGPD, including:</p>
            <ul>
                <li data-i18n-html><strong>Confirmation and Access:</strong> Check which data we keep and access your projects at any time.</li>
                <li data-i18n-html><strong>Full Portability:</strong> Since your projects are ordinary Git repositories on GitHub or Codeberg, you can clone them, export them and use them in any other environment without any technological lock-in (*vendor lock-in*).</li>
                <li data-i18n-html><strong>Erasure and Revocation:</strong> When you click the Sign out (Logout) button, your session is immediately revoked on the server and the NeoLeaf data stored in your browser is deleted (your language and theme choices stay). You can revoke NeoLeaf's authorization at any time directly in your <a href="https://github.com/settings/applications" target="_blank" rel="noopener" style="color: var(--green); text-decoration: underline;">GitHub Application Settings</a> or on <a href="https://codeberg.org/user/settings/applications" target="_blank" rel="noopener" style="color: var(--green); text-decoration: underline;">Codeberg</a>.</li>
                <li data-i18n-html><strong>Account deletion:</strong> You can delete your account at any time by clicking your name (profile) and "Delete my account". Deletion ends all your sessions, revokes NeoLeaf's authorization on your GitHub account (people who signed in with Codeberg remove the authorization in Codeberg's own application settings) and erases the information NeoLeaf keeps on the server (the session, with the GitHub or Codeberg access token), without changing any repository. Your project files are not on the server: they are in your browser's storage (which you can clear in its settings) and in your repository (GitHub or Codeberg). Only the technical connection records that the law requires us to keep remain (Marco Civil da Internet, Art. 15).</li>
            </ul>
        </div>

"##
}

/// Section 8. Data Protection Officer and Contact Channel.
fn section_8() -> &'static str {
    r##"        <div class="legal-section">
            <h2>8. Data Protection Officer and Contact Channel</h2>
            <p>
                To exercise your rights as a data subject, request clarification about the processing of personal data or send any question about our privacy, contact our team directly:
            </p>
            <div class="contact-box">
                <p style="margin: 0 0 6px 0; font-weight: 600; color: var(--text-bright);">NeoLeaf Privacy Channel:</p>
                <p style="margin: 0; font-size: 14px;" data-i18n-html>
                    Official email: <a href="mailto:contact@neoleaf.science" style="color: var(--green); text-decoration: underline; font-weight: 600;">contact@neoleaf.science</a>
                </p>
                <p style="margin: 6px 0 0 0; font-size: 12px; color: var(--muted);">
                    Service in accordance with the guidelines of the National Data Protection Authority (ANPD).
                </p>
            </div>
        </div>

"##
}

/// Closing link and end of the document.
fn footer() -> &'static str {
    r##"        <div style="text-align: center; margin-top: 40px;">
            <a href="/" class="btn btn-primary" style="text-decoration: none; padding: 10px 24px;">Back to the Home Page</a>
        </div>
    </div>
</body>
</html>"##
}
