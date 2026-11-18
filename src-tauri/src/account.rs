use crate::{official, service::*};
use base64::{engine::general_purpose::STANDARD, Engine};
use blake2::{
    digest::{Update, VariableOutput},
    Blake2bVar,
};
use crypto_secretbox::{
    aead::{Aead, AeadCore, OsRng},
    KeyInit, Nonce, XSalsa20Poly1305,
};
use serde_json::{json, Value as V};
use sha2::{Digest, Sha256};
const ACCESS: &str = "novelai_data_access_key";
const ENCRYPT: &str = "novelai_data_encryption_key";
fn uncertain() -> Fault {
    Fault(
        409,
        "ACCOUNT_CHANGE_UNCERTAIN".into(),
        "The credential change is pending. Use account recovery before trying again.".into(),
    )
}
fn validate(v: &V) -> Res<()> {
    let keys = v["keys"]
        .as_object()
        .ok_or_else(|| Fault::bad("Invalid keystore."))?;
    for (k, x) in keys {
        if k.is_empty()
            || serde_json::from_value::<Vec<u8>>(x.clone()).map_or(true, |xs| xs.len() != 32)
        {
            return Err(Fault::bad("Invalid keystore item."));
        }
    }
    Ok(())
}
fn cipher(text: &str) -> XSalsa20Poly1305 {
    let mut h = Blake2bVar::new(32).unwrap();
    h.update(text.as_bytes());
    let mut key = [0; 32];
    h.finalize_variable(&mut key).unwrap();
    XSalsa20Poly1305::new((&key).into())
}
fn unpack(raw: &str, key: &str) -> Res<(V, V)> {
    let env: V = serde_json::from_slice(
        &STANDARD
            .decode(raw)
            .map_err(|_| Fault::bad("Invalid keystore encoding."))?,
    )?;
    if env["version"] != 2 || env.get("iv").is_some() != env.get("data").is_some() {
        return Err(Fault::bad("Unsupported keystore format."));
    }
    let n: [u8; 24] = serde_json::from_value(env["nonce"].clone())?;
    let data: Vec<u8> = serde_json::from_value(env["sdata"].clone())?;
    let clear = cipher(key)
        .decrypt(Nonce::from_slice(&n), data.as_slice())
        .map_err(|_| Fault::bad("Could not authenticate the keystore."))?;
    let v = serde_json::from_slice(&clear)?;
    validate(&v)?;
    let legacy = if env.get("iv").is_some() {
        json!({"iv":env["iv"],"data":env["data"]})
    } else {
        json!({})
    };
    Ok((v, legacy))
}
fn pack(v: &V, mut legacy: V, key: &str) -> Res<String> {
    validate(v)?;
    let nonce = XSalsa20Poly1305::generate_nonce(&mut OsRng);
    let data = cipher(key)
        .encrypt(&nonce, serde_json::to_vec(v)?.as_slice())
        .map_err(|_| Fault::bad("Could not protect the keystore."))?;
    legacy["version"] = json!(2);
    legacy["nonce"] = json!(nonce.as_slice());
    legacy["sdata"] = json!(data);
    let encoded = STANDARD.encode(serde_json::to_vec(&legacy)?);
    if unpack(&encoded, key)?.0 != *v {
        return Err(Fault::bad("Keystore validation failed."));
    }
    Ok(encoded)
}
fn digest(salt: &str, data: &str) -> String {
    let mut h = Sha256::new();
    Digest::update(&mut h, salt.as_bytes());
    Digest::update(&mut h, data.as_bytes());
    format!("{:x}", h.finalize())
}
pub fn status(c: &Core) -> Res<V> {
    Ok(match load(&c.db.lock().unwrap(), "private", "recovery")? {
        None => json!({"active":false}),
        Some(j) => {
            json!({"active":true,"stage":j["stage"],"operation":j["operation"],"created_at":j["created_at"],"updated_at":j["updated_at"],"correlation_id":j["correlation_id"]})
        }
    })
}
fn stage(c: &Core, j: &mut V, stage: &str) -> Res<()> {
    j["stage"] = json!(stage);
    j["updated_at"] = json!(now());
    put(&c.db.lock().unwrap(), "private", "recovery", j)
}
async fn login_key(c: &Core, key: &str) -> Res<String> {
    let v = official::json_req(
        c,
        key,
        None,
        "POST",
        "/user/login",
        Some(&json!({"key":key})),
    )
    .await?;
    let t = field(&v, "accessToken", 4096)?;
    #[cfg(not(target_os = "android"))]
    official::login_binding(c, key, &t)?;
    Ok(t)
}
async fn remote(c: &Core, t: &str) -> Res<(Option<String>, V)> {
    let r = official::json_req(c, t, Some(t), "GET", "/user/keystore", None).await;
    let parse = |v: &V| -> Res<(Option<String>, V)> {
        let index = v["changeIndex"].clone();
        if !index.is_null() && index.as_u64().is_none() {
            return Err(Fault::bad("Invalid change index."));
        }
        if !v["keystore"].is_null() && !v["keystore"].is_string() {
            return Err(Fault::bad("Invalid keystore."));
        }
        Ok((
            v["keystore"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            index,
        ))
    };
    match r {
        Ok(v) if v.is_object() && (v["statusCode"].is_null() || v["statusCode"] == 200) => {
            let ks = parse(&v)?;
            if ks.0.is_some() {
                return Ok(ks);
            }
        }
        Ok(v) if v["statusCode"] == 404 => {}
        Err(e) if e.0 == 404 => {}
        Err(e) => return Err(e),
        _ => return Err(Fault::bad("Invalid keystore response.")),
    }
    let v = official::json_req(c, t, Some(t), "GET", "/user/data", None).await?;
    if !v.is_object()
        || (!v["statusCode"].is_null() && v["statusCode"] != 200)
        || (!v["keystore"].is_object() && !v["keystore"].is_null())
    {
        return Err(Fault::bad("Could not verify keystore state."));
    }
    parse(&v["keystore"])
}
pub async fn change(c: &Shared, caller: &str, op: &str, sess: Option<&Session>, b: &V) -> Res<V> {
    let _guard = c.credential_lock.try_lock().map_err(|_| uncertain())?;
    let _image = c
        .image_lock
        .try_lock()
        .map_err(|_| Fault::bad("An image operation is running."))?;
    let restoring = op == "resolve";
    let journal = load(&c.db.lock().unwrap(), "private", "recovery")?;
    let mut j = journal.clone().unwrap_or_else(|| json!({}));
    if restoring != journal.is_some() {
        return Err(if restoring {
            Fault::missing()
        } else {
            uncertain()
        });
    }
    let (src_email, src_pass, dst_email, dst_pass) = if restoring {
        (
            field(b, "source_email", 320)?,
            s(b, "source_password"),
            field(b, "target_email", 320)?,
            s(b, "target_password"),
        )
    } else {
        let sess =
            sess.ok_or_else(|| Fault(401, "AUTH_REQUIRED".into(), "Sign in first.".into()))?;
        if sess.snapshot["auth"]["login_mode"] != "password" || b["backup_confirmed"] != true {
            return Err(Fault::bad(
                "Password login and recovery backup confirmation are required.",
            ));
        }
        let email = field(&sess.snapshot["information"], "email", 320)?;
        let pass = s(b, "current_password");
        if op == "change-email" {
            (email, pass, field(b, "new_email", 320)?, pass)
        } else {
            (email.clone(), pass, email, s(b, "new_password"))
        }
    };
    let src_email = src_email.trim().to_lowercase();
    let dst_email = dst_email.trim().to_lowercase();
    if ![&src_email, &dst_email].iter().all(|x| {
        x.split_once('@').is_some_and(|(a, b)| {
            !a.is_empty() && b.contains('.') && !x.chars().any(char::is_whitespace)
        })
    }) || src_pass.is_empty()
        || dst_pass.is_empty()
        || src_pass.len() > 4096
        || dst_pass.len() > 4096
        || (!restoring && op == "change-password" && dst_pass.chars().count() < 8)
        || (src_email == dst_email && src_pass == dst_pass)
    {
        return Err(Fault::bad("Check your current and proposed credentials."));
    }
    let sk = official::derive(&src_email, src_pass, 64, ACCESS)?[..64].to_string();
    let dk = official::derive(&dst_email, dst_pass, 64, ACCESS)?[..64].to_string();
    let source = official::derive(&src_email, src_pass, 128, ENCRYPT)?;
    let dest = official::derive(&dst_email, dst_pass, 128, ENCRYPT)?;
    let target = if restoring {
        let salt = s(&j, "salt");
        if j["source"] != digest(salt, &sk) || j["target"] != digest(salt, &dk) {
            return Err(Fault::bad("Credentials do not match the recovery record."));
        }
        #[cfg(not(target_os = "android"))]
        official::inherit(c, &sk, &dk)?;
        login_key(c, &dk).await.map_err(|_| uncertain())?
    } else {
        let token = login_key(c, &sk).await?;
        let first = remote(c, &token).await?;
        let clear = if let Some(raw) = &first.0 {
            unpack(raw, &source)?
        } else {
            (json!({"keys":{}}), json!({}))
        };
        let _verified = pack(&clear.0, clear.1.clone(), &dest)?;
        if first != remote(c, &token).await? {
            return Err(Fault::bad(
                "The remote keystore changed. Restart this operation.",
            ));
        }
        let salt = id();
        j = json!({"operation":if op=="change-email"{"email"}else{"password"},"stage":"prepared","created_at":now(),"salt":salt,"source":digest(&salt,&sk),"target":digest(&salt,&dk),"fingerprint":digest("",&clear.0.to_string()),"correlation_id":id()});
        stage(c, &mut j, "change_result_unknown")?;
        let mut b = json!({"currentAccessKey":sk,"newAccessKey":dk});
        if op == "change-email" {
            b["newEmail"] = json!(dst_email)
        }
        let changed = official::json_req(
            c,
            &token,
            Some(&token),
            "POST",
            "/user/change-access-key",
            Some(&b),
        )
        .await;
        let v = match changed {
            Err(e) if matches!(e.0, 400 | 401 | 403 | 409 | 422) => {
                del(&c.db.lock().unwrap(), "private", "recovery")?;
                return Err(e);
            }
            Ok(v) => v,
            _ => return Err(uncertain()),
        };
        let nt = field(&v, "accessToken", 4096).map_err(|_| uncertain())?;
        #[cfg(not(target_os = "android"))]
        official::inherit(c, &token, &dk)?;
        #[cfg(not(target_os = "android"))]
        official::inherit(c, &token, &nt)?;
        stage(c, &mut j, "access_key_changed")?;
        nt
    };
    let current = remote(c, &target).await?;
    let verified = current
        .0
        .as_ref()
        .and_then(|raw| unpack(raw, &dest).ok())
        .is_some_and(|(plain, _)| digest("", &plain.to_string()) == s(&j, "fingerprint"));
    if !verified {
        let (plain, legacy) = match current.0 {
            Some(raw) => unpack(&raw, &source)?,
            None => (json!({"keys":{}}), json!({})),
        };
        if digest("", &plain.to_string()) != s(&j, "fingerprint") {
            return Err(uncertain());
        }
        let wrapped = pack(&plain, legacy, &dest)?;
        stage(c, &mut j, "keystore_result_unknown")?;
        official::request(
            c,
            &target,
            Some(&target),
            "PUT",
            "/user/keystore",
            Some(&json!({"keystore":wrapped})),
        )
        .await
        .map_err(|_| uncertain())?;
        let raw = remote(c, &target).await?.0.ok_or_else(uncertain)?;
        if unpack(&raw, &dest)?.0 != plain {
            return Err(uncertain());
        }
    }
    stage(c, &mut j, "verified")?;
    let token = login_key(c, &dk).await?;
    let snapshot = official::snapshot(c, &token, "password", &dst_email).await?;
    let sess = Session {
        token,
        csrf: sess.map(|s| s.csrf.clone()).unwrap_or_else(id),
        snapshot,
    };
    let mut out = sess.public();
    c.persist(caller, Some(sess))?;
    del(&c.db.lock().unwrap(), "private", "recovery")?;
    out["status"] = json!("completed");
    out["changed"] = json!(true);
    out["operation"] = j["operation"].clone();
    out["correlation_id"] = j["correlation_id"].clone();
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rewrap_preserves_unknown_fields_and_rejects_wrong_password() {
        let plain = json!({"keys":{"story":vec![7u8;32]},"future":42});
        let legacy = json!({"iv":[1,2],"data":[3,4]});
        let old = pack(&plain, legacy.clone(), "original").unwrap();
        assert!(unpack(&old, "wrong").is_err());
        let (p, l) = unpack(&old, "original").unwrap();
        let next = pack(&p, l, "new").unwrap();
        assert_eq!(unpack(&next, "new").unwrap(), (plain, legacy));
    }
}
