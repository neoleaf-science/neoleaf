// Stylesheet of the admin page.

/// Inline `<style>` block with the admin page CSS.
pub(super) fn styles() -> &'static str {
    r##"    <style>
        .admin-wrap {
            max-width: 1200px;
            margin: 0 auto;
            padding: 24px 20px 60px;
        }
        .admin-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            flex-wrap: wrap;
            gap: 16px;
        }
        .version-badge {
            font-size: 12px;
            font-weight: 700;
            color: var(--green);
            background: color-mix(in srgb, var(--green) 14%, var(--bg-primary));
            border: 1px solid color-mix(in srgb, var(--green) 40%, var(--border-color));
            border-radius: 999px;
            padding: 2px 9px;
            letter-spacing: 0.3px;
        }
        .admin-title-area h1 {
            font-size: 26px;
            font-weight: 800;
            color: var(--text-bright);
            margin: 0 0 6px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            background: color-mix(in srgb, var(--green) 12%, var(--bg-primary));
            color: var(--green);
        }
        .pulse-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--green);
            box-shadow: 0 0 8px var(--green);
            animation: pulse-glow 2s infinite;
        }
        @keyframes pulse-glow {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.85); }
        }
        .grid-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 18px;
            margin-bottom: 24px;
        }
        .admin-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            display: flex;
            flex-direction: column;
        }
        .card-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }
        .card-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card-big {
            font-size: 30px;
            font-weight: 800;
            color: var(--text-bright);
            margin-bottom: 6px;
            font-variant-numeric: tabular-nums;
        }
        .card-sub {
            font-size: 12px;
            color: var(--muted);
            line-height: 1.5;
        }
        .progress-bar-bg {
            width: 100%;
            height: 8px;
            border-radius: 4px;
            background: var(--border-color);
            overflow: hidden;
            margin: 10px 0 6px;
        }
        .progress-bar-fill {
            height: 100%;
            border-radius: 4px;
            background: var(--green);
            transition: width 0.4s ease;
        }
        .admin-tabs { display: flex; gap: 6px; margin: 0 0 18px; border-bottom: 1px solid var(--border-color); }
        .admin-tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 14px; font-size: 14px; color: var(--muted); cursor: pointer; }
        .admin-tab.active { color: var(--text-bright); border-bottom-color: var(--green); font-weight: 600; }
        .mf { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
        .mf .form-control { font-size: 13px; }
        .admin-table-box {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            overflow: hidden;
            margin-bottom: 24px;
        }
        .table-header-bar {
            padding: 16px 20px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
        }
        .table-header-bar h2 {
            font-size: 17px;
            font-weight: 700;
            color: var(--text-bright);
            margin: 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .admin-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }
        .admin-table th {
            padding: 10px 14px;
            font-size: 11px;
            font-weight: 700;
            color: var(--muted);
            text-transform: uppercase;
            background: var(--bg-primary);
            border-bottom: 1px solid var(--border-color);
        }
        .server-meta-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 16px;
            padding: 16px 20px;
            font-size: 13px;
        }
        .meta-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .meta-label {
            color: var(--muted);
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 600;
        }
        .meta-val {
            color: var(--text-bright);
            font-weight: 600;
        }
        .btn-block, .btn-unblock {
            font: inherit; font-size: 12px; cursor: pointer; border-radius: 6px; padding: 4px 10px;
            background: transparent; border: 1px solid var(--border-color); color: var(--text-primary);
        }
        .btn-block { color: var(--danger-color, #f85149); border-color: color-mix(in srgb, var(--danger-color, #f85149) 50%, var(--border-color)); }
        .btn-block:hover { background: color-mix(in srgb, var(--danger-color, #f85149) 14%, transparent); }
        .btn-unblock:hover { background: var(--bg-hover); }
    </style>"##
}
