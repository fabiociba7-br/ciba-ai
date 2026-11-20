from unittest.mock import Mock
import requests
from garcia_research.client import RobustDuckDuckGoClient
from garcia_research.config import ResearchConfig

def test_search_api_parses_abstract_and_caches():
    config = ResearchConfig(request_delay_min=0, request_delay_max=0)
    session = Mock(spec=requests.Session)
    session.headers = Mock()
    response = Mock()
    response.json.return_value = {"Heading": "OAuth", "AbstractText": "Use PKCE.",
                                  "AbstractURL": "https://example.org/oauth", "RelatedTopics": []}
    session.get.return_value = response
    client = RobustDuckDuckGoClient(config, session=session)
    first = client.search_api("OAuth2")
    second = client.search_api("OAuth2")
    assert first["results"][0]["url"] == "https://example.org/oauth"
    assert second == first
    session.get.assert_called_once()

def test_html_search_extracts_result_url():
    config = ResearchConfig(request_delay_min=0, request_delay_max=0)
    session = Mock(spec=requests.Session)
    session.headers = Mock()
    response = Mock()
    response.text = '''
    <div class="result"><h2 class="result__title">
      <a href="https://example.org/security">Security guidance</a>
    </h2><a class="result__snippet">Useful snippet</a></div>
    '''
    session.get.return_value = response
    result = RobustDuckDuckGoClient(config, session=session).search_html("security")
    assert result["results"][0]["url"] == "https://example.org/security"
    assert result["results"][0]["title"] == "Security guidance"

def test_captcha_page_raises_blocked_error():
    from garcia_research.exceptions import SearchBlockedError
    config = ResearchConfig(request_delay_min=0, request_delay_max=0)
    session = Mock(spec=requests.Session)
    session.headers = Mock()
    response = Mock()
    response.text = "<html><body>captcha verification</body></html>"
    session.get.return_value = response
    try:
        RobustDuckDuckGoClient(config, session=session).search_html("blocked")
    except SearchBlockedError:
        return
    raise AssertionError("Expected SearchBlockedError")
