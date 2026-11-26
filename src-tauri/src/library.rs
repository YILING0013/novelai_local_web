use crate::service::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use serde_json::{json, Value as V};
use sha2::{Digest, Sha256};
use std::{fs, io::Cursor, path::Path};

pub fn inspect(pic: &image::DynamicImage, bytes: &[u8], format: image::ImageFormat) -> (V, V) {
    let mut meta = json!({});
    if format == image::ImageFormat::Png {
        if let Ok(r) = png::Decoder::new(Cursor::new(bytes)).read_info() {
            for t in &r.info().uncompressed_latin1_text {
                meta[&t.keyword] = json!(t.text)
            }
            for t in &r.info().compressed_latin1_text {
                if let Ok(v) = t.get_text() {
                    meta[&t.keyword] = json!(v)
                }
            }
            for t in &r.info().utf8_text {
                if let Ok(v) = t.get_text() {
                    meta[&t.keyword] = json!(v)
                }
            }
        }
    }
    let document = crate::metadata::read(pic, bytes, &meta);
    (meta, document)
}
pub fn import(
    core: &Core,
    db: &Connection,
    src: &str,
    name: &str,
    bytes: &[u8],
    extra: &V,
) -> Res<V> {
    if !matches!(src, "references" | "outputs") || bytes.len() > 30 * 1024 * 1024 {
        return Err(Fault::bad("Invalid gallery source or image size."));
    }
    let format = image::guess_format(bytes).map_err(|_| Fault::bad("Unrecognized image."))?;
    let reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let (w, h) = reader
        .into_dimensions()
        .map_err(|_| Fault::bad("Invalid image dimensions."))?;
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 40_000_000 {
        return Err(Fault::bad("Image is too large."));
    }
    let pic = image::load_from_memory_with_format(bytes, format)
        .map_err(|_| Fault::bad("Invalid image."))?;
    let key = match extra["restore_id"].as_str() {
        Some(key)
            if key.len() == 72
                && key.starts_with("archive_")
                && key[8..].bytes().all(|c| c.is_ascii_hexdigit()) =>
        {
            key.to_owned()
        }
        Some(_) => return Err(Fault::bad("Invalid archive entry ID.")),
        None => id(),
    };
    let hash = format!("{:x}", Sha256::digest(bytes));
    let objects = core.root.join("objects");
    let blob = objects.join(&hash);
    if !blob.is_file() {
        fs::write(&blob, bytes)?
    }
    let tn = objects.join(format!("{hash}.thumb.png"));
    if !tn.is_file() {
        pic.thumbnail(384, 384)
            .save_with_format(tn, image::ImageFormat::Png)
            .map_err(|e| Fault::bad(&e.to_string()))?
    }
    let filename = Path::new(name)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("image.png")
        .to_owned();
    let (meta, document) = inspect(&pic, bytes, format);
    let (mut params, bindings) = crate::metadata::parameters(&document);
    let paths = bindings.iter().map(|v| &v["path"]).collect::<Vec<_>>();
    if let Some(m) = extra["parameters"].as_object() {
        params.as_object_mut().unwrap().extend(m.clone())
    }
    params["width"] = json!(w);
    params["height"] = json!(h);
    let prompt = extra["prompt"]
        .as_str()
        .or(params["positivePrompt"].as_str())
        .or(params["prompt"].as_str())
        .or(meta["Description"].as_str())
        .unwrap_or("");
    let created_at = extra["created_at"]
        .as_i64()
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|date| date.to_rfc3339())
        .unwrap_or_else(now);
    let updated_at = extra["updated_at"]
        .as_i64()
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|date| date.to_rfc3339())
        .unwrap_or_else(|| created_at.clone());
    let item = json!({"id":key,"digest":hash,"mime_type":format.to_mime_type(),"source":src,"filename":filename,"relative_path":filename,"title":extra["title"].as_str().filter(|s|!s.is_empty()).unwrap_or(&filename),"prompt":prompt,"negative_prompt":extra.get("negative_prompt").or(params.get("negativePrompt")).unwrap_or(&params["uc"]),"style_prompt":extra["style_prompt"],"model":params["model"],"group_id":extra["group_id"],"width":w,"height":h,"byte_size":bytes.len(),"size":bytes.len(),"created_at":created_at,"updated_at":updated_at,"trashed_at":null,"missing":false,"parameters":params,"metadata":meta,"metadata_document":document,"metadata_bindings":bindings,"metadata_shared_paths":paths,"url":format!("/api/local/gallery/{key}/file"),"thumbnail_url":format!("/api/local/gallery/{key}/thumbnail")});
    put(db, "image", &key, &item)?;
    Ok(item)
}
fn ids(body: &V, k: &str, max: usize) -> Res<Vec<String>> {
    let a = body[k]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= max)
        .ok_or_else(|| Fault::bad("Invalid selection."))?;
    a.iter()
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .ok_or_else(|| Fault::bad("Invalid ID."))
        })
        .collect()
}
pub fn handle(core: &Core, method: &str, path: &[&str], q: &Query, b: &V) -> Res<V> {
    let mut conn = core.db.lock().unwrap();
    let db = conn.transaction()?;
    let src = q.get("source").map(String::as_str).unwrap_or("references");
    let v = match (path, method) {
        (["settings"], "GET") => {
            json!({"settings":load(&db,"settings","settings")?.unwrap_or(json!({}))})
        }
        (["settings"], "PUT") => {
            let mut settings = load(&db, "settings", "settings")?.unwrap_or(json!({}));
            settings.as_object_mut().unwrap().extend(
                b["settings"]
                    .as_object()
                    .ok_or_else(|| Fault::bad("settings must be an object."))?
                    .clone(),
            );
            if settings
                .get("outputDirectory")
                .is_some_and(|v| !v.is_string())
                || settings.get("inspirationSource").is_some_and(|v| {
                    !matches!(v.as_str(), Some("default" | "references" | "outputs"))
                })
            {
                return Err(Fault::bad("Invalid local settings."));
            }
            #[cfg(target_os = "android")]
            if settings["outputDirectory"]
                .as_str()
                .is_some_and(|dir| !dir.is_empty())
            {
                return Err(Fault::bad(
                    "Android stores generated images in the app gallery.",
                ));
            }
            #[cfg(not(target_os = "android"))]
            if let Some(dir) = settings["outputDirectory"]
                .as_str()
                .filter(|v| !v.is_empty())
            {
                let p = Path::new(dir);
                if !p.is_absolute() {
                    return Err(Fault::bad("Choose an absolute local directory."));
                }
                fs::create_dir_all(p)?;
                tempfile::NamedTempFile::new_in(p)?;
            }
            put(&db, "settings", "settings", &settings)?;
            json!({"settings":settings})
        }
        (["random-prompts"], "GET" | "PUT") => {
            if method == "PUT" {
                if !b["random_prompts"].is_object() {
                    return Err(Fault::bad("Invalid random prompts."));
                }
                put(&db, "settings", "random", &b["random_prompts"])?
            }
            json!({"random_prompts":load(&db,"settings","random")?.unwrap_or(json!({"categories":[],"collections":[],"enabled":true}))})
        }
        #[cfg(not(target_os = "android"))]
        (["directories"], "GET") => {
            let suggested = core.root.join("metadata-exports");
            let dir = q
                .get("path")
                .filter(|x| !x.is_empty())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| suggested.clone());
            if !dir.is_absolute() {
                return Err(Fault::bad("Choose an absolute folder."));
            }
            let mut dirs = vec![];
            if dir.exists() {
                for item in fs::read_dir(&dir)?.flatten().filter(|x| x.path().is_dir()) {
                    dirs.push(json!({"name":item.file_name().to_string_lossy(),"path":item.path()}))
                }
            }
            let roots = (b'A'..=b'Z')
                .map(|c| format!("{}:/", c as char))
                .filter(|p| Path::new(p).is_dir())
                .map(|p| json!({"name":p,"path":p}))
                .collect::<Vec<_>>();
            json!({"path":dir,"parent":dir.parent(),"directories":dirs,"roots":roots,"suggested_export_directory":suggested})
        }
        #[cfg(target_os = "android")]
        (["directories"], "GET") => {
            json!({"path":"","parent":null,"directories":[],"roots":[],"suggested_export_directory":"","use_document_picker":true})
        }
        (["works", "archive-assets"], "POST") => {
            let files = b["files"]
                .as_array()
                .filter(|files| files.len() == 1)
                .ok_or_else(|| Fault::bad("Select one archived image."))?;
            let file = &files[0];
            let data = STANDARD
                .decode(s(file, "data"))
                .map_err(|_| Fault::bad("Invalid image data."))?;
            // 快照使用内容寻址的原图和缩略图，事务结束时不留下普通图库条目。
            let image = import(core, &db, "outputs", s(file, "name"), &data, &json!({}))?;
            let digest = s(&image, "digest");
            put(&db, "asset", digest, &image)?;
            del(&db, "image", s(&image, "id"))?;
            json!({"id": digest})
        }
        (["gallery", "import"], "POST") => {
            if let Some(group) = b["group_id"].as_str().filter(|k| !k.is_empty()) {
                if get(&db, "groups", group)?["source"]
                    != b["source"].as_str().unwrap_or("references")
                {
                    return Err(Fault::bad("Invalid image group."));
                }
            }
            let files = b["files"]
                .as_array()
                .filter(|xs| (1..=30).contains(&xs.len()))
                .ok_or_else(|| Fault::bad("Select image files."))?;
            let mut items = vec![];
            let mut errors = vec![];
            for f in files {
                match STANDARD
                    .decode(s(f, "data"))
                    .map_err(|_| Fault::bad("Invalid base64."))
                    .and_then(|data| {
                        let src = b["source"].as_str().unwrap_or("references");
                        let mut extra = if let Some(entry) = b["archive_entry"].as_str() {
                            serde_json::from_str(entry)
                                .map_err(|_| Fault::bad("Invalid archive entry."))?
                        } else {
                            b.clone()
                        };
                        if !extra.is_object() {
                            return Err(Fault::bad("Invalid archive entry."));
                        }
                        extra["group_id"] = b["group_id"].clone();
                        if let Some(key) = extra["restore_id"].as_str() {
                            if let Some(existing) = load(&db, "image", key)? {
                                if existing["source"] == src
                                    && existing["digest"] == format!("{:x}", Sha256::digest(&data))
                                {
                                    return Ok(existing);
                                }
                                return Err(Fault::bad(
                                    "Archive entry conflicts with an existing image.",
                                ));
                            }
                        }
                        let mut v = import(core, &db, src, s(f, "name"), &data, &extra)?;
                        if let Err(e) = crate::gallery_files::save_new(core, &db, &mut v, &data) {
                            del(&db, "image", s(&v, "id"))?;
                            return Err(e);
                        }
                        Ok(v)
                    }) {
                    Ok(v) => items.push(v),
                    Err(e) => errors.push(json!({"filename":f["name"],"error":e.2})),
                }
            }
            json!({"items":items,"errors":errors})
        }
        (["gallery"], "GET") => {
            let parse = |k: &str, d: usize| -> Res<usize> {
                q.get(k)
                    .map(|s| s.parse().map_err(|_| Fault::bad("Invalid pagination.")))
                    .unwrap_or(Ok(d))
            };
            let offset = parse("offset", 0)?;
            let limit = parse("limit", 60)?;
            if !(1..=120).contains(&limit) || offset % limit != 0 {
                return Err(Fault::bad("Invalid pagination."));
            }
            let errors = if offset == 0 {
                crate::gallery_files::scan(core, &db, src)?
            } else {
                vec![]
            };
            let items = crate::search::images(&db, src, q)?;
            let total = items.len();
            let items = items
                .into_iter()
                .skip(offset)
                .take(limit)
                .collect::<Vec<_>>();
            json!({"items":items,"total":total,"has_more":offset+items.len()<total,"page":offset/limit+1,"page_size":limit,"errors":errors})
        }
        (["gallery", kind @ ("groups" | "collections")], "GET") => {
            let items = all(&db, kind)?
                .into_iter()
                .filter(|v| v["source"] == src)
                .collect::<Vec<_>>();
            json!({(*kind):items})
        }
        (["gallery", kind @ ("groups" | "collections")], "POST") => {
            let key = id();
            let mut v = b.clone();
            v["name"] = json!(field(b, "name", 200)?);
            v["id"] = json!(key);
            v["count"] = json!(0);
            if v["source"].is_null() {
                v["source"] = json!("references")
            }
            put(&db, kind, &key, &v)?;
            if *kind == "groups" {
                v
            } else {
                json!({"collection":v})
            }
        }
        (["gallery", "collections", key], "DELETE") => {
            get(&db, "collections", key)?;
            del(&db, "collections", key)?;
            json!({"deleted":true})
        }
        (["gallery", "batch"], "POST") => {
            let mut out = vec![];
            let mut errors = vec![];
            let mut done = vec![];
            for key in ids(b, "ids", 200)? {
                let result = (|| -> Res<V> {
                    let mut item = get(&db, "image", &key)?;
                    match s(b, "action") {
                        "trash" => {
                            if item["trashed_at"].is_null() {
                                crate::gallery_files::move_file(&db, &item, "trash")?;
                            }
                            item["trashed_at"] = json!(now())
                        }
                        "restore" => {
                            if !item["trashed_at"].is_null() {
                                crate::gallery_files::move_file(&db, &item, "restore")?;
                            }
                            item["trashed_at"] = V::Null
                        }
                        "group" => {
                            if let Some(k) = b["group_id"].as_str().filter(|x| !x.is_empty()) {
                                get(&db, "groups", k)?;
                            }
                            item["group_id"] = b["group_id"].clone()
                        }
                        "delete" if item["trashed_at"].is_string() => {
                            crate::gallery_files::move_file(&db, &item, "delete")?;
                            del(&db, "image", &key)?;
                            return Ok(V::Null);
                        }
                        "export" => {
                            #[cfg(target_os = "android")]
                            let dir = core.root.join("metadata-exports");
                            #[cfg(not(target_os = "android"))]
                            let dir = if let Some(p) =
                                b["output_directory"].as_str().filter(|s| !s.is_empty())
                            {
                                std::path::PathBuf::from(p)
                            } else {
                                core.root.join("metadata-exports")
                            };
                            if !dir.is_absolute() {
                                return Err(Fault::bad("Invalid directory."));
                            }
                            fs::create_dir_all(&dir)?;
                            let p = dir.join(format!("{key}-{}.png", id()));
                            let img = image::load_from_memory(&fs::read(
                                core.root.join("objects").join(s(&item, "digest")),
                            )?)
                            .map_err(|_| Fault::bad("Invalid image."))?;
                            fs::write(
                                &p,
                                crate::metadata::export(&img, &item["metadata_document"], b)?,
                            )?;
                            let name = p.file_name().unwrap().to_string_lossy();
                            #[cfg(target_os = "android")]
                            return Ok(
                                json!({"file_url":format!("/api/local/metadata-exports/{name}"),"filename":name}),
                            );
                            #[cfg(not(target_os = "android"))]
                            return Ok(
                                json!({"saved_path":p,"filename":name,"width":img.width(),"height":img.height()}),
                            );
                        }
                        _ => return Err(Fault::bad("Invalid gallery action.")),
                    }
                    put(&db, "image", &key, &item)?;
                    Ok(item)
                })();
                match result {
                    Ok(v) => {
                        done.push(key);
                        if !v.is_null() {
                            out.push(v)
                        }
                    }
                    Err(e) => errors.push(json!({"id":key,"error":e.2})),
                }
            }
            json!({"items":out,"succeeded":done,"errors":errors})
        }
        (["gallery", key], "GET") => get(&db, "image", key)?,
        (["gallery", key], "PATCH") => {
            let mut item = get(&db, "image", key)?;
            for k in [
                "title",
                "prompt",
                "style_prompt",
                "negative_prompt",
                "group_id",
                "parameters",
            ] {
                if let Some(v) = b.get(k) {
                    item[k] = v.clone();
                }
            }
            item["updated_at"] = json!(now());
            put(&db, "image", key, &item)?;
            item
        }
        ([first, ..], _) if matches!(*first, "works" | "gallery") => {
            crate::works::handle(&db, method, path, b)?
        }
        ([first, ..], _) if matches!(*first, "notes" | "note-groups") => {
            crate::notes::handle(&db, method, path, b)?
        }
        _ => return Err(Fault::unsupported()),
    };
    if method == "POST"
        && (path == ["works", "batch-delete"]
            || path == ["gallery", "batch"] && b["action"] == "delete")
    {
        crate::gallery_files::collect(core, &db)?;
    }
    db.commit()?;
    Ok(v)
}
