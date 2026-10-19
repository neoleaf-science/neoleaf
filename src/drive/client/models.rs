use serde::{Deserialize, Serialize};

#[allow(dead_code)]
pub const PROJECT_TAG: &str = "[NeoLeaf]";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "mimeType", default)]
    pub mime_type: String,
    #[serde(rename = "modifiedTime")]
    pub modified_time: Option<String>,
    #[serde(default)]
    pub shared: Option<bool>,
    #[serde(
        rename = "md5Checksum",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub md5: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parents: Option<Vec<String>>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveFileList {
    pub files: Vec<DriveFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectCollaborator {
    pub login: String,
    pub avatar_url: Option<String>,
    pub is_pending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub is_shared: bool,
    pub modified_time: Option<String>,
    pub web_view_link: Option<String>,
    pub owner_login: String,
    pub owner_avatar: Option<String>,
    pub collaborators: Vec<ProjectCollaborator>,
    #[serde(default)]
    pub topics: Vec<String>,
    /// When the project was moved to the trash (ISO, UTC); None if it is not in the trash.
    #[serde(default)]
    pub deleted_at: Option<String>,
    /// Display title saved in the repository description (`NeoLeaf: <title>`), if the project has one.
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    pub id: String,
    pub role: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "emailAddress", default)]
    pub email: Option<String>,
    #[serde(rename = "displayName", default)]
    pub name: Option<String>,
    #[serde(rename = "photoLink", default)]
    pub photo: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub(super) struct GitHubRepoOwner {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub(super) struct GitHubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub owner: GitHubRepoOwner,
    pub description: Option<String>,
    pub html_url: String,
    pub updated_at: Option<String>,
    pub topics: Option<Vec<String>>,
    pub default_branch: Option<String>,
}

impl GitHubRepo {
    pub fn is_neoleaf_project(&self) -> bool {
        self.topics
            .as_deref()
            .map(|t| t.iter().any(|topic| topic.eq_ignore_ascii_case("neoleaf")))
            .unwrap_or(false)
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub(super) struct GitHubInviter {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub(super) struct GitHubInvitation {
    pub id: u64,
    pub repository: GitHubRepo,
    pub inviter: Option<GitHubInviter>,
    pub permissions: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeoLeafInvitation {
    pub id: u64,
    pub repo_name: String,
    pub repo_full_name: String,
    pub owner_login: String,
    pub inviter_login: String,
    pub inviter_avatar: Option<String>,
    pub permissions: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_only_with_neoleaf_topic() {
        let repo_com_tag = GitHubRepo {
            id: 1,
            name: "my-paper".to_string(),
            full_name: "user/my-paper".to_string(),
            owner: GitHubRepoOwner {
                login: "user".to_string(),
                avatar_url: None,
            },
            description: None,
            html_url: "https://github.com/user/my-paper".to_string(),
            updated_at: None,
            topics: Some(vec!["neoleaf".to_string()]),
            default_branch: None,
        };
        assert!(repo_com_tag.is_neoleaf_project());

        let repo_name_neoleaf = GitHubRepo {
            id: 2,
            name: "neoleaf".to_string(),
            full_name: "user/neoleaf".to_string(),
            owner: GitHubRepoOwner {
                login: "user".to_string(),
                avatar_url: None,
            },
            description: None,
            html_url: "https://github.com/user/neoleaf".to_string(),
            updated_at: None,
            topics: Some(vec!["rust".to_string()]),
            default_branch: None,
        };
        assert!(!repo_name_neoleaf.is_neoleaf_project());

        let repo_desc_neoleaf = GitHubRepo {
            id: 3,
            name: "other-project".to_string(),
            full_name: "user/other-project".to_string(),
            owner: GitHubRepoOwner {
                login: "user".to_string(),
                avatar_url: None,
            },
            description: Some("[NeoLeaf] My project".to_string()),
            html_url: "https://github.com/user/other-project".to_string(),
            updated_at: None,
            topics: None,
            default_branch: None,
        };
        assert!(!repo_desc_neoleaf.is_neoleaf_project());
    }
}
