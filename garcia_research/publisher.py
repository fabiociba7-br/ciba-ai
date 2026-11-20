"""Safe local Git publisher for research reports."""
from __future__ import annotations
import json
import logging
import re
import subprocess
from pathlib import Path
from .config import ResearchConfig
from .exceptions import GitPublisherError
from .models import PublishResult, ResearchReport

logger = logging.getLogger(__name__)

class GitHubPublisher:
    """Publishes only report paths; never resets, cleans, rebases or force-pushes."""
    def __init__(self, config: ResearchConfig) -> None:
        self.config = config
        if config.repo_path is None:
            raise ValueError("repo_path is required to initialize GitHubPublisher.")
        self.repo_path = Path(config.repo_path).resolve()

    def _git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(["git", *args], cwd=self.repo_path, text=True,
                                capture_output=True, check=False)
        if check and result.returncode:
            raise GitPublisherError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
        return result

    @staticmethod
    def _slug(topic: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", topic.casefold()).strip("-")[:64] or "research"

    @staticmethod
    def _markdown(report: ResearchReport) -> str:
        lines = [f"# Research: {report.topic}", "", f"Generated: {report.generated_at}",
                 "", "## Executive summary", "", report.executive_summary, "", "## Insights", ""]
        lines.extend(f"- {item}" for item in report.insights)
        lines.extend(["", "## Sources", ""])
        for index, source in enumerate(report.sources, 1):
            lines.extend([f"### {index}. {source.title}", "", source.snippet, "",
                          f"URL: {source.url}", ""])
        lines.extend(["## Code snippets", ""])
        if not report.code_snippets:
            lines.append("No code snippets were extracted.")
        for item in report.code_snippets:
            lines.extend([f"Source: {item['source']}", "", "```text",
                          item["content"], "```", ""])
        return "\n".join(lines).rstrip() + "\n"

    def publish(self, report: ResearchReport) -> PublishResult:
        if not self.repo_path.exists():
            raise GitPublisherError(f"Repository path does not exist: {self.repo_path}")
        inside = self._git("rev-parse", "--is-inside-work-tree", check=False)
        if inside.returncode:
            raise GitPublisherError(f"Not a Git repository: {self.repo_path}")
        current_branch = self._git("branch", "--show-current").stdout.strip()
        if current_branch != self.config.branch:
            return PublishResult(status="skipped_wrong_branch",
                message=f"Current branch is {current_branch!r}; expected {self.config.branch!r}.",
                branch=current_branch or None)

        dirty_before = self._git("status", "--porcelain").stdout.strip()
        reports_dir = self.repo_path / self.config.reports_dir
        reports_dir.mkdir(parents=True, exist_ok=True)
        stamp = report.generated_at[:19].replace("-", "").replace(":", "").replace("T", "-")
        stem = f"{stamp}-{self._slug(report.topic)}"
        md_path, json_path = reports_dir / f"{stem}.md", reports_dir / f"{stem}.json"
        md_path.write_text(self._markdown(report), encoding="utf-8")
        json_path.write_text(json.dumps(report.to_dict(), ensure_ascii=False, indent=2),
                             encoding="utf-8")
        rel_md = md_path.relative_to(self.repo_path).as_posix()
        rel_json = json_path.relative_to(self.repo_path).as_posix()

        if dirty_before:
            return PublishResult(status="skipped_dirty_worktree",
                message="Reports saved locally; commit/push skipped because the worktree was already dirty.",
                markdown_path=rel_md, json_path=rel_json, branch=current_branch)
        if not self.config.publish_enabled:
            return PublishResult(status="saved_only", message="Git publishing is disabled.",
                markdown_path=rel_md, json_path=rel_json, branch=current_branch)

        self._git("add", "--", rel_md, rel_json)
        self._git("commit", "-m", f"research: {report.topic[:65]}", "--only", "--", rel_md, rel_json)
        commit = self._git("rev-parse", "HEAD").stdout.strip()
        pushed = self._git("push", self.config.remote, self.config.branch, check=False)
        if pushed.returncode:
            logger.error("Push failed; local commit %s was retained.", commit)
            return PublishResult(status="push_failed",
                message=pushed.stderr.strip() or pushed.stdout.strip(),
                markdown_path=rel_md, json_path=rel_json, branch=self.config.branch, commit=commit)
        return PublishResult(status="published", message="Research report committed and pushed.",
            markdown_path=rel_md, json_path=rel_json, branch=self.config.branch, commit=commit)
