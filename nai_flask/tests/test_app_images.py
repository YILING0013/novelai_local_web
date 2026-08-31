from conftest import ORIGIN, PNG_BASE64, login, png_base64


def generation_body(batch_id="batch-a", index=0, batch_size=8):
    return {
        "batch_id": batch_id,
        "index": index,
        "batch_size": batch_size,
        "model": "nai-diffusion-4-5-full",
        "positivePrompt": "1girl",
        "negativePrompt": "",
        "width": 512,
        "height": 512,
        "steps": 20,
        "n_samples": 9,
        "seed": 123,
    }


def post_generate(client, csrf, body):
    return client.post(
        "/api/images/generate",
        json=body,
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )


def test_generate_forces_one_sample_and_returns_json_contract(client, fake_client):
    csrf = login(client)
    response = post_generate(client, csrf, generation_body())

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["batch_id"] == "batch-a"
    assert payload["index"] == 0
    assert payload["images"][0]["mime_type"] == "image/png"
    assert payload["images"][0]["seed"] == 123
    assert payload["images"][0]["index"] == 0
    assert payload["account_snapshot"]["subscription"]["tier"] == 3
    assert payload["correlation_id"]

    call = next(item for item in fake_client.calls if item[0] == "generate")
    official_payload = call[2]
    assert official_payload["model"] == "nai-diffusion-4-5-full"
    assert official_payload["parameters"]["n_samples"] == 1
    assert "batch_id" not in official_payload
    assert "index" not in official_payload
    assert "batch_size" not in official_payload
    assert "recaptcha_token" not in official_payload


def test_site_verification_fields_are_rejected(client):
    csrf = login(client)
    body = generation_body()
    body["recaptcha_token"] = "must-not-pass"
    response = post_generate(client, csrf, body)
    assert response.status_code == 400
    assert response.get_json()["code"] == "SITE_SECURITY_FIELD_NOT_ALLOWED"


def test_batch_requires_success_order_and_fifteen_seconds(client, fake_client, clock):
    csrf = login(client)
    assert post_generate(client, csrf, generation_body(index=0)).status_code == 200

    too_soon = post_generate(client, csrf, generation_body(index=1))
    assert too_soon.status_code == 429
    assert too_soon.get_json()["code"] == "IMAGE_INTERVAL_ACTIVE"
    assert too_soon.get_json()["retry_after"] == 15.0

    clock[0] += 15
    assert post_generate(client, csrf, generation_body(index=1)).status_code == 200
    clock[0] += 15
    out_of_order = post_generate(client, csrf, generation_body(index=3))
    assert out_of_order.status_code == 409
    assert out_of_order.get_json()["expected_index"] == 2


def test_failed_generation_makes_batch_terminal_without_retry(client, fake_client):
    csrf = login(client)
    fake_client.fail_next_generate = True

    failed = post_generate(client, csrf, generation_body())
    assert failed.status_code == 502
    assert failed.get_json()["uncertain"] is True
    assert failed.get_json()["certain"] is False
    assert failed.get_json()["correlation_id"]
    retried = post_generate(client, csrf, generation_body())
    assert retried.status_code == 409
    assert retried.get_json()["code"] == "BATCH_TERMINAL"
    assert retried.get_json()["batch_status"] == "failed"


def test_batch_index_is_limited_to_eight_images(client):
    csrf = login(client)
    response = post_generate(client, csrf, generation_body(index=8, batch_size=8))
    assert response.status_code == 400


def test_batch_size_is_fixed_and_last_success_is_terminal(client, clock):
    csrf = login(client)
    assert post_generate(
        client,
        csrf,
        generation_body("two-images", 0, 2),
    ).status_code == 200
    clock[0] += 15
    mismatch = post_generate(client, csrf, generation_body("two-images", 1, 3))
    assert mismatch.status_code == 409
    assert mismatch.get_json()["code"] == "BATCH_SIZE_MISMATCH"

    completed = post_generate(client, csrf, generation_body("two-images", 1, 2))
    assert completed.status_code == 200
    reused = post_generate(client, csrf, generation_body("two-images", 1, 2))
    assert reused.status_code == 409
    assert reused.get_json()["code"] == "BATCH_TERMINAL"
    assert reused.get_json()["batch_status"] == "completed"


def test_batch_owner_and_cancellation_are_enforced(app, fake_client):
    first = app.test_client()
    second = app.test_client()
    first_csrf = login(first, "pst-first")
    second_csrf = login(second, "pst-second")
    assert post_generate(first, first_csrf, generation_body("shared", 0)).status_code == 200

    owner_mismatch = post_generate(second, second_csrf, generation_body("shared", 0))
    assert owner_mismatch.status_code == 409
    assert owner_mismatch.get_json()["code"] == "BATCH_OWNER_MISMATCH"

    cancelled = second.delete(
        "/api/images/batch",
        json={"batch_id": "cancelled-before-send"},
        headers={"Origin": ORIGIN, "X-CSRF-Token": second_csrf},
    )
    assert cancelled.status_code == 200
    rejected = post_generate(second, second_csrf, generation_body("cancelled-before-send", 0))
    assert rejected.status_code == 409
    assert rejected.get_json()["code"] == "BATCH_CANCELLED"


