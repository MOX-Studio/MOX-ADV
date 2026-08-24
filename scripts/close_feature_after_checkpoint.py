"""Close an accepted Feature after its native Checkpoint sub-issue closes."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Optional

# The project supports Python 3.9, where PEP 604 union syntax is unavailable.
# ruff: noqa: UP045
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_VERSION = "2022-11-28"
TRUSTED_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})
VERDICT_RE = re.compile(r"^\s*(ACCEPTED|CHANGES REQUESTED)\b", re.IGNORECASE)


class GitHubApiError(RuntimeError):
    """A GitHub REST API request failed."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class GitHubClient:
    """Small stdlib-only client for the issue endpoints used by the workflow."""

    def __init__(self, token: str, api_url: str = "https://api.github.com") -> None:
        self._token = token
        self._api_url = api_url.rstrip("/")

    def _request(
        self,
        method: str,
        path_or_url: str,
        payload: Optional[Mapping[str, Any]] = None,
    ) -> tuple[Any, Mapping[str, str]]:
        url = (
            path_or_url
            if path_or_url.startswith("https://")
            else f"{self._api_url}/{path_or_url.lstrip('/')}"
        )
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            url,
            data=data,
            method=method,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "User-Agent": "mox-adv-close-feature-workflow",
                "X-GitHub-Api-Version": API_VERSION,
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
                decoded = json.loads(raw.decode("utf-8")) if raw else None
                return decoded, response.headers
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise GitHubApiError(
                error.code,
                f"GitHub API {method} {url} failed with {error.code}: {detail}",
            ) from error
        except URLError as error:
            raise GitHubApiError(
                0, f"GitHub API {method} {url} failed: {error}"
            ) from error

    def get(self, path: str) -> Mapping[str, Any]:
        payload, _ = self._request("GET", path)
        if not isinstance(payload, dict):
            raise GitHubApiError(0, f"Expected an object from GET {path}")
        return payload

    def get_paginated(self, path: str) -> list[Mapping[str, Any]]:
        separator = "&" if "?" in path else "?"
        next_url: Optional[str] = f"{path}{separator}{urlencode({'per_page': 100})}"
        items: list[Mapping[str, Any]] = []
        while next_url:
            payload, headers = self._request("GET", next_url)
            if not isinstance(payload, list):
                raise GitHubApiError(0, f"Expected a list from GET {next_url}")
            items.extend(item for item in payload if isinstance(item, dict))
            next_url = _next_link(headers.get("Link", ""))
        return items

    def patch(self, path: str, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        response, _ = self._request("PATCH", path, payload)
        if not isinstance(response, dict):
            raise GitHubApiError(0, f"Expected an object from PATCH {path}")
        return response

    def post(self, path: str, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        response, _ = self._request("POST", path, payload)
        if not isinstance(response, dict):
            raise GitHubApiError(0, f"Expected an object from POST {path}")
        return response


def _next_link(link_header: str) -> Optional[str]:
    for part in link_header.split(","):
        match = re.match(r'\s*<([^>]+)>;\s*rel="([^"]+)"', part)
        if match and match.group(2) == "next":
            return match.group(1)
    return None


def _label_names(issue: Mapping[str, Any]) -> frozenset[str]:
    labels = issue.get("labels", [])
    return frozenset(
        label.get("name")
        for label in labels
        if isinstance(label, dict) and isinstance(label.get("name"), str)
    )


@dataclass(frozen=True)
class Verdict:
    value: str
    author: str
    comment_id: int


def latest_verdict(comments: Iterable[Mapping[str, Any]]) -> Optional[Verdict]:
    """Return the last trusted explicit checkpoint verdict, if one exists."""

    verdict: Optional[Verdict] = None
    for comment in comments:
        if comment.get("author_association") not in TRUSTED_ASSOCIATIONS:
            continue
        body = comment.get("body")
        if not isinstance(body, str):
            continue
        match = VERDICT_RE.match(body)
        if not match:
            continue
        user = comment.get("user")
        author = user.get("login") if isinstance(user, dict) else None
        comment_id = comment.get("id")
        if not isinstance(author, str) or not isinstance(comment_id, int):
            continue
        verdict = Verdict(
            value=match.group(1).upper(),
            author=author,
            comment_id=comment_id,
        )
    return verdict


@dataclass(frozen=True)
class CloseResult:
    status: str
    message: str
    parent_number: Optional[int] = None


def close_parent_feature(
    client: Any,
    repository: str,
    checkpoint_number: int,
    *,
    dry_run: bool = False,
) -> CloseResult:
    """Validate the hierarchy and close the accepted parent Feature."""

    issue_path = f"repos/{repository}/issues/{checkpoint_number}"
    checkpoint = client.get(issue_path)

    if checkpoint.get("state") != "closed":
        return CloseResult("skipped", f"Checkpoint #{checkpoint_number} is not closed")
    if "type:checkpoint" not in _label_names(checkpoint):
        return CloseResult(
            "skipped", f"Issue #{checkpoint_number} is not type:checkpoint"
        )

    try:
        parent = client.get(f"{issue_path}/parent")
    except GitHubApiError as error:
        if error.status == 404:
            return CloseResult(
                "skipped", f"Checkpoint #{checkpoint_number} has no native parent"
            )
        raise

    parent_number = parent.get("number")
    if not isinstance(parent_number, int):
        raise GitHubApiError(0, "Parent issue response has no numeric issue number")
    if "type:feature" not in _label_names(parent):
        return CloseResult(
            "skipped",
            f"Parent #{parent_number} is not type:feature",
            parent_number,
        )
    if parent.get("state") != "open":
        return CloseResult(
            "skipped",
            f"Parent Feature #{parent_number} is already closed",
            parent_number,
        )

    comments = client.get_paginated(f"{issue_path}/comments")
    verdict = latest_verdict(comments)
    if verdict is None:
        return CloseResult(
            "skipped",
            f"Checkpoint #{checkpoint_number} has no trusted explicit verdict",
            parent_number,
        )
    if verdict.value != "ACCEPTED":
        return CloseResult(
            "skipped",
            f"Latest checkpoint verdict is {verdict.value}",
            parent_number,
        )

    sub_issues = client.get_paginated(
        f"repos/{repository}/issues/{parent_number}/sub_issues"
    )
    child_numbers = {issue.get("number") for issue in sub_issues}
    if checkpoint_number not in child_numbers:
        return CloseResult(
            "skipped",
            f"Checkpoint #{checkpoint_number} is not listed under parent #{parent_number}",
            parent_number,
        )
    open_children = sorted(
        issue.get("number")
        for issue in sub_issues
        if issue.get("state") != "closed" and isinstance(issue.get("number"), int)
    )
    if open_children:
        numbers = ", ".join(f"#{number}" for number in open_children)
        return CloseResult(
            "skipped",
            f"Parent Feature #{parent_number} still has open children: {numbers}",
            parent_number,
        )

    message = (
        f"Checkpoint #{checkpoint_number} was accepted by @{verdict.author}; "
        f"all {len(sub_issues)} native sub-issues are closed"
    )
    if dry_run:
        return CloseResult("would_close", message, parent_number)

    client.patch(
        f"repos/{repository}/issues/{parent_number}",
        {"state": "closed", "state_reason": "completed"},
    )
    client.post(
        f"repos/{repository}/issues/{parent_number}/comments",
        {
            "body": (
                f"Автоматически закрыто после контрольной точки #{checkpoint_number}: "
                f"@{verdict.author} оставил решение `ACCEPTED`, все дочерние задачи "
                "и контрольная точка закрыты."
            )
        },
    )
    return CloseResult("closed", message, parent_number)


def _positive_issue_number(value: str) -> int:
    try:
        number = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("issue number must be an integer") from error
    if number < 1:
        raise argparse.ArgumentTypeError("issue number must be positive")
    return number


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint_number", type=_positive_issue_number)
    parser.add_argument(
        "--repository",
        default=os.environ.get("GITHUB_REPOSITORY"),
        help="GitHub repository as OWNER/REPO (defaults to GITHUB_REPOSITORY)",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("GH_TOKEN or GITHUB_TOKEN is required", file=sys.stderr)
        return 2
    if not args.repository or args.repository.count("/") != 1:
        print("--repository or GITHUB_REPOSITORY must be OWNER/REPO", file=sys.stderr)
        return 2

    client = GitHubClient(
        token, os.environ.get("GITHUB_API_URL", "https://api.github.com")
    )
    try:
        result = close_parent_feature(
            client,
            args.repository,
            args.checkpoint_number,
            dry_run=args.dry_run,
        )
    except GitHubApiError as error:
        print(str(error), file=sys.stderr)
        return 1

    parent = f" parent=#{result.parent_number}" if result.parent_number else ""
    print(f"status={result.status}{parent}: {result.message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
