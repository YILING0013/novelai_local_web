use crate::service::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use blake2::{
    digest::{Update, VariableOutput},
    Blake2bVar,
};
#[cfg(not(target_os = "android"))]
use bytes::Bytes;
#[cfg(not(target_os = "android"))]
use http_body_util::{BodyExt, Full, Limited};
#[cfg(not(target_os = "android"))]
use hyper_openssl::client::legacy::HttpsConnector;
#[cfg(not(target_os = "android"))]
use hyper_util::{
    client::legacy::{connect::HttpConnector, Client},
    rt::TokioExecutor,
};
#[cfg(not(target_os = "android"))]
use openssl::ssl::{SslConnector, SslMethod, SslVerifyMode, SslVersion};
use serde_json::{json, Value as V};
#[cfg(not(target_os = "android"))]
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::OnceLock, time::Duration};
const MAX_REPLY: usize = 64 * 1024 * 1024;
pub fn derive(email: &str, password: &str, size: usize, domain: &str) -> Res<String> {
    let prefix = String::from_utf16_lossy(&password.encode_utf16().take(6).collect::<Vec<_>>());
    let mut hash = Blake2bVar::new(16).unwrap();
    hash.update(format!("{prefix}{}{domain}", email.trim().to_lowercase()).as_bytes());
    let mut salt = [0; 16];
    hash.finalize_variable(&mut salt).unwrap();
    let mut buf = vec![0; size];
    argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(1953, 2, 1, Some(size))
            .map_err(|_| Fault::bad("Invalid key parameters."))?,
    )
    .hash_password_into(password.as_bytes(), &salt, &mut buf)
    .map_err(|_| Fault::bad("Credential derivation failed."))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}
#[cfg(not(target_os = "android"))]
fn profile(core: &Core, identity: &str) -> Res<u64> {
    let key = format!("{:x}", Sha256::digest(identity.as_bytes()));
    let db = core.db.lock().unwrap();
    if let Some(v) = load(&db, "tls", &key)? {
        return v
            .as_u64()
            .filter(|n| *n < 2048)
            .ok_or_else(|| Fault::bad("Invalid account TLS binding."));
    }
    let used = all(&db, "tls")?;
    let start = rand::random::<u16>() as u64 % 2048;
    let mask = (0..2048)
        .map(|n| (n + start) % 2048)
        .find(|x| !used.iter().any(|v| v.as_u64() == Some(*x)))
        .ok_or_else(|| Fault::bad("No TLS profiles remain."))?;
    put(&db, "tls", &key, &json!(mask))?;
    Ok(mask)
}
#[cfg(not(target_os = "android"))]
pub(crate) fn inherit(core: &Core, parent: &str, token: &str) -> Res<()> {
    let mask = profile(core, parent)?;
    put(
        &core.db.lock().unwrap(),
        "tls",
        &format!("{:x}", Sha256::digest(token.as_bytes())),
        &json!(mask),
    )
}
#[cfg(not(target_os = "android"))]
pub(crate) fn login_binding(c: &Core, key: &str, token: &str) -> Res<()> {
    let fallback = profile(c, key)?;
    let mut db = c.db.lock().unwrap();
    let tx = db.transaction()?;
    let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    let value = match load(&tx, "tls", &token_hash)? {
        Some(v) => v
            .as_u64()
            .filter(|n| *n < 2048)
            .ok_or_else(|| Fault::bad("Invalid account TLS binding."))?,
        None => fallback,
    };
    put(&tx, "tls", &token_hash, &json!(value))?;
    put(
        &tx,
        "tls",
        &format!("{:x}", Sha256::digest(key.as_bytes())),
        &json!(value),
    )?;
    tx.commit()?;
    Ok(())
}
#[cfg(not(target_os = "android"))]
fn ciphers(mask: u64) -> String {
    let mut c = vec![
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
    ];
    for (i, s) in [
        "ECDHE-ECDSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES256-GCM-SHA384",
        "ECDHE-ECDSA-CHACHA20-POLY1305",
        "ECDHE-RSA-CHACHA20-POLY1305",
        "DHE-RSA-AES128-GCM-SHA256",
        "DHE-RSA-AES256-GCM-SHA384",
        "DHE-RSA-CHACHA20-POLY1305",
        "ECDHE-ECDSA-AES128-CCM",
        "ECDHE-ECDSA-AES256-CCM",
        "DHE-RSA-AES128-CCM",
        "DHE-RSA-AES256-CCM",
    ]
    .into_iter()
    .enumerate()
    {
        if mask & (1 << i) != 0 {
            c.push(s)
        }
    }
    c.join(":")
}
fn net() -> Fault {
    Fault(
        502,
        "NOVELAI_UPSTREAM_ERROR".into(),
        "Could not complete the request to NovelAI.".into(),
    )
}
fn upstream_url(path: &str) -> String {
    let host = if path == "/oa/v1/chat/completions" {
        "text.novelai.net"
    } else {
        "image.novelai.net"
    };
    format!("https://{host}{path}")
}

