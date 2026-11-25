use crate::{
    generation,
    service::*,
    web::{Config, Web},
};
use serde_json::{json, Value as V};
use std::{
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[test]
fn cfg_through_twenty_is_preserved_and_invalid_values_are_rejected() {
    for model in [
        "nai-diffusion-3",
        "nai-diffusion-4-5-full",
        "nai-diffusion-5-full",
        "nai-diffusion-5-full-medium",
    ] {
        for scale in [0., 10., 10.1, 20.] {
            let request = generation::payload(&json!({"model":model,"scale":scale})).unwrap();
            assert_eq!(request["parameters"]["scale"], json!(scale));
        }
        for scale in [json!(-0.1), json!(20.1), json!(true), json!("20"), V::Null] {
            let error = generation::payload(&json!({"model":model,"scale":scale})).unwrap_err();
            assert_eq!(error.0, 400);
            assert_eq!(error.1, "NOVELAI_GUIDANCE_SCALE_INVALID");
        }
    }
}

#[test]
fn medium_uses_fixed_sampler_and_only_enabled_characters() {
    let req=generation::payload(&json!({"model":"nai-diffusion-5-full-medium","steps":50,"sampler":"ddim","negativePrompt":"unused","characterPrompts":[{"prompt":"absent","enabled":false},{"prompt":"active","uc":"unused"}],"v4_prompt_char_captions":[{"char_caption":"absent"},{"char_caption":"active"}],"v4_negative_prompt_char_captions":[{"char_caption":"x"},{"char_caption":"y"}]})).unwrap();
    let p = &req["parameters"];
    assert_eq!(p["steps"], 14);
    assert_eq!(p["sampler"], "k_euler_ancestral");
    assert_eq!(p["ucPresetId"], "heavy");
    assert_eq!(p["tag_hint_uc_preset"], 2);
    assert!(p.get("cfg_rescale").is_none());
    assert_eq!(p["characterPrompts"], json!([{"prompt":"active","uc":""}]));
    assert_eq!(
        p["v4_negative_prompt"]["caption"]["char_captions"],
        json!([{"char_caption":""}])
    );
    assert_eq!(
        p["v4_prompt"]["caption"]["char_captions"][0]["char_caption"],
        "active"
    );
    assert!(p["negative_prompt"]
        .as_str()
        .unwrap()
        .starts_with("nsfw, lowres"));
    assert!(generation::payload(
        &json!({"model":"nai-diffusion-5-full","reference_image_multiple":["x"]})
    )
    .is_err());
}
#[test]
fn precise_references_preserve_per_image_settings_and_enforce_model_limits() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let png = |width, height| {
        let mut data = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_luma8(width, height)
            .write_to(&mut data, image::ImageFormat::Png)
            .unwrap();
        STANDARD.encode(data.into_inner())
    };
    let portrait = png(768, 1344);
    let square = png(1024, 1024);
    let descriptions = json!([
        {"caption":{"base_caption":"character_mainoutfit","char_captions":[]},"legacy_uc":false},
        {"caption":{"base_caption":"costume","char_captions":[]},"legacy_uc":false}
    ]);
    let mut body = json!({
        "director_reference_images_cached":[{"data":portrait, "cache_secret_key":"local-only"},{"data":square}],
        "director_reference_descriptions":descriptions,
        "director_reference_strength_values":[0,5],"director_reference_secondary_strength_values":[0,0],
        "director_reference_information_extracted":[1,1]
    });
    for (model, action) in [
        ("nai-diffusion-5-curated", "generate"),
        ("nai-diffusion-5-full", "img2img"),
    ] {
        body["model"] = json!(model);
        if action == "img2img" {
            body["image"] = json!(square);
        }
        let request = generation::payload(&body).unwrap();
        let params = &request["parameters"];
        assert_eq!(request["action"], action);
        assert_eq!(
            params["director_reference_images"],
            json!([portrait, square])
        );
        assert!(params.get("director_reference_images_cached").is_none());
        for field in [
            "director_reference_descriptions",
            "director_reference_strength_values",
            "director_reference_secondary_strength_values",
            "director_reference_information_extracted",
        ] {
            assert_eq!(params[field], body[field]);
        }
    }
    for (field, value, code) in [
        (
            "model",
            json!("nai-diffusion-5-full-medium"),
            "NOVELAI_REFERENCE_HIGH_EFFORT_REQUIRED",
        ),
        (
            "model",
            json!("nai-diffusion-4-full"),
            "NOVELAI_REFERENCE_MODEL_NOT_SUPPORTED",
        ),
        (
            "mask",
            json!(square),
            "NOVELAI_INPAINT_REFERENCE_NOT_SUPPORTED",
        ),
        (
            "reference_image_multiple",
            json!(["vibe"]),
            "MODEL_CAPABILITY_NOT_SUPPORTED",
        ),
        (
            "director_reference_strength_values",
            json!([1, 5.1]),
            "NOVELAI_REQUEST_FORMAT_INVALID",
        ),
        (
            "director_reference_secondary_strength_values",
            json!([0, 0.1]),
            "NOVELAI_REQUEST_FORMAT_INVALID",
        ),
        (
            "director_reference_descriptions",
            json!([{}]),
            "NOVELAI_REQUEST_FORMAT_INVALID",
        ),
        (
            "director_reference_images_cached",
            json!(vec![json!({"data":"x"}); 13]),
            "NOVELAI_REFERENCE_LIMIT_EXCEEDED",
        ),
    ] {
        let mut invalid = body.clone();
        invalid[field] = value;
        let error = generation::payload(&invalid).unwrap_err();
        assert_eq!((error.0, error.1.as_str()), (400, code), "{field}");
    }
    let mut raw = body.clone();
    raw.as_object_mut()
        .unwrap()
        .remove("director_reference_images_cached");
    raw["director_reference_images"] = json!([portrait, square]);
    raw["director_reference_descriptions"] = json!([]);
    assert_eq!(
        generation::payload(&raw).unwrap()["parameters"]["director_reference_images"],
        raw["director_reference_images"]
    );
    let mut incomplete = STANDARD.decode(&square).unwrap();
    incomplete.truncate(incomplete.len() / 2);
    raw["director_reference_images"][0] = json!(STANDARD.encode(incomplete));
    assert_eq!(
        generation::payload(&raw).unwrap_err().1,
        "NOVELAI_REQUEST_FORMAT_INVALID"
    );
    let old_size = png(1024, 1536);
    let mut request = json!({"model":"nai-diffusion-5-full","director_reference_images_cached":[{"data":old_size}]});
    assert_eq!(
        generation::payload(&request).unwrap_err().1,
        "NOVELAI_REQUEST_FORMAT_INVALID"
    );
    request["model"] = json!("nai-diffusion-4-5-full");
    request["mask"] = json!(square);
    request["image"] = json!(square);
    request["director_reference_secondary_strength_values"] = json!([0.8]);
    let v45 = generation::payload(&request).unwrap();
    assert_eq!(v45["action"], "infill");
    assert_eq!(
        v45["parameters"]["director_reference_images"],
        json!([old_size])
    );
    assert_eq!(
        v45["parameters"]["director_reference_secondary_strength_values"],
        json!([0.8])
    );
}

