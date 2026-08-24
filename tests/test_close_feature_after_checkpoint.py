from scripts.close_feature_after_checkpoint import (
    GitHubApiError,
    close_parent_feature,
    latest_verdict,
)

REPOSITORY = "ElJeskos/MOX-ADV"
CHECKPOINT = 193
PARENT = 190


class FakeGitHubClient:
    def __init__(self, *, checkpoint=None, parent=None, comments=None, sub_issues=None):
        self.checkpoint = checkpoint or issue(CHECKPOINT, "closed", "type:checkpoint")
        self.parent = parent or issue(PARENT, "open", "type:feature")
        self.comments = (
            comments if comments is not None else [verdict_comment("ACCEPTED")]
        )
        self.sub_issues = (
            sub_issues
            if sub_issues is not None
            else [
                issue(254, "closed", "type:task"),
                issue(255, "closed", "type:task"),
                issue(256, "closed", "type:task"),
                self.checkpoint,
            ]
        )
        self.patches = []
        self.posts = []

    def get(self, path):
        if path == f"repos/{REPOSITORY}/issues/{CHECKPOINT}":
            return self.checkpoint
        if path == f"repos/{REPOSITORY}/issues/{CHECKPOINT}/parent":
            if self.parent is None:
                raise GitHubApiError(404, "not found")
            return self.parent
        raise AssertionError(f"Unexpected GET {path}")

    def get_paginated(self, path):
        if path == f"repos/{REPOSITORY}/issues/{CHECKPOINT}/comments":
            return self.comments
        if path == f"repos/{REPOSITORY}/issues/{PARENT}/sub_issues":
            return self.sub_issues
        raise AssertionError(f"Unexpected paginated GET {path}")

    def patch(self, path, payload):
        self.patches.append((path, payload))
        return {**self.parent, **payload}

    def post(self, path, payload):
        self.posts.append((path, payload))
        return {"id": 1, **payload}


def issue(number, state, label):
    return {"number": number, "state": state, "labels": [{"name": label}]}


def verdict_comment(body, *, association="OWNER", author="ElJeskos", comment_id=1):
    return {
        "id": comment_id,
        "body": body,
        "author_association": association,
        "user": {"login": author},
    }


def test_latest_verdict_uses_last_trusted_explicit_decision():
    comments = [
        verdict_comment("ACCEPTED", association="NONE", comment_id=1),
        verdict_comment("accepted — первая проверка", comment_id=2),
        verdict_comment("CHANGES REQUESTED: исправить отчёт", comment_id=3),
    ]

    verdict = latest_verdict(comments)

    assert verdict is not None
    assert verdict.value == "CHANGES REQUESTED"
    assert verdict.comment_id == 3


def test_closes_open_feature_when_checkpoint_is_accepted_and_all_children_are_closed():
    client = FakeGitHubClient()

    result = close_parent_feature(client, REPOSITORY, CHECKPOINT)

    assert result.status == "closed"
    assert result.parent_number == PARENT
    assert client.patches == [
        (
            f"repos/{REPOSITORY}/issues/{PARENT}",
            {"state": "closed", "state_reason": "completed"},
        )
    ]
    assert client.posts[0][0] == f"repos/{REPOSITORY}/issues/{PARENT}/comments"
    assert "#193" in client.posts[0][1]["body"]
    assert "`ACCEPTED`" in client.posts[0][1]["body"]


def test_dry_run_validates_without_mutating_parent():
    client = FakeGitHubClient()

    result = close_parent_feature(client, REPOSITORY, CHECKPOINT, dry_run=True)

    assert result.status == "would_close"
    assert result.parent_number == PARENT
    assert client.patches == []
    assert client.posts == []


def test_does_not_close_feature_without_explicit_acceptance():
    client = FakeGitHubClient(comments=[verdict_comment("Всё посмотрел")])

    result = close_parent_feature(client, REPOSITORY, CHECKPOINT)

    assert result.status == "skipped"
    assert "no trusted explicit verdict" in result.message
    assert client.patches == []


def test_does_not_close_feature_after_changes_requested():
    client = FakeGitHubClient(
        comments=[
            verdict_comment("ACCEPTED", comment_id=1),
            verdict_comment("changes requested — нужна доработка", comment_id=2),
        ]
    )

    result = close_parent_feature(client, REPOSITORY, CHECKPOINT)

    assert result.status == "skipped"
    assert result.message == "Latest checkpoint verdict is CHANGES REQUESTED"
    assert client.patches == []


def test_does_not_close_feature_while_another_child_is_open():
    client = FakeGitHubClient(
        sub_issues=[
            issue(254, "closed", "type:task"),
            issue(255, "open", "type:task"),
            issue(CHECKPOINT, "closed", "type:checkpoint"),
        ]
    )

    result = close_parent_feature(client, REPOSITORY, CHECKPOINT)

    assert result.status == "skipped"
    assert result.message.endswith("open children: #255")
    assert client.patches == []


def test_ignores_closed_issue_that_is_not_a_checkpoint():
    client = FakeGitHubClient(checkpoint=issue(CHECKPOINT, "closed", "type:task"))

    result = close_parent_feature(client, REPOSITORY, CHECKPOINT)

    assert result.status == "skipped"
    assert result.message == "Issue #193 is not type:checkpoint"
    assert client.patches == []


def test_skips_checkpoint_without_native_parent():
    client = FakeGitHubClient()
    client.parent = None

    result = close_parent_feature(client, REPOSITORY, CHECKPOINT)

    assert result.status == "skipped"
    assert result.message == "Checkpoint #193 has no native parent"
    assert client.patches == []