def test_only_one_nonterminal_batch_can_exist_across_tabs(app, clock):
    first = app.test_client()
    second = app.test_client()
    first_csrf = login(first, "pst-first")
    second_csrf = login(second, "pst-second")

    assert post_generate(
        first,
        first_csrf,
        generation_body("first-active-batch", 0, 2),
    ).status_code == 200
    blocked = post_generate(
        second,
        second_csrf,
        generation_body("second-active-batch", 0, 2),
    )

    assert blocked.status_code == 409
    assert blocked.get_json()["code"] == "IMAGE_BATCH_ACTIVE"

    clock[0] += 301
    recovered = post_generate(
        second,
        second_csrf,
        generation_body("second-active-batch", 0, 2),
    )
    assert recovered.status_code == 200


def test_global_image_operation_lock_rejects_overlap(client, app):
    csrf = login(client)
    lock = app.extensions["image_operation_lock"]
    lock.acquire()
    try:
        response = post_generate(client, csrf, generation_body())
    finally:
        lock.release()
    assert response.status_code == 409
    assert response.get_json()["code"] == "IMAGE_OPERATION_BUSY"


def test_vibe_director_upscale_and_tags_routes(client, fake_client, clock):
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}

    vibe = client.post(
        "/api/images/vibe",
        json={
            "image": PNG_BASE64,
            "information_extracted": 1,
            "model": "nai-diffusion-4-5-full",
        },
        headers=headers,
    )
    assert vibe.status_code == 200
    assert set(vibe.get_json()) == {"encoding", "mime_type", "account_snapshot", "correlation_id"}

    augment = client.post(
        "/api/images/augment",
        json={"image": PNG_BASE64, "req_type": "lineart"},
        headers=headers,
    )
    assert augment.status_code == 200
    assert augment.get_json()["images"][0]["data"]

    upscale = client.post(
        "/api/images/upscale",
        json={
            "image": PNG_BASE64,
            "model": "nai-diffusion-4-5-full",
            "declared_blur_sigma": 1.25,
        },
        headers=headers,
    )
    assert upscale.status_code == 200
    assert upscale.get_json()["images"][0]["mime_type"] == "image/png"

    tags = client.get(
        "/api/images/tags?prompt=1gi&model=nai-diffusion-4-5-full"
    )
    assert tags.status_code == 200
    assert tags.get_json()["tags"][0]["tag"] == "1girl"


def test_upscale_rejects_legacy_scale_and_invalid_upload(client):
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    legacy = client.post(
        "/api/images/upscale",
        json={
            "image": PNG_BASE64,
            "model": "nai-diffusion-4-5-full",
            "scale": 2,
        },
        headers=headers,
    )
    assert legacy.status_code == 400
    assert legacy.get_json()["code"] == "UPSCALE_FIELD_INVALID"

    corrupted = client.post(
        "/api/images/vibe",
        json={
            "image": "aW1hZ2U=",
            "information_extracted": 1,
            "model": "nai-diffusion-4-5-full",
        },
        headers=headers,
    )
    assert corrupted.status_code == 400


def test_director_cached_references_are_sent_as_official_string_array(client, fake_client):
    csrf = login(client)
    reference = png_base64(1024, 1536)
    body = generation_body("director-reference", 0)
    body.update({
        "director_reference_images_cached": [{
            "cache_secret_key": "local-cache-key-must-not-pass",
            "data": reference,
        }],
        "director_reference_descriptions": [{"caption": "character"}],
        "director_reference_strength_values": [1.0],
        "director_reference_secondary_strength_values": [0.0],
        "director_reference_information_extracted": [1.0],
    })

    response = post_generate(client, csrf, body)
    assert response.status_code == 200
    call = [item for item in fake_client.calls if item[0] == "generate"][-1]
    parameters = call[2]["parameters"]
    assert parameters["director_reference_images"] == [reference]
    assert "director_reference_images_cached" not in parameters
    assert "local-cache-key-must-not-pass" not in str(call[2])


def test_successful_image_is_returned_when_snapshot_refresh_loses_authorization(
    client,
    fake_client,
):
    csrf = login(client)
    fake_client.reject_account = True

    response = post_generate(client, csrf, generation_body("refresh-401", 0))
    assert response.status_code == 200
    assert response.get_json()["images"]
    assert response.get_json()["account_snapshot"]["stale"] is True
    assert client.get("/api/session").get_json() == {"authenticated": False}