#[test]
fn edit_and_strip_png_without_destroying_an_unknown_comment() {
    let img = image::DynamicImage::new_rgba8(80, 100);
    let doc = json!({"png":{"Comment":"preserved text"},"stealth":{"prompt":"original"}});
    let result = crate::metadata::export(
        &img,
        &doc,
        &json!({"mode":"edit","parameters":{"positivePrompt":"new prompt","steps":14}}),
    )
    .unwrap();
    let pic = image::load_from_memory(&result).unwrap();
    let info = png::Decoder::new(std::io::Cursor::new(&result))
        .read_info()
        .unwrap();
    let mut texts = json!({});
    for t in &info.info().utf8_text {
        texts[&t.keyword] = json!(t.get_text().unwrap());
    }
    assert_eq!(texts["Comment"], "preserved text");
    assert_eq!(texts["steps"], "14");
    let fresh = crate::metadata::read(&pic, &result, &texts);
    assert_eq!(fresh["stealth"]["prompt"], "new prompt");
    let stripped = crate::metadata::export(&pic, &fresh, &json!({"mode":"strip"})).unwrap();
    let pic = image::load_from_memory(&stripped).unwrap();
    assert_eq!(crate::metadata::read(&pic, &stripped, &V::Null), json!({}));
}
#[tokio::test]
async fn persisted_lan_restores_after_restart_and_an_occupied_port_is_recoverable() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(dir.path(), dir.path()).unwrap();
    let web = Web::new(core.clone());
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let cfg = Config {
        enabled: true,
        lan: true,
        port,
    };
    web.set(cfg.clone()).await.unwrap();
    let original = load(&core.db.lock().unwrap(), "private", "web")
        .unwrap()
        .unwrap();
    web.set(Config {
        enabled: false,
        ..cfg.clone()
    })
    .await
    .unwrap();
    put(&core.db.lock().unwrap(), "private", "web", &original).unwrap();
    drop(web);
    drop(core);
    let held = TcpListener::bind(("0.0.0.0", port)).unwrap();
    let core = Core::open(dir.path(), dir.path()).unwrap();
    let web = Web::new(core);
    web.restore().await;
    let state = web.status().await;
    assert_eq!(state["running"], false);
    assert_eq!(state["enabled"], true);
    assert!(state["error"].is_string());
    drop(held);
    web.restore().await;
    let state = web.status().await;
    assert_eq!(state["running"], true);
    assert_eq!(state["port"], port);
    assert_eq!(state["lan"], true);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for url in state["urls"].as_array().unwrap() {
        let v: V = client
            .get(format!("{}/api/session", url.as_str().unwrap()))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(v["authenticated"], false);
    }
    web.set(Config {
        enabled: false,
        ..cfg
    })
    .await
    .unwrap();
    assert!(TcpListener::bind(("0.0.0.0", port)).is_ok());
}
#[tokio::test]
async fn synthetic_comic_runs_all_three_stages_and_batches_cancel() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    fn mock(path: &str, b: Option<&V>) -> Res<(Vec<u8>, String)> {
        let v = match path {
            "/user/information" => json!({"plainTextEmail":"test@example.invalid"}),
            "/user/subscription" => json!({"tier":3,"active":true}),
            "/ai/generate-image" => {
                let img = image::DynamicImage::new_rgb8(64, 64);
                let mut buf = std::io::Cursor::new(vec![]);
                img.write_to(&mut buf, image::ImageFormat::Png).unwrap();
                json!({"images":[{"image":STANDARD.encode(buf.into_inner())}]})
            }
            "/oa/v1/chat/completions" => {
                let u: V = serde_json::from_str(s(&b.unwrap()["messages"][1], "content")).unwrap();
                let reply = if u["storyDraft"].is_null() {
                    "Story draft".into()
                } else if u.get("characters").is_none() {
                    json!({"characters":[{"id":"c1","name":"Sam"}],"visualStyle":"ink"}).to_string()
                } else {
                    json!({"summary":"Greeting","sections":[{"panels":[{"summary":"morning","instances":[{"prompt":"a person","characterId":"c1"}],"dialogues":[{"text":"Hello","speakerId":"c1"}]}]}]}).to_string()
                };
                json!({"choices":[{"message":{"content":reply}}]})
            }
            _ => return Err(Fault::missing()),
        };
        Ok((serde_json::to_vec(&v)?, "application/json".into()))
    }
    let dir = tempfile::tempdir().unwrap();
    let c = Core::open(dir.path(), dir.path()).unwrap();
    c.mock.set(mock).unwrap();
    assert_eq!(
        c.dispatch(
            "desktop",
            "POST",
            "/api/session/persistent-token",
            json!({"token":"fixture"})
        )
        .await
        .status,
        200
    );
    let plan=c.dispatch("desktop","POST","/api/comic/plan",json!({"text":"Morning greeting","sections":[{"id":"page1","width":832,"height":1216,"referencePanels":[{"id":"panel1","number":1}]}]})).await;
    assert_eq!(plan.status, 200, "{}", plan.body);
    let section = &plan.body["plan"]["sections"][0];
    assert_eq!(section["instances"][0]["panelId"], "panel1");
    assert_eq!(section["dialogues"][0]["text"], "Hello");
    let batch = json!({"positivePrompt":"fixture","batch_id":"batch-qa","index":0,"batch_size":2});
    assert_eq!(
        c.dispatch("desktop", "POST", "/api/images/generate", batch.clone())
            .await
            .status,
        200
    );
    let mut next = batch;
    next["index"] = json!(1);
    let wait = c
        .dispatch("desktop", "POST", "/api/images/generate", next.clone())
        .await;
    assert_eq!(wait.status, 429);
    assert!(wait.body["retry_after"].as_f64().unwrap() > 0.);
    assert!(crate::batch::cancel(&c, "different-session", "batch-qa").is_err());
    c.dispatch(
        "desktop",
        "DELETE",
        "/api/images/batch",
        json!({"batch_id":"batch-qa"}),
    )
    .await;
    let reply = c
        .dispatch("desktop", "POST", "/api/images/generate", next)
        .await;
    assert_eq!(reply.status, 409);
    assert_eq!(reply.body["code"], "BATCH_CANCELLED");
}
#[tokio::test]
async fn interrupted_credential_change_resumes_without_replaying_mutation() {
    static KEYSTORE: Mutex<Option<V>> = Mutex::new(None);
    static CHANGED: AtomicBool = AtomicBool::new(false);
    fn mock(path: &str, b: Option<&V>) -> Res<(Vec<u8>, String)> {
        let v = match path {
            "/user/information" => json!({"plainTextEmail":"test@example.invalid"}),
            "/user/subscription" => json!({"active":true,"tier":3}),
            "/user/login" => json!({"accessToken":"fake-token"}),
            "/user/keystore" => {
                let mut ks = KEYSTORE.lock().unwrap();
                if let Some(x) = b {
                    *ks = Some(x.clone());
                    json!({})
                } else {
                    ks.clone().unwrap_or(json!({"keystore":null}))
                }
            }
            "/user/data" => json!({"keystore":null}),
            "/user/change-access-key" => {
                assert!(!CHANGED.swap(true, Ordering::SeqCst));
                return Err(Fault(
                    502,
                    "TIMEOUT".into(),
                    "synthetic interrupted response".into(),
                ));
            }
            _ => return Err(Fault::missing()),
        };
        Ok((serde_json::to_vec(&v)?, "application/json".into()))
    }
    let dir = tempfile::tempdir().unwrap();
    let c = Core::open(dir.path(), dir.path()).unwrap();
    c.mock.set(mock).unwrap();
    let login = c
        .dispatch(
            "desktop",
            "POST",
            "/api/session/password",
            json!({"email":"test@example.invalid","password":"original pass"}),
        )
        .await;
    assert_eq!(login.status, 200);
    let r=c.dispatch("desktop","POST","/api/account/change-password",json!({"backup_confirmed":true,"current_password":"original pass","new_password":"updated pass"})).await;
    assert_eq!(r.status, 409);
    drop(c);
    let c = Core::open(dir.path(), dir.path()).unwrap();
    c.mock.set(mock).unwrap();
    assert_eq!(crate::account::status(&c).unwrap()["active"], true);
    let r=c.dispatch("desktop","POST","/api/account/recovery/resolve",json!({"source_email":"test@example.invalid","target_email":"test@example.invalid","source_password":"original pass","target_password":"updated pass"})).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(crate::account::status(&c).unwrap()["active"], false);
    assert!(KEYSTORE.lock().unwrap().is_some());
}

