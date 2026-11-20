from garcia_research.cli import build_parser

def test_cli_accepts_positional_topic_and_local_only_flag():
    args = build_parser().parse_args(["JWT Security", "--no-publish", "--json-output"])
    assert args.topic_positional == "JWT Security"
    assert args.no_publish is True
    assert args.json_output is True

def test_cli_accepts_topic_flag_focus_and_depth():
    args = build_parser().parse_args([
        "--topic", "OAuth2", "--focus", "PKCE", "--focus", "redirect_uri", "--depth", "deep"
    ])
    assert args.topic_flag == "OAuth2"
    assert args.focus == ["PKCE", "redirect_uri"]
    assert args.depth == "deep"

def test_cli_has_no_remote_publication_option():
    options = {option for action in build_parser()._actions for option in action.option_strings}
    assert "--publish" not in options
    assert "--branch" not in options
    assert "--repo-path" not in options
