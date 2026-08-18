use serde::Serialize;
use std::{collections::HashSet, process::Command};

fn git_base_command(path: Option<&str>) -> Command {
    let mut cmd = Command::new("git");
    if let Some(p) = path {
        if !p.is_empty() {
            cmd.arg("-C").arg(p);
        }
    }
    cmd
}

fn list_git_branches_sync(path: Option<String>) -> Result<Vec<String>, String> {
    // 为了避免在巨大仓库中一次性返回成千上万个 ref，
    // 这里对返回的分支数量做一个上限，只保留最近若干条即可满足 UI 选择需求。
    const MAX_BRANCHES: usize = 200;

    let mut cmd = git_base_command(path.as_deref());
    cmd.args([
        "branch",
        "--format=%(refname:short)",
        "--sort=-committerdate",
        "--all",
    ]);

    let output = cmd.output().map_err(|e| format!("git exec failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git branch failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let mut branches = Vec::new();
    let mut seen = HashSet::new();

    // Preserve recency ordering from git; just de‑duplicate.
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let name = line.trim();
        if name.is_empty() || name == "HEAD" {
            continue;
        }
        if seen.insert(name.to_string()) {
            branches.push(name.to_string());
            if branches.len() >= MAX_BRANCHES {
                break;
            }
        }
    }

    Ok(branches)
}

#[tauri::command]
pub async fn list_git_branches(path: Option<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list_git_branches_sync(path))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct GitBranchOverview {
    pub default_branch: Option<String>,
    pub recent_branches: Vec<String>,
}

fn git_branch_overview_sync(
    path: Option<String>,
    recent_limit: Option<usize>,
) -> Result<GitBranchOverview, String> {
    let repo_path = path.unwrap_or_default();
    let limit = recent_limit.unwrap_or(10).max(1);

    // Resolve default branch from remote HEAD if available.
    let default_branch = {
        let mut cmd = git_base_command(Some(repo_path.as_str()));
        cmd.args(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
        match cmd.output() {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout);
                text.trim()
                    .rsplit('/')
                    .next()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
            }
            _ => None,
        }
    };

    // Collect recent branches by commit date (local + origin/*).
    let mut cmd = git_base_command(Some(repo_path.as_str()));
    cmd.args([
        "for-each-ref",
        "--sort=-committerdate",
        &format!("--count={}", limit * 3),
        "--format=%(refname:short)",
        "refs/heads",
        "refs/remotes/origin",
    ]);

    let output = cmd.output().map_err(|e| format!("git exec failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git for-each-ref failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let mut recent = Vec::new();
    let mut seen = HashSet::new();

    // Preserve ordering from git output.
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let name = line.trim();
        if name.is_empty() || name == "HEAD" || name.ends_with("/HEAD") {
            continue;
        }
        if seen.insert(name.to_string()) {
            recent.push(name.to_string());
        }
        if recent.len() >= limit * 2 {
            break;
        }
    }

    // Trim to requested limit.
    recent.truncate(limit);

    Ok(GitBranchOverview {
        default_branch,
        recent_branches: recent,
    })
}

#[tauri::command]
pub async fn git_branch_overview(
    path: Option<String>,
    recent_limit: Option<usize>,
) -> Result<GitBranchOverview, String> {
    tauri::async_runtime::spawn_blocking(move || git_branch_overview_sync(path, recent_limit))
        .await
        .map_err(|e| e.to_string())?
}
