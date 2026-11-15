use crate::service::*;
use rusqlite::Connection;
use serde_json::{json, Value as V};
pub fn editor(v: &V) -> Res<V> {
    let fail = || {
        Fault(
            400,
            "VERSION_EDITOR_INVALID".into(),
            "Invalid version editor state.".into(),
        )
    };
    let mut v = v.clone();
    if v.as_object()
        .is_some_and(|m| m.len() == 1 && m.contains_key("characterTabs"))
    {
        v = json!({"parameterState":{"characterTabs":v["characterTabs"]}});
    }
    let st = &v["parameterState"];
    if !v.as_object().is_some_and(|m| {
        m.keys().all(|k| {
            matches!(
                k.as_str(),
                "parameterState" | "vibeImages" | "positivePrompt" | "negativePrompt"
            )
        })
    }) || !st.as_object().is_some_and(|m| {
        m.keys().all(|k| {
            matches!(
                k.as_str(),
                "params"
                    | "characterTabs"
                    | "referenceImages"
                    | "imagePreview"
                    | "editedImageData"
                    | "directorToolParams"
                    | "restoredMask"
            )
        })
    }) {
        return Err(fail());
    }
    for a in [
        st.get("characterTabs"),
        st.get("referenceImages"),
        v.get("vibeImages"),
    ]
    .into_iter()
    .flatten()
    {
        if !a.as_array().is_some_and(|a| a.iter().all(V::is_object)) {
            return Err(fail());
        }
    }
    if st.get("params").is_some_and(|v| !v.is_object())
        || ["directorToolParams", "restoredMask"]
            .iter()
            .any(|k| !st[k].is_null() && !st[k].is_object())
        || ["imagePreview", "editedImageData"]
            .iter()
            .any(|k| !st[k].is_null() && !st[k].is_string())
        || ["positivePrompt", "negativePrompt"]
            .iter()
            .any(|k| v.get(k).is_some_and(|v| !v.is_string()))
    {
        return Err(fail());
    }
    Ok(v)
}
pub fn safe(v: &V) -> Res<V> {
    fn clean(v: &mut V) {
        match v {
            V::Object(m) => {
                m.retain(|k, _| {
                    let k = k.to_ascii_lowercase().replace(['_', '-'], "");
                    ![
                        "token",
                        "secret",
                        "password",
                        "authorization",
                        "cookie",
                        "apikey",
                        "accesskey",
                    ]
                    .iter()
                    .any(|s| k.contains(s))
                });
                for v in m.values_mut() {
                    clean(v)
                }
            }
            V::Array(a) => a.iter_mut().for_each(clean),
            _ => {}
        }
    }
    let mut val = v.clone();
    let keys = val
        .as_object_mut()
        .ok_or_else(|| Fault::bad("Invalid version parameters."))?;
    keys.retain(|k, _| FIELDS.split_whitespace().any(|x| x == k));
    if let Some(v) = keys.get_mut("editor_state") {
        *v = editor(v)?
    }
    for (old, new) in [
        ("scale", "guidanceScale"),
        ("cfg_rescale", "promptGuidanceRescale"),
        ("noise_schedule", "noiseSchedule"),
        ("sm", "smea"),
        ("sm_dyn", "dyn"),
        ("prompt", "positivePrompt"),
        ("uc", "negativePrompt"),
        ("characterPrompts", "characterTabs"),
    ] {
        if !keys.contains_key(new) {
            if let Some(v) = keys.get(old).cloned() {
                keys.insert(new.into(), v);
            }
        }
    }
    clean(&mut val);
    Ok(val)
}
pub fn context(db: &Connection, b: &V) -> Res<V> {
    let ctx = &b["version_context"];
    if ctx.is_null() {
        return Ok(V::Null);
    }
    let work = field(ctx, "work_id", 128)?;
    if ctx
        .as_object()
        .is_none_or(|m| m.len() != 2 || !m.contains_key("parent_version_id"))
    {
        return Err(Fault::bad("Invalid version context."));
    }
    let w = get(db, "work", &work)?;
    let parent = if ctx["parent_version_id"].is_null() {
        w["latest_version_id"].clone()
    } else {
        json!(field(ctx, "parent_version_id", 128)?)
    };
    if let Some(k) = parent.as_str() {
        if get(db, "version", k)?["work_id"] != work {
            return Err(Fault::bad("Version belongs to another work."));
        }
    }
    if !b["version_editor"].is_null() {
        editor(&b["version_editor"])?;
    }
    Ok(json!({"work_id":work,"parent_version_id":parent}))
}
const FIELDS:&str="
positivePrompt negativePrompt prompt input uc negative_prompt width height steps guidanceScale
scale seed model sampler noiseSchedule noise_schedule promptGuidanceRescale cfg_rescale smea
dyn sm sm_dyn autoSmea strength noise upscaled_enhance image_tool upscale_amount
local_upscale_model local_upscale_factor characterTabs characterPrompts characterControl
v4_prompt v4_negative_prompt v4_prompt_char_captions v4_negative_prompt_char_captions
use_coords use_order ucPresetId qualityPresetId variety decrisp legacy legacy_uc legacy_v3_extend
prefer_brownian deliberate_euler_ancestral_bug image mask action inpaint_strength
disabled_original_image color_correct req_type defry imageToImage vibeTransfer
reference_image reference_strength reference_information_extracted reference_image_multiple
reference_strength_multiple reference_information_extracted_multiple use_v4_vibe
director_reference_images_cached director_reference_images director_reference_descriptions
director_reference_strength_values director_reference_secondary_strength_values
director_reference_information_extracted tag_hint_transparent_background use_upscale_credits source_width source_height
editor_state
";
fn blueprint() -> V {
    json!({"positions":{},"edge_notes":{},"hidden_node_ids":[],"groups":[]})
}
fn commit(db: &Connection, work: &mut V, b: &V) -> Res<V> {
    let key = s(work, "id").to_owned();
    let number = work["version_count"].as_u64().unwrap_or(0) + 1;
    let find = |p: &str| -> Res<V> {
        let v = get(db, "version", p)?;
        if v["work_id"] != key {
            return Err(Fault::bad("Version belongs to another work."));
        }
        Ok(v)
    };
    let parent = if number > 1 {
        Some(find(&field(b, "parent_id", 128)?)?)
    } else {
        None
    };
    let op = b["operation"].as_str().unwrap_or("commit");
    let msg = b["message"].as_str().unwrap_or("");
    if op.len() > 50 || msg.chars().count() > 2000 {
        return Err(Fault::bad("Invalid version message or operation."));
    }
    let restore = if op == "restore" {
        Some(find(
            b["restore_version_id"]
                .as_str()
                .or(b["parent_id"].as_str())
                .unwrap_or(""),
        )?)
    } else {
        None
    };
    let mut images = vec![];
    if let Some(r) = &restore {
        images = r["images"].as_array().cloned().unwrap_or_default()
    } else if let Some(ids) = b["image_ids"].as_array() {
        if ids.len() > 30 {
            return Err(Fault::bad("Too many images."));
        }
        for k in ids {
            let mut item = get(db, "image", k.as_str().unwrap_or(""))?;
            if !item["trashed_at"].is_null() {
                return Err(Fault::bad("Image is in trash."));
            }
            let hash = s(&item, "digest").to_owned();
            put(db, "asset", &hash, &item)?;
            item["asset_id"] = json!(hash);
            item["available"] = json!(true);
            item["gallery_available"] = json!(true);
            item["url"] = json!(format!("/api/local/versions/assets/{hash}"));
            item["thumbnail_url"] = json!(format!("/api/local/versions/assets/{hash}/thumbnail"));
            images.push(item);
        }
    }
    let params = restore
        .as_ref()
        .map(|v| &v["parameters"])
        .or(b.get("parameters"))
        .or(parent.as_ref().map(|p| &p["parameters"]))
        .or(images.first().map(|v| &v["parameters"]))
        .cloned()
        .unwrap_or(json!({}));
    if !params.is_object() || params.to_string().len() > 64 * 1024 * 1024 {
        return Err(Fault::bad("Invalid version parameters."));
    }
    if number == 1 && images.is_empty() {
        return Err(Fault::bad("The first version requires an image."));
    }
    let params = safe(&params)?;
    let vid = id();
    let v = json!({"id":vid,"work_id":key,"parent_id":parent.map(|v|v["id"].clone()),"created_at":now(),"number":number,"operation":op,"message":msg,"parameters":params,"images":images});
    put(db, "version", &vid, &v)?;
    work["version_count"] = json!(number);
    work["latest_version_id"] = json!(vid);
    work["updated_at"] = json!(now());
    if let Some(image) = images.first() {
        work["thumbnail_url"] = image["thumbnail_url"].clone()
    }
    put(db, "work", &key, work)?;
    Ok(v)
}
pub fn handle(db: &Connection, m: &str, p: &[&str], b: &V) -> Res<V> {
    Ok(match (p, m) {
        (["works"], "GET") => {
            let mut works = all(db, "work")?;
            works.sort_by(|a, b| s(b, "updated_at").cmp(s(a, "updated_at")));
            json!({"works":works})
        }
        (["works"], "POST") => {
            let title = field(b, "title", 200)?;
            let k = id();
            let mut w = json!({"id":k,"title":title,"created_at":now(),"updated_at":now(),"version_count":0,"latest_version_id":null,"thumbnail_url":null});
            put(db, "work", &k, &w)?;
            let v = if b["image_ids"].as_array().is_some_and(|v| !v.is_empty()) {
                commit(db, &mut w, b)?
            } else {
                V::Null
            };
            json!({"work":w,"version":v})
        }
        (["works", "batch-delete"], "POST") => {
            let ids = b["ids"]
                .as_array()
                .ok_or_else(|| Fault::bad("Select works."))?;
            for k in ids {
                let key = k.as_str().ok_or_else(|| Fault::bad("Invalid ID."))?;
                get(db, "work", key)?;
                for v in all(db, "version")?.iter().filter(|v| v["work_id"] == key) {
                    del(db, "version", s(v, "id"))?;
                }
                del(db, "blueprint", key)?;
                del(db, "work", key)?;
            }
            json!({"deleted_ids":ids,"cleanup_failed":[]})
        }
        (["works", k], "GET") => {
            json!({"work":get(db,"work",k)?,"versions":all(db,"version")?.into_iter().filter(|v|v["work_id"]==*k).collect::<Vec<_>>(),"blueprint":load(db,"blueprint",k)?.unwrap_or_else(blueprint)})
        }
        (["works", k], "PATCH") => {
            let mut w = get(db, "work", k)?;
            w["title"] = json!(field(b, "title", 200)?);
            put(db, "work", k, &w)?;
            json!({"work":w})
        }
        (["works", k, "versions"], "POST") => {
            let mut w = get(db, "work", k)?;
            let v = commit(db, &mut w, b)?;
            json!({"work":w,"version":v})
        }
        (["works", k, "versions", v], "GET" | "PATCH") => {
            let mut ver = get(db, "version", v)?;
            if ver["work_id"] != *k {
                return Err(Fault::missing());
            }
            if m == "PATCH" {
                let msg = b["message"]
                    .as_str()
                    .filter(|x| x.chars().count() <= 2000)
                    .ok_or_else(|| Fault::bad("Invalid message."))?;
                ver["message"] = json!(msg);
                put(db, "version", v, &ver)?;
            }
            json!({"work":get(db,"work",k)?,"version":ver})
        }
        (["works", k, "blueprint"], "PATCH") => {
            get(db, "work", k)?;
            if !b["positions"].is_object()
                || !b["edge_notes"].is_object()
                || !b["hidden_node_ids"].is_array()
                || !b["groups"].is_array()
            {
                return Err(Fault::bad("Invalid blueprint."));
            }
            for (node, pt) in b["positions"].as_object().unwrap() {
                if get(db, "version", node)?["work_id"] != *k
                    || pt["x"].as_f64().is_none()
                    || pt["y"].as_f64().is_none()
                {
                    return Err(Fault::bad("Invalid blueprint node."));
                }
            }
            put(db, "blueprint", k, b)?;
            json!({"blueprint":b})
        }
        (["gallery", k, "versions"], "GET") => {
            let versions = all(db, "version")?
                .into_iter()
                .filter(|v| {
                    v["images"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|i| i["id"] == *k))
                })
                .collect::<Vec<_>>();
            let works = all(db, "work")?
                .into_iter()
                .filter(|w| versions.iter().any(|v| v["work_id"] == w["id"]))
                .collect::<Vec<_>>();
            json!({"works":works,"versions":versions})
        }
        _ => return Err(Fault::missing()),
    })
}
