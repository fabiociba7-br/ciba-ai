import subprocess
from pathlib import Path
from garcia_research.config import ResearchConfig
from garcia_research.models import ResearchReport
from garcia_research.publisher import GitHubPublisher

def sample_report():
    return ResearchReport(topic="OAuth2 flows", generated_at="2026-11-20T12:00:00+00:00",
                          executive_summary="Review PKCE.", insights=["Validate redirect_uri."])

def test_dirty_worktree_returns_status_and_preserves_report(tmp_path: Path, monkeypatch):
    (tmp_path / ".git").mkdir()
    publisher = GitHubPublisher(ResearchConfig(repo_path=tmp_path, branch="feature"))
    def fake_git(*args, check=True):
        if args[:2] == ("rev-parse", "--is-inside-work-tree"):
            return subprocess.CompletedProcess(args, 0, "true", "")
        if args[:2] == ("branch", "--show-current"):
            return subprocess.CompletedProcess(args, 0, "feature", "")
        if args[:1] == ("status",):
            return subprocess.CompletedProcess(args, 0, " M src/index.ts", "")
        raise AssertionError(f"Unexpected git command: {args}")
    monkeypatch.setattr(publisher, "_git", fake_git)
    result = publisher.publish(sample_report())
    assert result.status == "skipped_dirty_worktree"
    assert (tmp_path / result.markdown_path).exists()

def test_wrong_branch_returns_status(tmp_path: Path, monkeypatch):
    (tmp_path / ".git").mkdir()
    publisher = GitHubPublisher(ResearchConfig(repo_path=tmp_path, branch="main"))
    def fake_git(*args, check=True):
        if args[:2] == ("rev-parse", "--is-inside-work-tree"):
            return subprocess.CompletedProcess(args, 0, "true", "")
        if args[:2] == ("branch", "--show-current"):
            return subprocess.CompletedProcess(args, 0, "feature", "")
        raise AssertionError(f"Unexpected git command: {args}")
    monkeypatch.setattr(publisher, "_git", fake_git)
    assert publisher.publish(sample_report()).status == "skipped_wrong_branch"
