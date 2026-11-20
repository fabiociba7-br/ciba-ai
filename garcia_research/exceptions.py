"""Domain exceptions for the Garcia research package."""
class ResearchError(RuntimeError):
    """Base exception for research pipeline failures."""

class SearchBlockedError(ResearchError):
    """Raised when a search provider denies or challenges a request."""