#[tokio::test]
async fn scan_refresh_trash_restore_and_purge_files() {
    let dir = tempfile::tempdir().unwrap();
    let c = Core::open(dir.path(), dir.path()).unwrap();
    let folder = dir.path().join("outputs").join("nested");
    std::fs::create_dir_all(&folder).unwrap();
    let file = folder.join("external.png");
    image::DynamicImage::new_rgb8(64, 75).save(&file).unwrap();
    let first = c
        .dispatch(
            "desktop",
            "GET",
            "/api/local/gallery?source=outputs",
            V::Null,
        )
        .await;
    let key = first.body["items"][0]["id"].clone();
    assert!(key.is_string());
    let hash = first.body["items"][0]["digest"].as_str().unwrap();
    let object = dir.path().join("objects").join(hash);
    assert_eq!(first.body["items"][0]["height"], 75);
    for op in ["trash", "restore", "trash", "delete"] {
        let r = c
            .dispatch(
                "desktop",
                "POST",
                "/api/local/gallery/batch",
                json!({"action":op,"ids":[key]}),
            )
            .await;
        assert_eq!(r.body["errors"], json!([]), "{}", r.body);
        assert_eq!(file.exists(), op == "restore");
    }
    let list = c
        .dispatch(
            "desktop",
            "GET",
            "/api/local/gallery?source=outputs",
            V::Null,
        )
        .await;
    assert_eq!(list.body["total"], 0);
    assert!(!object.exists());
}

