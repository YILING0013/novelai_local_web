use crate::{official, service::*};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value as V};
use std::collections::HashSet;
fn defaults() -> V {
    json!({"provider":"novelai","baseUrl":"","model":"","storyModel":"","extractModel":"","formatModel":"","outputMode":"schema","tokenParameter":"max_completion_tokens","maxTokens":8192,"temperature":null,"timeoutSeconds":180})
}
fn default_config() -> V {
    json!({"activeProviderId":"novelai","providers":[{"id":"novelai","name":"NovelAI","enabled":true,"settings":defaults()}]})
}
fn config(c: &Core) -> Res<V> {
    Ok(load(&c.db.lock().unwrap(), "comic", "config")?.unwrap_or_else(default_config))
}
fn scope(v: &V) -> String {
    format!(
        "{}\n{}\n{}",
        s(v, "id"),
        s(&v["settings"], "provider"),
        s(&v["settings"], "baseUrl")
    )
}
fn select<'a>(config: &'a V, requested: Option<&str>) -> Res<&'a V> {
    let name = requested.unwrap_or(s(config, "activeProviderId"));
    config["providers"]
        .as_array()
        .and_then(|p| p.iter().find(|p| p["id"] == name && p["enabled"] != false))
        .ok_or_else(|| Fault::bad("Select an enabled provider."))
}
fn secret(c: &Core, owner: &str, p: &V) -> Res<(String, bool)> {
    let identity = scope(p);
    if let Some(v) = load(&c.db.lock().unwrap(), "comic-secret", &identity)? {
        let bytes = STANDARD
            .decode(v.as_str().unwrap_or(""))
            .map_err(|_| Fault::bad("Damaged key."))?;
        let key = crate::secrets::unprotect(&bytes)
            .map_err(|_| Fault::bad("Could not unlock the API key."))?;
        return Ok((
            String::from_utf8(key).map_err(|_| Fault::bad("Invalid key."))?,
            true,
        ));
    }
    Ok((
        c.memory_keys
            .lock()
            .unwrap()
            .get(&(owner.into(), identity))
            .cloned()
            .unwrap_or_default(),
        false,
    ))
}
fn view(c: &Core, owner: &str, mut cfg: V) -> Res<V> {
    for p in cfg["providers"]
        .as_array_mut()
        .ok_or_else(|| Fault::bad("Invalid providers."))?
    {
        let (key, saved) = secret(c, owner, p)?;
        p["hasApiKey"] = json!(!key.is_empty());
        p["rememberApiKey"] = json!(saved)
    }
    let selected = select(&cfg, None)?;
    Ok(
        json!({"configuration":cfg,"settings":selected["settings"],"hasApiKey":selected["hasApiKey"],"rememberApiKey":selected["rememberApiKey"]}),
    )
}
fn save(c: &Core, owner: &str, b: &V) -> Res<V> {
    let mut cfg = b["configuration"].clone();
    if cfg.is_null() {
        let id = if b["settings"]["provider"] == "novelai" {
            "novelai"
        } else {
            "legacy"
        };
        cfg = json!({"activeProviderId":id,"providers":[{"id":id,"name":id,"enabled":true,"settings":b["settings"]}]})
    }
    let mut seen = HashSet::new();
    let mut keys = vec![];
    for p in cfg["providers"]
        .as_array_mut()
        .filter(|p| !p.is_empty() && p.len() <= 40)
        .ok_or_else(|| Fault::bad("Invalid providers."))?
    {
        let id = field(p, "id", 100)?;
        if !seen.insert(id.clone()) {
            return Err(Fault::bad("Duplicate provider ID."));
        }
        let name = field(p, "name", 128)?;
        let mut st = defaults();
        for (k, v) in st.as_object_mut().unwrap() {
            if let Some(entry) = p["settings"].get(k) {
                *v = entry.clone()
            }
        }
        if st["provider"] != "novelai" {
            let default = match s(&st, "provider") {
                "openai" => "https://api.openai.com/v1",
                "deepseek" => "https://api.deepseek.com",
                "claude" => "https://api.anthropic.com",
                "gemini" => "https://generativelanguage.googleapis.com",
                _ => return Err(Fault::bad("Unsupported API protocol.")),
            };
            let base = st["baseUrl"]
                .as_str()
                .filter(|x| !x.is_empty())
                .unwrap_or(default)
                .trim_end_matches('/');
            let url = url::Url::parse(base).map_err(|_| Fault::bad("Invalid model endpoint."))?;
            if !(url.scheme() == "https"
                || url.scheme() == "http"
                    && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(Fault::bad(
                    "Use HTTPS or a loopback HTTP endpoint without credentials.",
                ));
            }
            st["baseUrl"] = json!(base);
        }
        *p = json!({"id":id,"name":name,"enabled":p["enabled"].as_bool().unwrap_or(true),"settings":st});
        if let Some(change) = b["credentials"]
            .get(&id)
            .or_else(|| b.get("apiKey").map(|_| b))
        {
            let (old, saved) = secret(c, owner, p)?;
            let key = if change["clearApiKey"] == true {
                ""
            } else {
                change["apiKey"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&old)
            };
            let remember = change["rememberApiKey"].as_bool().unwrap_or(saved);
            keys.push((scope(p), key.to_owned(), remember));
        }
    }
    select(&cfg, None)?;
    {
        let mut lock = c.db.lock().unwrap();
        let db = lock.transaction()?;
        for (scope, key, remember) in &keys {
            if *remember && !key.is_empty() {
                let data = crate::secrets::protect(key.as_bytes())
                    .map_err(|_| Fault::bad("Could not protect the API key."))?;
                put(&db, "comic-secret", scope, &json!(STANDARD.encode(data)))?
            } else {
                del(&db, "comic-secret", scope)?
            }
        }
        put(&db, "comic", "config", &cfg)?;
        db.commit()?;
    }
    for (scope, key, remember) in keys {
        let mut memory = c.memory_keys.lock().unwrap();
        let k = (owner.into(), scope);
        if remember || key.is_empty() {
            memory.remove(&k);
        } else {
            memory.insert(k, key);
        }
    }
    view(c, owner, cfg)
}
fn decode(text: &str) -> Res<V> {
    let text = text.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .and_then(|s| s.trim_end().strip_suffix("```"))
        .unwrap_or(text);
    serde_json::from_str(text.trim()).map_err(|_| {
        Fault(
            502,
            "COMIC_PLAN_INVALID_JSON".into(),
            "The model did not return a complete JSON document.".into(),
        )
    })
}
async fn complete(
    c: &Core,
    owner: &str,
    sess: &Session,
    p: &V,
    m: &str,
    system: &str,
    user: &V,
    schema: Option<&V>,
) -> Res<String> {
    let st = &p["settings"];
    let prot = s(st, "provider");
    let message = user.to_string();
    let messages = json!([{"role":"system","content":system},{"role":"user","content":message}]);
    let max = st["maxTokens"].as_u64().unwrap_or(8192).clamp(32, 65536);
    if prot == "novelai" {
        let body = json!({"model":m,"messages":messages,"max_tokens":if schema.is_some(){4096}else{2048},"temperature":if schema.is_some(){0.45}else{0.8},"enable_thinking":false,"stream":true});
        let (raw, _) = official::request(
            c,
            &sess.token,
            Some(&sess.token),
            "POST",
            "/oa/v1/chat/completions",
            Some(&body),
        )
        .await?;
        let str = String::from_utf8(raw).map_err(|_| Fault::bad("Invalid story response."))?;
        if let Ok(r) = serde_json::from_str::<V>(&str) {
            return Ok(s(&r["choices"][0]["message"], "content").to_owned());
        }
        let mut out = String::new();
        for line in str.lines().filter_map(|x| x.strip_prefix("data:")) {
            if line.trim() == "[DONE]" {
                break;
            }
            if let Ok(v) = serde_json::from_str::<V>(line) {
                out.push_str(s(&v["choices"][0]["delta"], "content"))
            }
        }
        if out.is_empty() {
            return Err(Fault::bad("Empty story response."));
        }
        return Ok(out);
    }
    let (key, _) = secret(c, owner, p)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(
            st["timeoutSeconds"].as_u64().unwrap_or(180).clamp(5, 600),
        ))
        .build()
        .map_err(|_| Fault::bad("Invalid model client."))?;
    let base = s(st, "baseUrl");
    let req=match prot{
 "openai"|"deepseek"=>{let mut body=json!({"model":m,"messages":messages,"stream":false});body[if st["tokenParameter"]=="max_tokens"{"max_tokens"}else{"max_completion_tokens"}]=json!(max);if let Some(schema)=schema{if st["outputMode"]=="schema"{body["response_format"]=json!({"type":"json_schema","json_schema":{"name":"comic","strict":true,"schema":schema}})}else if st["outputMode"]=="json"{body["response_format"]=json!({"type":"json_object"})}}client.post(format!("{base}/chat/completions")).bearer_auth(key).json(&body)},
 "claude"=>client.post(format!("{base}/v1/messages")).header("x-api-key",key).header("anthropic-version","2023-06-01").json(&json!({"model":m,"system":system,"messages":[{"role":"user","content":message}],"max_tokens":max})),
 "gemini"=>{if m.contains(['/',':','?','#']){return Err(Fault::bad("Invalid model name."))}client.post(format!("{base}/v1beta/models/{m}:generateContent")).header("x-goog-api-key",key).json(&json!({"systemInstruction":{"parts":[{"text":system}]},"contents":[{"role":"user","parts":[{"text":message}]}],"generationConfig":{"maxOutputTokens":max}}))},_=>return Err(Fault::bad("Unsupported API protocol."))};
    let resp = req
        .send()
        .await
        .map_err(|_| Fault::bad("Could not reach the model endpoint."))?;
    if !resp.status().is_success() {
        return Err(Fault(
            502,
            "LLM_UPSTREAM_ERROR".into(),
            format!("Model endpoint returned HTTP {}.", resp.status().as_u16()),
        ));
    }
    let r: V = resp
        .json()
        .await
        .map_err(|_| Fault::bad("Invalid model response."))?;
    let text = match prot {
        "claude" => s(&r["content"][0], "text"),
        "gemini" => s(&r["candidates"][0]["content"]["parts"][0], "text"),
        _ => s(&r["choices"][0]["message"], "content"),
    };
    if text.is_empty() {
        return Err(Fault::bad("Model returned no text."));
    }
    Ok(text.to_owned())
}
fn array(v: &V) -> &[V] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub fn compile(draft: &V, extracted: &V, source: &V) -> Res<V> {
    let mut sections = vec![];
    for (sec, expected) in array(&draft["sections"])
        .iter()
        .zip(array(&source["sections"]))
    {
        let mut panels = vec![];
        let mut instances = vec![];
        let mut dialogues = vec![];
        for (index, p) in array(&sec["panels"]).iter().enumerate() {
            let reference = &expected["referencePanels"][index];
            let id = reference["id"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("p{}", index + 1));
            let number = reference["number"].as_u64().unwrap_or(index as u64 + 1);
            let mut panel = json!({"id":id,"number":number,"summary":s(p,"summary")});
            if p["bounds"].is_object() {
                panel["bounds"] = p["bounds"].clone()
            }
            panels.push(panel);
            for i in array(&p["instances"]) {
                if s(i, "prompt").trim().is_empty() {
                    continue;
                }
                let center = if i["center"]["x"]
                    .as_f64()
                    .is_some_and(|x| (0.0..=1.).contains(&x))
                    && i["center"]["y"]
                        .as_f64()
                        .is_some_and(|x| (0.0..=1.).contains(&x))
                {
                    i["center"].clone()
                } else {
                    json!({"x":0.5,"y":0.5})
                };
                instances.push(json!({"id":format!("i{}",instances.len()+1),"panelId":id,"characterId":i["characterId"],"prompt":format!("panel {number}, {}",s(i,"prompt")),"negativePrompt":s(i,"negativePrompt"),"center":center}));
            }
            for d in array(&p["dialogues"]) {
                let txt = d.as_str().or(d["text"].as_str()).unwrap_or("");
                if !txt.trim().is_empty() {
                    dialogues.push(json!({"id":format!("d{}",dialogues.len()+1),"order":dialogues.len()+1,"panelId":id,"speakerId":d["speakerId"],"text":txt,"type":d["type"].as_str().unwrap_or("speech"),"direction":d["direction"].as_str().unwrap_or("horizontal")}));
                }
            }
        }
        if instances.len() > 22 {
            return Err(Fault::bad("The plan exceeds 22 character slots per image."));
        }
        sections.push(json!({"id":expected["id"],"width":expected["width"],"height":expected["height"],"globalPrompt":([s(extracted,"visualStyle"),s(sec,"globalPrompt")].into_iter().filter(|s|!s.is_empty()).collect::<Vec<_>>().join(", ")),"negativePrompt":s(sec,"negativePrompt"),"panels":panels,"instances":instances,"dialogues":dialogues,"useCoords":true}));
    }
    if sections.is_empty() {
        return Err(Fault::bad("No comic sections were returned."));
    }
    Ok(
        json!({"version":1,"summary":s(draft,"summary"),"characters":array(&extracted["characters"]),"sections":sections}),
    )
}
pub async fn route(
    c: &Shared,
    owner: &str,
    sess: Option<&Session>,
    method: &str,
    op: &str,
    b: &V,
) -> Res<V> {
    let cfg = config(c)?;
    match (op, method) {
        ("llm-settings", "GET") => return view(c, owner, cfg),
        ("llm-settings", "PUT") => return save(c, owner, b),
        _ => {}
    }
    let sess = sess.ok_or_else(|| Fault(401, "AUTH_REQUIRED".into(), "Sign in first.".into()))?;
    let p = select(&cfg, b["providerId"].as_str())?;
    let st = &p["settings"];
    let pick = |key: &str, default: &str| {
        st[key]
            .as_str()
            .filter(|s| !s.is_empty())
            .or(st["model"].as_str().filter(|s| !s.is_empty()))
            .unwrap_or(default)
            .to_owned()
    };
    if op == "llm-test" && method == "POST" {
        if st["provider"] == "novelai" {
            return Err(Fault::bad("Choose a custom provider."));
        }
        let v=complete(c,owner,sess,p,&pick("formatModel",""),"Return exactly {\"ok\":true}.",&json!({"ok":true}),Some(&json!({"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}))).await?;
        if decode(&v)? != json!({"ok":true}) {
            return Err(Fault::bad("Invalid test response."));
        }
        return Ok(json!({"success":true}));
    }
    if op != "plan" || method != "POST" {
        return Err(Fault::missing());
    }
    field(b, "text", 200000)?;
    let sections = array(&b["sections"]);
    if !(1..=2).contains(&sections.len())
        || sections.iter().any(|s| {
            !matches!(
                (s["width"].as_u64(), s["height"].as_u64()),
                (Some(832), Some(1216)) | (Some(1216), Some(832))
            )
        })
    {
        return Err(Fault::bad("Invalid comic section dimensions."));
    }
    let opus = sess.snapshot["subscription"]["tier"].as_i64().unwrap_or(0) >= 3
        && sess.snapshot["subscription"]["active"] == true;
    let story = pick(
        "storyModel",
        b["model"]
            .as_str()
            .unwrap_or(if opus { "xialong-v1" } else { "glm-4-6" }),
    );
    if st["provider"] == "novelai"
        && (!matches!(story.as_str(), "xialong-v1" | "glm-4-6") || story == "xialong-v1" && !opus)
    {
        return Err(Fault::bad(
            "The story model is unavailable for this subscription.",
        ));
    }
    let prompts: V = serde_json::from_str(include_str!("../resources/comic-prompts.json"))?;
    let schemas: V = serde_json::from_str(include_str!("../resources/comic-schema.json"))?;
    let mut input = json!({"originalInput":b,"sections":sections,"readingDirection":b["readingDirection"],"dialogueLanguage":b["language"],"visualLanguage":"English","coordinateSpace":"page"});
    input["storyDraft"] = json!(
        complete(
            c,
            owner,
            sess,
            p,
            &story,
            s(&prompts, "STORY_SYSTEM_PROMPT"),
            &input,
            None
        )
        .await?
    );
    let extracted = decode(
        &complete(
            c,
            owner,
            sess,
            p,
            &pick("extractModel", "glm-4-6"),
            s(&prompts, "EXTRACT_SYSTEM_PROMPT"),
            &input,
            Some(&schemas["extract"]),
        )
        .await?,
    )?;
    input["characters"] = extracted["characters"].clone();
    input["visualStyle"] = extracted["visualStyle"].clone();
    let draft = decode(
        &complete(
            c,
            owner,
            sess,
            p,
            &pick("formatModel", "glm-4-6"),
            &s(&prompts, "SYSTEM_PROMPT").replace(
                "DIALOGUE_SCHEMA",
                "{\"text\":\"dialogue\",\"speakerId\":\"c1\"}",
            ),
            &input,
            Some(&schemas["format"]),
        )
        .await?,
    )?;
    Ok(json!({"plan":compile(&draft,&extracted,b)?,"correlation_id":id()}))
}
