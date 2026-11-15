use crate::service::*;
use rusqlite::Connection;
use serde_json::{json, Value as V};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
pub fn root(c: &Core, db: &Connection, source: &str) -> Res<PathBuf> {
    Ok(match source {
        "outputs" => load(db, "settings", "settings")?
            .and_then(|v| {
                v["outputDirectory"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(PathBuf::from)
            })
            .unwrap_or_else(|| c.root.join("outputs")),
        "references" => c.root.join("references"),
        _ => return Err(Fault::bad("Invalid image source.")),
    })
}
fn stamp(p: &Path) -> Res<V> {
    let m = fs::metadata(p)?;
    Ok(json!([
        m.len(),
        m.modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .to_string()
    ]))
}
fn link(db: &Connection, item: &V, root: &Path, rel: &Path) -> Res<()> {
    put(
        db,
        "image-file",
        s(item, "id"),
        &json!({"id":item["id"],"source":item["source"],"root":root,"relative":rel,"stamp":stamp(&root.join(rel))?}),
    )
}
pub fn save_new(c: &Core, db: &Connection, item: &mut V, bytes: &[u8]) -> Res<()> {
    let root = root(c, db, s(item, "source"))?;
    fs::create_dir_all(&root)?;
    let name = Path::new(s(item, "filename"))
        .file_name()
        .ok_or_else(|| Fault::bad("Invalid filename."))?
        .to_string_lossy()
        .to_string();
    let mut rel = PathBuf::from(&name);
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join(&rel))
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            rel = PathBuf::from(format!("{}-{name}", id()));
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(root.join(&rel))?
        }
        Err(e) => return Err(e.into()),
    };
    file.write_all(bytes)?;
    drop(file);
    item["filename"] = json!(rel);
    item["relative_path"] = json!(rel);
    put(db, "image", s(item, "id"), item)?;
    link(db, item, &root, &rel)
}
#[cfg(windows)]
fn redirected(m: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    m.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn redirected(m: &fs::Metadata) -> bool {
    m.is_symlink()
}
pub fn scan(c: &Core, db: &Connection, source: &str) -> Res<Vec<V>> {
    let root = root(c, db, source)?;
    fs::create_dir_all(&root)?;
    let mut old = HashMap::new();
    let mut errors = vec![];
    for f in all(db, "image-file")? {
        if f["source"] != source {
            continue;
        }
        let mut v = get(db, "image", s(&f, "id"))?;
        if v["trashed_at"].is_string() {
            continue;
        }
        if f["root"] != json!(root) {
            if v["missing"] != true {
                v["missing"] = json!(true);
                put(db, "image", s(&v, "id"), &v)?;
            }
            continue;
        }
        old.insert(PathBuf::from(s(&f, "relative")), (f, v));
    }
    let mut stack = vec![root.clone()];
    while let Some(d) = stack.pop() {
        let entries = match fs::read_dir(&d) {
            Ok(v) => v,
            Err(e) => {
                errors.push(json!({"filename":d,"error":e.to_string()}));
                continue;
            }
        };
        for entry in entries {
            let res = (|| -> Res<()> {
                let p = entry?.path();
                let meta = fs::symlink_metadata(&p)?;
                if redirected(&meta) {
                    return Ok(());
                }
                if meta.is_dir() {
                    if p.file_name().is_some_and(|n| n != ".novelai-library") {
                        stack.push(p)
                    }
                    return Ok(());
                }
                if !meta.is_file()
                    || !matches!(
                        p.extension()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_ascii_lowercase()
                            .as_str(),
                        "png" | "jpg" | "jpeg" | "webp" | "bmp"
                    )
                {
                    return Ok(());
                }
                let rel = p
                    .strip_prefix(&root)
                    .map_err(|_| Fault::bad("Invalid gallery path."))?;
                let prev = old.remove(rel);
                let sig = stamp(&p)?;
                if let Some((f, v)) = &prev {
                    if f["stamp"] == sig {
                        if v["missing"] == true {
                            let mut v = v.clone();
                            v["missing"] = json!(false);
                            put(db, "image", s(&v, "id"), &v)?;
                        }
                        return Ok(());
                    }
                }
                if meta.len() > 30 * 1024 * 1024 {
                    return Err(Fault::bad("Image exceeds 30 MiB."));
                }
                let mut item = crate::library::import(
                    c,
                    db,
                    source,
                    &p.file_name().unwrap().to_string_lossy(),
                    &fs::read(&p)?,
                    &V::Null,
                )?;
                if let Some((_, v)) = prev {
                    del(db, "image", s(&item, "id"))?;
                    for key in [
                        "id",
                        "url",
                        "thumbnail_url",
                        "title",
                        "style_prompt",
                        "group_id",
                        "created_at",
                    ] {
                        item[key] = v[key].clone();
                    }
                }
                item["relative_path"] = json!(rel.to_string_lossy().replace('\\', "/"));
                put(db, "image", s(&item, "id"), &item)?;
                link(db, &item, &root, rel)
            })();
            if let Err(e) = res {
                errors.push(json!({"filename":d,"error":e.2}));
            }
        }
    }
    if errors.is_empty() {
        for (_, (_, mut v)) in old {
            if v["missing"] != true {
                v["missing"] = json!(true);
                put(db, "image", s(&v, "id"), &v)?;
            }
        }
    }
    Ok(errors)
}
pub fn move_file(db: &Connection, item: &V, action: &str) -> Res<()> {
    let key = s(item, "id");
    let Some(f) = load(db, "image-file", key)? else {
        return Ok(());
    };
    let base = PathBuf::from(s(&f, "root"));
    let rel = Path::new(s(&f, "relative"));
    let orig = base.join(rel);
    let trash = base.join(".novelai-library").join("trash").join(format!(
        "{key}.{}",
        rel.extension().and_then(|x| x.to_str()).unwrap_or("png")
    ));
    let (src, dest) = match action {
        "trash" => (&orig, Some(&trash)),
        "restore" => (&trash, Some(&orig)),
        "delete" => (&trash, None),
        _ => return Ok(()),
    };
    let verify = |p: &Path| -> Res<()> {
        if !p.canonicalize()?.starts_with(base.canonicalize()?) {
            return Err(Fault::bad("File is outside the gallery."));
        }
        Ok(())
    };
    if src.exists() {
        verify(src)?;
        if fs::metadata(src)?.len() > 30 * 1024 * 1024
            || format!("{:x}", Sha256::digest(fs::read(src)?)) != s(item, "digest")
        {
            return Err(Fault::bad(
                "File changed on disk; refresh before continuing.",
            ));
        }
        if let Some(dest) = dest {
            let parent = dest.parent().ok_or_else(Fault::missing)?;
            let mut ancestor = parent;
            while !ancestor.exists() {
                ancestor = ancestor.parent().ok_or_else(Fault::missing)?;
            }
            verify(ancestor)?;
            fs::create_dir_all(parent)?;
            verify(parent)?;
            if dest.exists() {
                return Err(Fault::bad("The destination already exists."));
            }
            fs::rename(src, dest)?;
        } else {
            fs::remove_file(src)?;
        }
    }
    if action == "delete" {
        del(db, "image-file", key)?;
    }
    Ok(())
}
pub fn collect(c: &Core, db: &Connection) -> Res<()> {
    let versions = all(db, "version")?;
    let images = all(db, "image")?;
    let mut live = std::collections::HashSet::new();
    for item in images {
        live.insert(s(&item, "digest").to_owned());
    }
    let mut assets = std::collections::HashSet::new();
    for v in versions {
        if let Some(imgs) = v["images"].as_array() {
            for img in imgs {
                let d = s(img, "digest").to_owned();
                assets.insert(d.clone());
                live.insert(d);
            }
        }
    }
    for a in all(db, "asset")? {
        let d = s(&a, "digest");
        if !assets.contains(d) {
            del(db, "asset", d)?;
        }
    }
    for p in fs::read_dir(c.root.join("objects"))? {
        let p = p?.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy();
        let d = name.strip_suffix(".thumb.png").unwrap_or(&name);
        if d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit()) && !live.contains(d) {
            fs::remove_file(&p)?;
        }
    }
    Ok(())
}
