/// Inline page CSS.
pub(super) fn style() -> &'static str {
    r##"    <style>
        .agent-container {
            max-width: 900px;
            margin: 0 auto;
            padding: 48px 24px 80px;
            line-height: 1.7;
            color: var(--text-primary);
        }
        .agent-header {
            margin-bottom: 36px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 24px;
        }
        .agent-header h1 {
            font-size: 32px;
            font-weight: 800;
            color: var(--text-bright);
            margin-top: 14px;
            margin-bottom: 8px;
        }
        .agent-badges {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .agent-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
        }
        .badge-wasm {
            background: color-mix(in srgb, #0969da 14%, var(--bg-primary));
            color: #2f81f7;
            border: 1px solid color-mix(in srgb, #0969da 30%, transparent);
        }
        .badge-agent {
            background: color-mix(in srgb, var(--green) 14%, var(--bg-primary));
            color: var(--green);
            border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);
        }
        .agent-nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
        }
        .agent-section {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 24px 28px;
            margin-bottom: 28px;
        }
        .agent-section h2 {
            font-size: 20px;
            font-weight: 700;
            color: var(--text-bright);
            margin-top: 0;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .comparison-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 24px 0;
        }
        @media (max-width: 760px) {
            .comparison-grid {
                grid-template-columns: 1fr;
            }
        }
        .mode-card {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            display: flex;
            flex-direction: column;
        }
        .mode-card.featured {
            border-color: var(--green);
            box-shadow: 0 0 0 1px color-mix(in srgb, var(--green) 40%, transparent);
        }
        .mode-title {
            font-size: 17px;
            font-weight: 700;
            color: var(--text-bright);
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .mode-list {
            margin: 12px 0 0 16px;
            padding: 0;
            font-size: 13.5px;
            color: var(--text-primary);
        }
        .mode-list li {
            margin-bottom: 8px;
        }
        .table-wrap {
            overflow-x: auto;
            margin: 20px 0;
        }
        .comp-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13.5px;
            text-align: left;
        }
        .comp-table th, .comp-table td {
            padding: 10px 14px;
            border: 1px solid var(--border-color);
        }
        .comp-table th {
            background: var(--bg-tertiary);
            color: var(--text-bright);
            font-weight: 600;
        }
        .comp-table tr:nth-child(even) {
            background: color-mix(in srgb, var(--bg-secondary) 50%, transparent);
        }
        .code-box {
            position: relative;
            background: var(--log-bg, #0d1117);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 14px 16px;
            margin: 12px 0 18px;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
            font-size: 13px;
            color: #c9d1d9;
            overflow-x: auto;
        }
        .code-copy-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            padding: 4px 10px;
            font-size: 11px;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
        }
        .code-copy-btn:hover {
            color: var(--text-bright);
            border-color: var(--muted);
        }
        .status-box {
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }
        .status-box.online {
            background: color-mix(in srgb, var(--green) 12%, var(--bg-secondary));
            border: 1px solid color-mix(in srgb, var(--green) 40%, transparent);
            color: var(--text-bright);
        }
        .status-box.offline {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
        }
        .dl-hero-btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            background: #238636;
            color: #ffffff;
            font-weight: 600;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 15px;
            text-decoration: none;
            transition: background 0.15s ease;
        }
        .dl-hero-btn:hover {
            background: #2ea043;
            color: #ffffff;
        }
    </style>
"##
}
