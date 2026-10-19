mod style;

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
    <title>Terms of Use - NeoLeaf</title>
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
            <div class="legal-badge">📄 Terms of Service</div>
            <h1>Terms of Service</h1>
            <p class="legal-updated" data-i18n-html>Last updated: October 2026 · NeoLeaf (<code>https://neoleaf.science</code>)</p>
        </header>

"##
}

/// Section 1. Acceptance of the Terms.
fn section_1() -> &'static str {
    r##"        <div class="legal-section">
            <h2>1. Acceptance of the Terms</h2>
            <p data-i18n-html>
                Welcome to <strong>NeoLeaf</strong>! By accessing or using our platform at <code>https://neoleaf.science</code>, you declare that you have read, understood and agreed to these Terms of Use and to our <a href="/privacy" style="color: var(--green); text-decoration: underline;">Privacy Policy</a>.
            </p>
            <p>
                If you disagree with any provision of these terms, you must not use the service.
            </p>
        </div>

"##
}

/// Section 2. Description of the Platform.
fn section_2() -> &'static str {
    r##"        <div class="legal-section">
            <h2>2. Description of the Platform</h2>
            <p>
                NeoLeaf is an integrated environment for writing, reviewing and collaborating in real time on LaTeX documents, synchronized directly with the user's repositories on GitHub or Codeberg.
            </p>
            <p>
                Document compilation and PDF generation are run directly by the user's browser using WebAssembly (WASM) technology. The user is free to save, manage versions and synchronize their commits with GitHub or Codeberg.
            </p>
        </div>

"##
}

/// Section 3. Intellectual Property and Your Copyright.
fn section_3() -> &'static str {
    r##"        <div class="legal-section">
            <h2>3. Intellectual Property and Your Copyright</h2>
            <p data-i18n-html>
                <strong>You are the sole owner of your papers, texts and code:</strong>
            </p>
            <ul>
                <li>All content created, edited, uploaded or compiled by you in NeoLeaf remains your exclusive intellectual property.</li>
                <li>NeoLeaf does not claim any ownership, licensing or control rights over the academic texts, graphics, theses, dissertations or papers produced by users.</li>
                <li>Because it is hosted in your own repository (on GitHub or Codeberg), the license of your code/paper (whether proprietary, Creative Commons, MIT, etc.) is entirely your choice.</li>
            </ul>
        </div>

"##
}

/// Section 4. Responsibilities and Acceptable Use.
fn section_4() -> &'static str {
    r##"        <div class="legal-section">
            <h2>4. Responsibilities and Acceptable Use</h2>
            <p>By using NeoLeaf, you agree to:</p>
            <ul>
                <li>Keep the security and integrity of your access credentials and your GitHub or Codeberg account;</li>
                <li>Not use the platform to store, distribute or disseminate content that violates third-party rights, other people's intellectual property or that contains malicious code;</li>
                <li>Not attempt intentional overload, malicious reverse engineering or attacks on the servers and real-time collaboration systems.</li>
            </ul>
        </div>

"##
}

/// Section 5. Limitation of Liability and Availability.
fn section_5() -> &'static str {
    r##"        <div class="legal-section">
            <h2>5. Limitation of Liability and Availability</h2>
            <p data-i18n-html>
                NeoLeaf is provided "as is" (<em>as is</em>), without warranties of any kind, express or implied.
            </p>
            <p>
                Although we strive to keep the platform always accessible, fast and reliable, we do not guarantee that operation will be uninterrupted or free of temporary errors. Since NeoLeaf uses GitHub or Codeberg as primary storage, we recommend that users keep their commits and pushes synchronized regularly.
            </p>
        </div>

"##
}

/// Section 6. Changes to these Terms.
fn section_6() -> &'static str {
    r##"        <div class="legal-section">
            <h2>6. Changes to these Terms</h2>
            <p>
                We reserve the right to update these terms periodically to reflect improvements to the system or legal adjustments. The date of the latest version will always appear at the top of this page.
            </p>
        </div>

"##
}

/// Section 7. Contact Channel.
fn section_7() -> &'static str {
    r##"        <div class="legal-section">
            <h2>7. Contact Channel</h2>
            <p>
                For any questions, suggestions or notices regarding these Terms of Use, contact us by email:
            </p>
            <div class="contact-box">
                <p style="margin: 0; font-size: 14px;" data-i18n-html>
                    Official contact email: <a href="mailto:contact@neoleaf.science" style="color: var(--green); text-decoration: underline; font-weight: 600;">contact@neoleaf.science</a>
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