fn status_error(status: u16) -> Fault {
    Fault(
        status,
        "NOVELAI_UPSTREAM_ERROR".into(),
        format!("NovelAI returned HTTP {status}."),
    )
}

#[cfg(not(target_os = "android"))]
pub async fn request(
    core: &Core,
    identity: &str,
    token: Option<&str>,
    m: &str,
    path: &str,
    b: Option<&V>,
) -> Res<(Vec<u8>, String)> {
    #[cfg(test)]
    if let Some(handler) = core.mock.get() {
        return handler(path, b);
    }
    let mask = profile(core, identity)?;
    let mut tls = SslConnector::builder(SslMethod::tls_client()).map_err(|_| net())?;
    tls.set_min_proto_version(Some(SslVersion::TLS1_2))
        .map_err(|_| net())?;
    tls.set_verify(SslVerifyMode::PEER);
    // OpenSSL ignores unsupported members when setting a combined cipher list.
    // Probe each member alone once, so profiles cannot silently collapse together.
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    if !*SUPPORTED.get_or_init(|| {
        ciphers(2047)
            .split(':')
            .all(|s| tls.set_cipher_list(s).is_ok())
    }) {
        return Err(Fault::bad(
            "The TLS runtime does not support the account profile.",
        ));
    }
    tls.set_cipher_list(&ciphers(mask)).map_err(|_| net())?;
    tls.set_ca_file(core.resources.join("cacert.pem"))
        .map_err(|_| net())?;
    let mut http = HttpConnector::new();
    http.enforce_http(false);
    http.set_connect_timeout(Some(Duration::from_secs(20)));
    let connector = HttpsConnector::with_connector(http, tls).map_err(|_| net())?;
    let client = Client::builder(TokioExecutor::new()).build::<_, Full<Bytes>>(connector);
    let mut req = axum::http::Request::builder()
        .uri(upstream_url(path))
        .method(m)
        .header("accept", "application/json")
        .header("x-correlation-id", &id()[..6]);
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"))
    }
    if b.is_some() {
        req = req.header("content-type", "application/json")
    }
    let req = req
        .body(Full::new(Bytes::from(
            b.map(V::to_string).unwrap_or_default(),
        )))
        .map_err(|_| Fault::bad("Invalid request."))?;
    tokio::time::timeout(Duration::from_secs(180), async {
        let r = client.request(req).await.map_err(|_| net())?;
        let status = r.status();
        if !status.is_success() {
            return Err(status_error(status.as_u16()));
        }
        let mime = r
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let raw = Limited::new(r.into_body(), MAX_REPLY)
            .collect()
            .await
            .map_err(|_| net())?
            .to_bytes()
            .to_vec();
        Ok((raw, mime))
    })
    .await
    .map_err(|_| net())?
}

