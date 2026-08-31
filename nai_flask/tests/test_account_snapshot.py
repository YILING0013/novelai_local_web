import pytest

from api_utils.novelai_client import NovelAIUpstreamError
from app import _build_account_snapshot
from conftest import login


def _raw_snapshot(*, percent=None, is_negative="missing", training=None, email=None):
    """构造只含官方字段名的账户响应。"""

    usage = {}
    if percent is not None:
        usage["percent"] = percent
    if is_negative != "missing":
        usage["isNegative"] = is_negative
    information = {}
    if email is not None:
        information["plainTextEmail"] = email
        information["hasPlaintextEmail"] = True
    return {
        "information": information,
        "subscription": {
            "trainingStepsLeft": training or {},
            "usage": usage,
        },
    }


@pytest.mark.parametrize(
    ("percent", "is_negative", "expected_negative", "expected_available"),
    [
        (0, False, False, True),
        (-2, True, True, False),
        (135, False, False, True),
        (50, "missing", None, None),
    ],
)
def test_v5_snapshot_preserves_official_values_and_missing_semantics(
    percent,
    is_negative,
    expected_negative,
    expected_available,
):
    snapshot = _build_account_snapshot(
        _raw_snapshot(percent=percent, is_negative=is_negative),
        "persistent_token",
    )
    assert snapshot["v5"]["percent"] == percent
    assert snapshot["v5"]["is_negative"] is expected_negative
    assert snapshot["v5"]["available"] is expected_available
    assert "used" not in snapshot["v5"]


def test_snapshot_does_not_invent_missing_anlas_and_uses_plaintext_email():
    snapshot = _build_account_snapshot(
        _raw_snapshot(
            email="official@example.com",
            training={"fixedTrainingStepsLeft": 12},
        ),
        "persistent_token",
        "fallback@example.com",
    )
    assert snapshot["information"]["email"] == "official@example.com"
    assert snapshot["anlas"] == {"fixed": 12, "purchased": None, "total": None}

    complete = _build_account_snapshot(
        _raw_snapshot(training={
            "fixedTrainingStepsLeft": 12,
            "purchasedTrainingSteps": 8,
        }),
        "password",
        "fallback@example.com",
    )
    assert complete["information"]["email"] == "fallback@example.com"
    assert complete["anlas"] == {"fixed": 12, "purchased": 8, "total": 20}
    assert complete["auth"] == {
        "login_mode": "password",
        "can_manage_credentials": True,
    }


def test_refresh_failure_preserves_last_good_snapshot_as_stale(client, fake_client):
    login(client)
    last_good = client.get("/api/session").get_json()["account_snapshot"]

    def fail_snapshot(token):
        """模拟官方账户刷新临时失败。"""

        raise NovelAIUpstreamError(
            "The NovelAI service could not be reached.",
            502,
            "NOVELAI_UNAVAILABLE",
        )

    fake_client.account_snapshot = fail_snapshot
    response = client.get("/api/account")
    assert response.status_code == 200
    stale = response.get_json()["account_snapshot"]
    assert stale["stale"] is True
    assert stale["information"] == last_good["information"]
    assert stale["subscription"] == last_good["subscription"]
