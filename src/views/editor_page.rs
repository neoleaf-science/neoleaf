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
        ],
    )
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
    js_json(&serde_json::json!({
        "name": user_name,
        "login": user.login,
        "provider": user.provider.id(),
        "email": if user.provider == crate::provider::Provider::Codeberg { format!("{}+{}@noreply.codeberg.org", user.id, user.login) } else { format!("{}+{}@users.noreply.github.com", user.id, user.login) },
    }).to_string())
}