/// Android 使用标准 Rustls HTTPS，限制响应大小并禁止重定向或重发生成请求。
#[cfg(target_os = "android")]
pub async fn request(
    _core: &Core,
    _identity: &str,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<&V>,
) -> Res<(Vec<u8>, String)> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = if let Some(client) = CLIENT.get() {
        client
    } else {
        let client = reqwest::Client::builder()
            .https_only(true)
            .min_tls_version(reqwest::tls::Version::TLS_1_2)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|_| net())?;
        CLIENT.get_or_init(|| client)
    };
    let mut request = client
        .request(
            method.parse().map_err(|_| Fault::bad("Invalid request."))?,
            upstream_url(path),
        )
        .header("accept", "application/json")
        .header("x-correlation-id", &id()[..6]);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    let mut response = request.send().await.map_err(|_| net())?;
    if !response.status().is_success() {
        return Err(status_error(response.status().as_u16()));
    }
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| net())? {
        if bytes.len() + chunk.len() > MAX_REPLY {
            return Err(net());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, mime))
}
pub(crate) async fn json_req(
    c: &Core,
    identity: &str,
    token: Option<&str>,
    m: &str,
    p: &str,
    b: Option<&V>,
) -> Res<V> {
    let (raw, _) = request(c, identity, token, m, p, b).await?;
    serde_json::from_slice(&raw).map_err(|_| net())
}
pub async fn login(c: &Core, mode: &str, b: &V) -> Res<Session> {
    let email = s(b, "email").trim().to_lowercase();
    let token = if mode == "password" {
        if !email.contains('@') || email.len() > 320 {
            return Err(Fault::bad("Invalid email address."));
        }
        let pass = b["password"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 4096)
            .ok_or_else(|| Fault::bad("Invalid password."))?;
        let key = derive(&email, pass, 64, "novelai_data_access_key")?[..64].to_string();
        let r = json_req(
            c,
            &key,
            None,
            "POST",
            "/user/login",
            Some(&json!({"key":key})),
        )
        .await?;
        let t = field(&r, "accessToken", 4096)?;
        #[cfg(not(target_os = "android"))]
        login_binding(c, &key, &t)?;
        t
    } else {
        field(b, "token", 4096)?
    };
    let snapshot = snapshot(
        c,
        &token,
        if mode == "password" {
            "password"
        } else {
            "persistent_token"
        },
        &email,
    )
    .await?;
    Ok(Session {
        token,
        csrf: id(),
        snapshot,
    })
}
pub async fn snapshot(c: &Core, t: &str, mode: &str, email: &str) -> Res<V> {
    let (i, sub) = tokio::try_join!(
        json_req(c, t, Some(t), "GET", "/user/information", None),
        json_req(c, t, Some(t), "GET", "/user/subscription", None)
    )?;
    let steps = &sub["trainingStepsLeft"];
    let fixed = steps["fixedTrainingStepsLeft"].as_i64();
    let purchased = steps["purchasedTrainingSteps"].as_i64();
    let u = &sub["usage"];
    Ok(
        json!({"auth":{"login_mode":mode,"can_manage_credentials":mode=="password"},"information":{"email":i["plainTextEmail"].as_str().unwrap_or(email),"email_verified":i["emailVerified"],"account_created_at":i["accountCreatedAt"],"trial_activated":i["trialActivated"],"trial_actions_left":i["trialActionsLeft"],"trial_images_left":i["trialImagesLeft"],"ban_status":i.get("banStatus").unwrap_or(&i["banned"]),"ban_message":i["banMessage"]},"subscription":{"tier":sub["tier"],"active":sub["active"],"expires_at":sub["expiresAt"],"is_grace_period":sub["isGracePeriod"]},"anlas":{"fixed":fixed,"purchased":purchased,"total":fixed.zip(purchased).map(|(x,y)|x+y)},"v5":{"percent":u["percent"],"is_negative":u["isNegative"],"available":u["isNegative"].as_bool().map(|x|!x),"time_until_next_percent":u["timeUntilNextPercent"]},"refreshed_at":now(),"stale":false}),
    )
}
fn dict(c: &Core) -> &'static Vec<V> {
    static TAGS: OnceLock<Vec<V>> = OnceLock::new();
    TAGS.get_or_init(||{let mut tags=vec![];let mut paths=std::fs::read_dir(c.resources.join("prompt_tags")).into_iter().flatten().flatten().map(|x|x.path()).collect::<Vec<_>>();paths.sort();for p in paths{if p.extension().is_none_or(|x|x!="csv"){continue}if let Ok(mut r)=csv::ReaderBuilder::new().flexible(true).from_path(p){for row in r.records().flatten(){let name=row.get(0).unwrap_or("");if !name.is_empty(){tags.push(json!({"name":name,"tag_name":name,"group":row.get(1),"d_category":row.get(1),"count":row.get(2).and_then(|s|s.parse::<usize>().ok()).unwrap_or(0),"translation":row.get(4).unwrap_or(""),"source":"local"}))}}}}tags})
}
pub async fn operation(
    c: &Shared,
    caller: &str,
    sess: Option<&Session>,
    m: &str,
    p: &[&str],
    q: &Query,
    b: &V,
) -> Res<V> {
    match (p, m) {
        (["translate-tags"], "POST") => {
            let requested = b["tags"]
                .as_array()
                .filter(|a| a.len() <= 1000)
                .ok_or_else(|| Fault::bad("Invalid tags."))?;
            let wanted = requested
                .iter()
                .filter_map(|x| x.as_str())
                .map(|x| x.trim().replace('_', " ").to_lowercase())
                .collect::<std::collections::HashSet<_>>();
            let mut values = HashMap::new();
            for tag in dict(c) {
                let key = s(tag, "name").replace('_', " ").to_lowercase();
                if wanted.contains(&key) && !s(tag, "translation").is_empty() {
                    values.insert(key, &tag["translation"]);
                }
            }
            return Ok(json!({"translations":values}));
        }
        (["suggest-tags"], "GET") => {
            let term = q
                .get("prompt")
                .or(q.get("query"))
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            let tags = if term.is_empty() {
                vec![]
            } else {
                dict(c)
                    .iter()
                    .filter(|v| {
                        s(v, "name").to_lowercase().contains(&term)
                            || s(v, "translation").contains(&term)
                    })
                    .take(20)
                    .collect()
            };
            return Ok(json!({"tags":tags,"count":tags.len(),"upstream_status":"not_requested"}));
        }
        _ => {}
    }
    let session =
        sess.ok_or_else(|| Fault(401, "AUTH_REQUIRED".into(), "Sign in first.".into()))?;
    let t = &session.token;
    match (p, m) {
        (["images", "tags"], "GET") => {
            let qs = serde_urlencoded::to_string(q).map_err(|_| Fault::bad("Invalid query."))?;
            let r = json_req(
                c,
                t,
                Some(t),
                "GET",
                &format!("/ai/generate-image/suggest-tags?{qs}"),
                None,
            )
            .await?;
            Ok(
                json!({"tags":r.get("tags").unwrap_or(&r),"account_snapshot":session.snapshot,"correlation_id":id()}),
            )
        }
        (["images", "batch"], "DELETE") => {
            crate::batch::cancel(c, caller, &field(b, "batch_id", 128)?)?;
            Ok(json!({"cancelled":true,"batch_id":b["batch_id"]}))
        }
        (["image-tools", "estimate"], "POST") => crate::generation::estimate(b, &session.snapshot),
        (["images", op @ ("generate" | "augment" | "upscale" | "vibe")], "POST") => {
            let mut result = crate::generation::generate(c, caller, session, op, b).await?;
            let mut updated = session.clone();
            let fresh = snapshot(
                c,
                &session.token,
                s(&session.snapshot["auth"], "login_mode"),
                s(&session.snapshot["information"], "email"),
            )
            .await;
            match fresh {
                Ok(v) => updated.snapshot = v,
                Err(_) => updated.snapshot["stale"] = json!(true),
            }
            result["account_snapshot"] = updated.snapshot.clone();
            if c.session(caller).is_some_and(|s| s.csrf == session.csrf) {
                c.persist(caller, Some(updated))?;
            }
            Ok(result)
        }
        _ => Err(Fault::unsupported()),
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tls_tests {
    use super::*;
    #[test]
    fn token_binding_survives_later_password_login_and_restart() {
        let temp = tempfile::tempdir().unwrap();
        let c = Core::open(temp.path(), temp.path()).unwrap();
        let a = profile(&c, "test-token").unwrap();
        let b = profile(&c, "new-key").unwrap();
        assert_ne!(a, b);
        login_binding(&c, "new-key", "test-token").unwrap();
        drop(c);
        let c = Core::open(temp.path(), temp.path()).unwrap();
        assert_eq!(profile(&c, "new-key").unwrap(), a);
        assert_eq!(profile(&c, "test-token").unwrap(), a);
        let mut ssl = SslConnector::builder(SslMethod::tls_client()).unwrap();
        for s in ciphers(2047).split(':') {
            ssl.set_cipher_list(s).unwrap();
        }
        let unique = (0..2048)
            .map(ciphers)
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(unique.len(), 2048);
    }
}
