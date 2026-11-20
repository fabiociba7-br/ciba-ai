"""Command-line entry point: python -m garcia_research."""
from __future__ import annotations
import argparse
import json
import logging
import os
import sys
from .adapters import LocalPromptAdapter, OpenAIAdapter
from .config import ResearchConfig
from .service import GarciaResearchService

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m garcia_research",
        description="Run Garcia's optional local technical/security research pipeline.",
    )
    parser.add_argument("topic_positional", nargs="?", help="Research topic (positional form).")
    parser.add_argument("--topic", dest="topic_flag", help="Research topic.")
    parser.add_argument("--no-publish", action="store_true",
                        help="Compatibility flag; this local package never publishes artifacts.")
    parser.add_argument("--json-output", action="store_true", help="Print the complete ResearchReport JSON to stdout.")
    parser.add_argument("--depth", choices=("quick", "standard", "deep"), default="standard")
    parser.add_argument("--focus", action="append", default=[], help="Focus keyword; repeat this flag to add multiple keywords.")
    parser.add_argument("--llm", choices=("local", "openai"), default="local")
    parser.add_argument("--openai-model", default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    return parser

def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    topic = (args.topic_flag or args.topic_positional or "").strip()
    if not topic:
        build_parser().error("provide a topic either positionally or with --topic")
    max_queries = {"quick": 2, "standard": 5, "deep": 8}[args.depth]
    config = ResearchConfig(max_queries=max_queries)
    llm = OpenAIAdapter(model=args.openai_model) if args.llm == "openai" else LocalPromptAdapter()
    logging.basicConfig(level=os.getenv("GARCIA_RESEARCH_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stderr)
    try:
        with GarciaResearchService(config, llm_client=llm) as service:
            report = service.run(topic, depth=args.depth, focus=args.focus)
        if args.json_output:
            print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
        else:
            print(f"Research: {report.topic}")
            print(report.executive_summary)
            print(f"Sources: {len(report.sources)}")
        return 0
    except Exception as exc:
        logging.getLogger(__name__).exception("Research run failed: %s", exc)
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
