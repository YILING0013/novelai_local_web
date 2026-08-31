import base64
import io

import pytest
from PIL import Image

from api_utils.novelai_client import NovelAIUpstreamError
from app import create_app


ORIGIN = "http://localhost:5000"


def png_base64(width=2, height=2):
    """生成路由测试使用的真实单帧 PNG Base64。"""

    output = io.BytesIO()
    Image.new("RGB", (width, height), (12, 34, 56)).save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


PNG_BASE64 = png_base64()


class FakeNovelAIClient:
    """为路由测试记录传入官方客户端的数据。"""

    def __init__(self):
        self.calls = []
        self.reject_account = False
        self.fail_next_generate = False

    def account_snapshot(self, token):
        self.calls.append(("account", token))
        if self.reject_account:
            raise NovelAIUpstreamError(
                "The NovelAI session is no longer authorized.",
                401,
                "NOVELAI_UNAUTHORIZED",
            )
        return {
            "information": {"emailVerified": True},
            "subscription": {"tier": 3, "trainingStepsLeft": {"fixedTrainingStepsLeft": 100}},
        }

    def login_with_password(self, email, password):
        self.calls.append(("password", email, password))
        return "pst-password"

    def generate_image(self, token, payload, correlation_id):
        self.calls.append(("generate", token, payload, correlation_id))
        if self.fail_next_generate:
            self.fail_next_generate = False
            raise NovelAIUpstreamError("NovelAI rejected the request.", 502, "TEST_FAILURE")
        return [{
            "data": base64.b64encode(b"generated").decode("ascii"),
            "mime_type": "image/png",
            "seed": payload["parameters"]["seed"],
            "index": 0,
        }]

    def augment_image(self, token, payload, correlation_id):
        self.calls.append(("augment", token, payload, correlation_id))
        return {
            "data": base64.b64encode(b"augmented").decode("ascii"),
            "mime_type": "image/png",
        }

    def upscale_image(self, token, payload, correlation_id):
        self.calls.append(("upscale", token, payload, correlation_id))
        return [{
            "data": base64.b64encode(b"upscaled").decode("ascii"),
            "mime_type": "image/png",
            "seed": None,
            "index": 0,
        }]

    def encode_vibe(self, token, payload, correlation_id):
        self.calls.append(("vibe", token, payload, correlation_id))
        return {"encoding": base64.b64encode(b"vibe").decode("ascii"), "mime_type": "application/octet-stream"}

    def suggest_tags(self, token, params):
        self.calls.append(("tags", token, params))
        return {"tags": [{"tag": "1girl", "confidence": 0.9}]}


@pytest.fixture
def clock():
    return [100.0]


@pytest.fixture
def fake_client():
    return FakeNovelAIClient()


@pytest.fixture
def app(tmp_path, fake_client, clock):
    return create_app(
        {
            "TESTING": True,
            "DATA_DIR": str(tmp_path / "data"),
            "MONOTONIC_CLOCK": lambda: clock[0],
            "IMAGE_INTERVAL_SECONDS": 15.0,
        },
        novelai_client=fake_client,
    )


@pytest.fixture
def client(app):
    return app.test_client()


def login(client, token="pst-test"):
    response = client.post(
        "/api/session/persistent-token",
        json={"token": token},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200
    return response.get_json()["csrf_token"]