#[tokio::test]
async fn invalid_version_never_sends_paid_request_and_snapshots_strip_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let c = Core::open(dir.path(), dir.path()).unwrap();
    fn mock(path: &str, _: Option<&V>) -> Res<(Vec<u8>, String)> {
        assert!(!path.starts_with("/ai/"), "Paid request before validation");
        Ok((b"{}".to_vec(), "application/json".into()))
    }
    c.mock.set(mock).unwrap();
    c.dispatch(
        "desktop",
        "POST",
        "/api/session/persistent-token",
        json!({"token":"test"}),
    )
    .await;
    let failed = c
        .dispatch(
            "desktop",
            "POST",
            "/api/images/generate",
            json!({"version_context":{"work_id":"nonexistent","parent_version_id":null}}),
        )
        .await;
    assert_eq!(failed.status, 404);
    let v=crate::works::safe(&json!({"positivePrompt":"keep","batch_id":"temporary","mask":"image data","token":"bad","director_reference_images_cached":[{"data":"image data","cache_secret_key":"bad"}]})).unwrap();
    assert_eq!(
        v,
        json!({"positivePrompt":"keep","mask":"image data","director_reference_images_cached":[{"data":"image data"}]})
    );
}

#[test]
fn full_payloads_and_tool_costs_match_flask_oracles() {
    fn equal(a: &V, b: &V) -> bool {
        match (a, b) {
            (V::Number(a), V::Number(b)) => a.as_f64() == b.as_f64(),
            (V::Object(a), V::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .all(|(k, v)| b.get(k).is_some_and(|v2| equal(v, v2)))
            }
            (V::Array(a), V::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
            }
            _ => a == b,
        }
    }
    let data: V =
        serde_json::from_str(include_str!("../tests/fixtures/official-payloads.json")).unwrap();
    for c in data["generation"].as_array().unwrap() {
        let actual = crate::generation::payload(&c["input"]).unwrap();
        assert!(
            equal(&actual, &c["expected"]),
            "input: {} expected: {} actual: {}",
            c["input"],
            c["expected"],
            actual
        );
    }
    for c in data["estimate"].as_array().unwrap() {
        let mut actual = crate::generation::estimate(&c["input"], &json!({})).unwrap();
        let m = actual.as_object_mut().unwrap();
        m.remove("affordable");
        m.remove("balance");
        assert!(
            equal(&actual, &c["expected"]),
            "input: {} expected: {} actual: {}",
            c["input"],
            c["expected"],
            actual
        );
    }
}
