mod head;
mod layout;
mod modals;
mod script;

use super::{esc, js_json, js_str};
use crate::drive::client::DriveFile;

/// Renders the editor shell page; project content is loaded in the browser, never here.
pub fn render(
    project_id: &str,
    project: (&str, Option<&str>),
    tree_json: &str,
    active_file: &DriveFile,
    initial_content: &str,
    user: &crate::auth::github::GitHubUser,
    drive_folder_url: &str,
) -> String {
    // the repository name and the display title, if the project has one
    let (project_name, project_title) = project;
    let escaped_initial_content = js_json(initial_content);
    let template = template();

    let tree_json_js = js_json(tree_json);
    let project_id_js = js_str(project_id);
    let active_id_js = js_str(&active_file.id);
    let current_user_js = current_user_json(user);
    let user_button = super::user_topbar_button(user, true);
    let user_profile_modal = super::user_profile_modal_html(user);
    let (ai_tab, ai_panel, ai_scripts) = ai_blocks(crate::config::ai_enabled(), user);
    super::fill(
        &template,
        &[
            // the repository name (also the PDF file name) and what the header shows: the display title when there is one
            ("PROJECT_NAME", &esc(project_name)),
            ("PROJECT_TITLE", &esc(project_title.unwrap_or(project_name))),
            // tooltip of the header: the whole title (it may be cut with an ellipsis) and the repository name
            (
                "PROJECT_TOOLTIP",
                &esc(&match project_title {
                    Some(t) => format!("{t} ({project_name})"),
                    None => project_name.to_string(),
                }),
            ),
            // the title alone (empty when the project has none), for the edit box; the pencil is the owner's (saving needs admin access)
            ("PROJECT_DISPLAY_TITLE", &esc(project_title.unwrap_or(""))),
            ("TITLE_EDIT", &title_edit_button(project_id, user)),
            ("PROJECT_ID", &project_id_js),
            ("DRIVE_FOLDER_URL", &esc(drive_folder_url)),
            ("PROVIDER_ID", user.provider.id()),
            (
                "PROVIDER_OPEN_TITLE",
                &format!("Open repository on {}", user.provider.label()),
            ),
            ("PROVIDER_ICON", &super::provider_icon(user.provider, 16)),
            ("CURRENT_USER_JSON", &current_user_js),
            ("USER_BUTTON", &user_button),
            ("USER_PROFILE_MODAL", &user_profile_modal),
            ("TREE_JSON", &tree_json_js),
            ("INITIAL_CONTENT", &escaped_initial_content),
            ("ACTIVE_FILE_ID", &active_id_js),
            ("AI_TAB", &ai_tab),
            ("AI_PANEL", &ai_panel),
            ("AI_SCRIPTS", &ai_scripts),
        ],
    )
}

/// The AI assistant's tab, panel and scripts (docs/ai-assistant-plan.md). When the assistant is off the three are empty: the page
/// then has no AI element, loads no AI script and carries no AI text. The account (provider and numeric id) is what the browser
/// keys the person's settings by, so two people on one browser never share a key.
/// The pencil that edits the display title. Saving needs admin access to the repository, so only the owner sees it
/// (the project id is `owner__repo`); the server decides again when the title is saved.
fn title_edit_button(project_id: &str, user: &crate::auth::github::GitHubUser) -> String {
    let owner = project_id.split("__").next().unwrap_or("");
    if owner.is_empty() || !owner.eq_ignore_ascii_case(&user.login) {
        return String::new();
    }
    r##"<button type="button" id="edit-title-btn" class="btn title-edit-btn" onclick="editProjectTitle()" title="Edit title" aria-label="Edit title">✏️</button>"##.to_string()
}

fn ai_blocks(enabled: bool, user: &crate::auth::github::GitHubUser) -> (String, String, String) {
    if !enabled {
        return (String::new(), String::new(), String::new());
    }
    let tab = r##"                    <button id="tab-ai-btn" class="tab-btn" onclick="switchTab('ai')" title="AI assistant (uses your own key)">✨ AI</button>
"##;
    let panel = format!(
        r##"            <!-- AI assistant (settings and conversation; calls go from the browser to the provider the person chose) -->
            <div id="ai-container" class="comments-container" data-account="{}.{}"></div>

"##,
        user.provider.id(),
        user.id
    );
    let scripts = r##"    <script src="/static/js/ai-providers.js"></script>
    <script src="/static/js/ai-tools.js"></script>
    <script src="/static/js/ai-settings.js"></script>
    <script src="/static/js/ai-chat.js"></script>
    <script src="/static/js/ai-bridge.js"></script>
    <script src="/static/js/ai-webmcp.js"></script>
"##;
    (tab.to_string(), panel, scripts.to_string())
}

/// Page template with `{{...}}` placeholders, built from the blocks in document order.
fn template() -> String {
    [
        head::head(),
        layout::top_bar(),
        layout::sidebar(),
        layout::editor_pane(),
        layout::pdf_panel(),
        modals::name_modal(),
        modals::move_modal(),
        modals::preview_modal(),
        modals::share_modal(),
        modals::project_modal_head(),
        modals::project_tab_settings(),
        modals::project_tab_packages(),
        modals::project_tab_milestones(),
        modals::project_tab_authorship(),
        modals::history_modal(),
        modals::git_push_modal(),
        modals::git_pull_modal(),
        modals::git_reset_modal(),
        modals::git_conflict_modal(),
        modals::shortcuts_modal(),
        script::script_tags(),
        script::inline_script(),
        script::page_end(),
    ]
    .concat()
}

/// JSON (as a JS string literal) of the commit author used by the browser Git.
fn current_user_json(user: &crate::auth::github::GitHubUser) -> String {
    let user_name = user.display_name();
    // author of commits made in the browser: real name and login, and the GitHub private email (id+login) so the commit links to the account
    js_json(
        &serde_json::json!({
            "name": user_name,
            "login": user.login,
            "provider": user.provider.id(),
            "email": user.provider.commit_email(user.id, &user.login),
        })
        .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ai_blocks_are_empty_when_the_assistant_is_off() {
        let user = crate::auth::github::GitHubUser {
            id: 42,
            ..Default::default()
        };
        let (tab, panel, scripts) = ai_blocks(false, &user);
        assert!(tab.is_empty() && panel.is_empty() && scripts.is_empty());
        // the template itself has no AI text either: only the three placeholders
        let page = template();
        for word in [
            "ai-settings",
            "ai-providers",
            "ai-tools",
            "ai-chat",
            "ai-webmcp",
            "ai-bridge",
            "tab-ai-btn",
            "ai-container",
            "AI assistant",
        ] {
            assert!(!page.contains(word), "{word} is in the page template");
        }
        let (tab, panel, scripts) = ai_blocks(true, &user);
        assert!(tab.contains("tab-ai-btn") && scripts.contains("/static/js/ai-settings.js") && scripts.contains("/static/js/ai-webmcp.js"));
        assert!(panel.contains(r#"data-account="github.42""#));
    }

    #[test]
    fn only_the_owner_gets_the_pencil_that_edits_the_title() {
        let mut user = crate::auth::github::GitHubUser::default();
        user.login = "Alice".into();
        assert!(title_edit_button("alice__thesis", &user).contains("edit-title-btn"));
        assert!(title_edit_button("bob__thesis", &user).is_empty());
        assert!(title_edit_button("", &user).is_empty());
    }
}
