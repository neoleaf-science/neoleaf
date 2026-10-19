/// Inline page CSS.
pub(in crate::views) fn style() -> &'static str {
    r##"    <style>
        .legal-container {
            max-width: 860px;
            margin: 0 auto;
            padding: 48px 24px 80px;
            line-height: 1.7;
            color: var(--text-primary);
        }
        .legal-header {
            margin-bottom: 40px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 24px;
        }
        .legal-header h1 {
            font-size: 32px;
            font-weight: 800;
            color: var(--text-bright);
            margin-top: 16px;
            margin-bottom: 8px;
        }
        .legal-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 999px;
            background: color-mix(in srgb, var(--green) 12%, var(--bg-primary));
            color: var(--green);
            font-size: 12px;
            font-weight: 600;
        }
        .legal-updated {
            font-size: 13px;
            color: var(--muted);
        }
        .legal-nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
        }
        .legal-section {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 24px 28px;
            margin-bottom: 24px;
        }
        .legal-section h2 {
            font-size: 20px;
            font-weight: 700;
            color: var(--text-bright);
            margin-top: 0;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .legal-section h3 {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-bright);
            margin-top: 20px;
            margin-bottom: 8px;
        }
        .legal-section p, .legal-section li {
            font-size: 14px;
            color: var(--text-primary);
        }
        .legal-section ul {
            margin: 8px 0 16px 20px;
            padding: 0;
        }
        .legal-section li {
            margin-bottom: 6px;
        }
        .highlight-box {
            background: color-mix(in srgb, var(--green) 8%, var(--bg-primary));
            border-left: 4px solid var(--green);
            padding: 14px 18px;
            border-radius: 4px;
            margin: 16px 0;
        }
        .highlight-box p {
            margin: 0;
            font-size: 13px;
            color: var(--text-bright);
            line-height: 1.6;
        }
        .contact-box {
            background: var(--log-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 16px;
            margin-top: 16px;
        }
"##
}
