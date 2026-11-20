"""Command-line entry point: python -m garcia_research."""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from .adapters import LocalPromptAdapter, OpenAIAdapter
from .config import ResearchConfig
from .service import GarciaResearchService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m garcia_research",
        description="Run Garcia's optional technical/security research pipeline.",
    )
    parser.add_argument("topic_positional", nargs="?", help="Research topic (positional form).")
    parser.add_argument("--topic", dest="topic_flag", help="Research topic.")
    parser.add_argument("--no-publish", action="store_true",
                        help="Never commit or push; save report files locally.")
    parser.add_argument("--publish", action="store_true",
                        help="Explicitly allow commit and push when the worktree is clean.")
    parser.add_argument("--json-output", action="store_true",
                        help="Print the complete ResearchReport JSON to stdout.")
    parser.add_argument("--branch", help="Expected local branch for optional publication.")
    parser.add_argument("--repo-path", default=os.getenv("GARCIA_RESEARCH_REPO", str(Path.cwd())),
                        help="Path to the already-cloned ciba-ai repository.")
    parser.add_argument("--depth", choices=("quick", "standard", "deep"), default="standard")
    parser.add_argument("--focus", action="append", default=[],
                        help="Focus keyword; repeat this flag to add multiple keywords.")
    parser.add_argument("--llm", choices=("local", "openai"), default="local")
    parser.add_argument("--openai-model", default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    topic = (args.topic_flag or args.topic_positional or "").strip()
    if not topic:
        build_parser().error("provide a topic either positionally or with --topic")

    max_queries = {"quick": 2, "standard": 5, "deep": 8}[args.depth]
    config = ResearchConfig(
        repo_path=args.repo_path,
        branch=args.branch or os.getenv("GITHUB_REF_NAME", "main"),
        max_queries=max_queries,
        publish_enabled=bool(args.publish and not args.no_publish),
    )
    llm = OpenAIAdapter(model=args.openai_model) if args.llm == "openai" else LocalPromptAdapter()

    logging.basicConfig(
        level=os.getenv("GARCIA_RESEARCH_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )
    try:
        with GarciaResearchService(config, llm_client=llm) as service:
            report = service.run(topic, depth=args.depth, focus=args.focus)
        if args.json_output:
            print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
        else:
            print(f"Research: {report.topic}")
            print(report.executive_summary)
            print(f"Sources: {len(report.sources)}")
            if report.publication:
                print(f"Publication: {report.publication.status} - {report.publication.message}")
                if report.publication.markdown_path:
                    print(f"Markdown: {report.publication.markdown_path}")
                if report.publication.json_path:
                    print(f"JSON: {report.publication.json_path}")
        return 0
    except Exception as exc:
        logging.getLogger(__name__).exception("Research run failed: %s", exc)
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
