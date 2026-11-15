use crate::{
    service::*,
    web::{Config, Web},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value as V};
fn fixture() -> Vec<u8> {
    let img = image::DynamicImage::new_rgb8(24, 18);
    let mut buf = std::io::Cursor::new(vec![]);
    img.write_to(&mut buf, image::ImageFormat::Png).unwrap();
    buf.into_inner()
}
fn official(path: &str, b: Option<&V>) -> Res<(Vec<u8>, String)> {
    let v = match path {
        "/user/information" => json!({"plainTextEmail":"qa@example.invalid"}),
        "/user/subscription" => {
            json!({"active":true,"tier":3,"trainingStepsLeft":{"fixedTrainingStepsLeft":2,"purchasedTrainingSteps":3}})
        }
        "/ai/generate-image" => {
            assert_eq!(b.unwrap()["parameters"]["n_samples"], 1);
            json!({"images":[{"image":STANDARD.encode(fixture()),"seed":321}]})
        }
        _ => return Err(Fault::missing()),
    };
    Ok((serde_json::to_vec(&v).unwrap(), "application/json".into()))
}
#[tokio::test]
async fn installed_backend_contract_shared_by_ipc_and_http() {
    let tmp = tempfile::tempdir().unwrap();
    let c = Core::open(tmp.path(), tmp.path()).unwrap();
    c.mock.set(official).unwrap();
    let web = Web::new(c.clone());
    assert_eq!(web.status().await["running"], false);
    let port = std::net::TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let cfg = Config {
        enabled: true,
        port,
        lan: false,
    };
    web.set(cfg.clone()).await.unwrap();
    let origin = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::builder()
        .no_proxy()
        .cookie_store(true)
        .build()
        .unwrap();
    let login = format!("{origin}/api/session/persistent-token");
    assert_eq!(
        client
            .post(&login)
            .header("origin", "http://untrusted.invalid")
            .json(&json!({"token":"test"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let resp = client
        .post(&login)
        .header("origin", &origin)
        .json(&json!({"token":"fixture"}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let sess: V = resp.json().await.unwrap();
    assert_eq!(sess["account_snapshot"]["anlas"]["total"], 5);
    let csrf = s(&sess, "csrf_token");
    assert!(c.session("desktop").is_none());
    let generated = client
        .post(format!("{origin}/api/images/generate"))
        .header("origin", &origin)
        .header("x-csrf-token", csrf)
        .json(&json!({"positivePrompt":"test","model":"nai-diffusion-3","seed":321}))
        .send()
        .await
        .unwrap();
    assert_eq!(generated.status(), 200);
    let generated: V = generated.json().await.unwrap();
    let img = &generated["images"][0]["saved_file"];
    assert!(img["id"].is_string());
    let a = c
        .dispatch(
            "desktop",
            "GET",
            "/api/local/gallery?source=outputs",
            V::Null,
        )
        .await;
    assert_eq!(a.body["items"][0]["id"], img["id"]);
    let url = s(img, "url");
    let saved_image = c.asset(url).unwrap().0;
    assert_eq!(
        image::load_from_memory(&saved_image).unwrap().to_rgba8(),
        image::load_from_memory(&fixture()).unwrap().to_rgba8()
    );
    assert!(png::Decoder::new(std::io::Cursor::new(&saved_image))
        .read_info()
        .unwrap()
        .info()
        .utf8_text
        .iter()
        .any(|t| t.keyword == "Comment"));
    assert_eq!(
        client
            .get(format!("{origin}{url}"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        saved_image
    );
    assert_eq!(
        reqwest::Client::new()
            .get(format!("{origin}{url}"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert!(c.asset("/api/local/gallery/../file").is_err());
    let new = c
        .dispatch(
            "desktop",
            "POST",
            "/api/local/works",
            json!({"title":"QA","image_ids":[img["id"]],"parameters":{"prompt":"qa"}}),
        )
        .await;
    let work = s(&new.body["work"], "id");
    let version = s(&new.body["version"], "id");
    let snap = s(&new.body["version"]["images"][0], "url");
    assert_eq!(c.asset(snap).unwrap().0, saved_image);
    for act in ["trash", "delete"] {
        c.dispatch(
            "desktop",
            "POST",
            "/api/local/gallery/batch",
            json!({"ids":[img["id"]],"action":act}),
        )
        .await;
    }
    assert!(c.asset(url).is_err());
    assert_eq!(c.asset(snap).unwrap().0, saved_image);
    let restored = c
        .dispatch(
            "desktop",
            "POST",
            &format!("/api/local/works/{work}/versions"),
            json!({"parent_id":version,"operation":"restore"}),
        )
        .await;
    assert_eq!(restored.body["version"]["parameters"]["prompt"], "qa");
    assert_eq!(
        client
            .put(format!("{origin}/api/local/settings"))
            .header("origin", &origin)
            .json(&json!({"settings":{"locale":"zh-CN"}}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let fakehost = client
        .get(format!("{origin}/api/session"))
        .header("Host", format!("outside.test:{port}"))
        .send()
        .await
        .unwrap();
    assert_eq!(fakehost.status(), 400);
    web.set(Config {
        enabled: false,
        ..cfg.clone()
    })
    .await
    .unwrap();
    assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    assert_eq!(c.asset(snap).unwrap().0, saved_image);
    web.set(cfg.clone()).await.unwrap();
    let after: V = client
        .get(format!("{origin}/api/session"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after["authenticated"], false);
    web.set(Config {
        enabled: false,
        ..cfg
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn occupied_port_keeps_desktop_and_preferences_working() {
    let tmp = tempfile::tempdir().unwrap();
    let c = Core::open(tmp.path(), tmp.path()).unwrap();
    let w = Web::new(c.clone());
    let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    assert!(w
        .set(Config {
            enabled: true,
            lan: false,
            port: held.local_addr().unwrap().port()
        })
        .await
        .is_err());
    assert_eq!(w.status().await["enabled"], false);
    assert_eq!(
        c.dispatch("desktop", "GET", "/api/local/settings", V::Null)
            .await
            .status,
        200
    );
}
#[tokio::test]
async fn dpapi_and_note_transactions() {
    let tmp = tempfile::tempdir().unwrap();
    let c = Core::open(tmp.path(), tmp.path()).unwrap();
    let sess = Session {
        csrf: id(),
        token: "fixture-private-token".into(),
        snapshot: json!({"information":{"email":"qa@example.invalid"}}),
    };
    c.persist("desktop", Some(sess)).unwrap();
    assert!(!load(&c.db.lock().unwrap(), "private", "session")
        .unwrap()
        .unwrap()
        .to_string()
        .contains("fixture-private-token"));
    drop(c);
    let c = Core::open(tmp.path(), tmp.path()).unwrap();
    assert_eq!(c.session("desktop").unwrap().token, "fixture-private-token");
    c.persist("desktop", None).unwrap();
    let r = c
        .dispatch(
            "desktop",
            "POST",
            "/api/local/notes",
            json!({"note":{"title":"one"}}),
        )
        .await;
    assert_eq!(r.status, 201);
    let r = c
        .dispatch(
            "desktop",
            "POST",
            "/api/local/notes/import",
            json!({"content":[{"title":"two"},{"title":"one"}]}),
        )
        .await;
    assert_eq!(r.status, 409);
    assert_eq!(
        c.dispatch("desktop", "GET", "/api/local/notes", V::Null)
            .await
            .body["notes"]
            .as_array()
            .unwrap()
            .len(),
        1
    )
}
