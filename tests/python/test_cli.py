from garcia_research.cli import build_parser

def test_cli_accepts_positional_topic_and_no_publish():
    args = build_parser().parse_args(["JWT Security", "--no-publish", "--json-output"])
    assert args.topic_positional == "JWT Security"
    assert args.no_publish is True
    assert args.json_output is True

def test_cli_accepts_topic_flag_branch_and_focus():
    args = build_parser().parse_args([
        "--topic", "OAuth2", "--branch", "feature/research",
        "--focus", "PKCE", "--focus", "redirect_uri", "--depth", "deep"
    ])
    assert args.topic_flag == "OAuth2"
    assert args.branch == "feature/research"
    assert args.focus == ["PKCE", "redirect_uri"]
    assert args.depth == "deep"
