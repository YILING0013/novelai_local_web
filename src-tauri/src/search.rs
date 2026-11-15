use crate::service::*;
use rusqlite::Connection;
use serde_json::{json, Value as V};
use std::collections::{HashMap, HashSet};
fn norm(s: &str) -> String {
    s.to_lowercase()
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn tags(s: &str) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    let mut weight = 1.0_f64;
    let mut level = 0i32;
    let mut escaped = false;
    let mut word = String::new();
    let mut it = s.chars().chain([',']).peekable();
    while let Some(c) = it.next() {
        if escaped {
            word.push(c);
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            ',' | '\n' | '\r' => {
                let key = norm(&word);
                if !key.is_empty() {
                    out.insert(key, weight * 1.05_f64.powi(level.clamp(-256, 256)));
                }
                word.clear()
            }
            '{' | ']' => level += 1,
            '}' | '[' => level -= 1,
            ':' if it.peek() == Some(&':') => {
                it.next();
                let suffix = word
                    .trim_end()
                    .rsplit(|x: char| x.is_whitespace())
                    .next()
                    .unwrap_or("");
                if let Ok(n) = suffix.parse::<f64>() {
                    weight = n.clamp(-1e6, 1e6);
                    word.truncate(word.len() - suffix.len())
                } else {
                    weight = 1.
                }
                level = 0
            }
            _ => word.push(c),
        }
    }
    out
}
fn features(v: &V) -> HashMap<String, f64> {
    let mut fs = HashMap::new();
    for (field, ch) in [
        ("prompt", "p"),
        ("style_prompt", "p"),
        ("negative_prompt", "n"),
    ] {
        for (tag, w) in tags(s(v, field)) {
            fs.insert(
                format!("{ch}:{}:{tag}", if w < 0. { "-" } else { "+" }),
                w.abs(),
            );
        }
    }
    fs
}
pub fn images(db: &Connection, source: &str, q: &Query) -> Res<Vec<V>> {
    if !matches!(source, "references" | "outputs") {
        return Err(Fault::bad("Invalid gallery source."));
    }
    let mut f = json!({});
    if let Some(k) = q
        .get("collection_id")
        .or(q.get("collection"))
        .filter(|s| !s.is_empty())
    {
        let c = get(db, "collections", k)?;
        if c["source"] != source {
            return Err(Fault::bad("Collection belongs to another gallery."));
        }
        f = c["filters"].clone();
    }
    if !f.is_object() {
        f = json!({})
    }
    for (k, v) in q {
        if !v.is_empty() && !matches!(v.as_str(), "false" | "newest") {
            f[k] = json!(v)
        }
    }
    let orient = s(&f, "orientation");
    if !matches!(orient, "portrait" | "landscape" | "square" | "") {
        return Err(Fault::bad("Unknown orientation."));
    }
    let ref_fs = if let Some(k) = f["similar_to"].as_str().filter(|k| !k.is_empty()) {
        Some(features(&get(db, "image", k)?))
    } else {
        None
    };
    let positive = tags(s(&f, "tags"));
    let excluded = tags(s(&f, "negative_tags"));
    let min = f["min_similarity"]
        .as_f64()
        .or_else(|| s(&f, "min_similarity").parse().ok())
        .unwrap_or(0.);
    if !(0.0..=1.).contains(&min) {
        return Err(Fault::bad("Invalid similarity."));
    }
    let mut items = vec![];
    for mut v in all(db, "image")? {
        let trash = f["trash"] == true || f["trash"] == "true";
        let group = s(&f, "group");
        if v["source"] != source
            || v["missing"] == true
            || v["trashed_at"].is_string() != trash
            || (!group.is_empty()
                && if group == "__ungrouped" {
                    v["group_id"].is_string()
                } else {
                    v["group_id"] != group
                })
        {
            continue;
        }
        let (w, h) = (
            v["width"].as_u64().unwrap_or(0),
            v["height"].as_u64().unwrap_or(0),
        );
        if orient == "landscape" && w <= h
            || orient == "portrait" && w >= h
            || orient == "square" && w != h
        {
            continue;
        }
        if !s(&f, "model").is_empty()
            && s(&v, "model").to_lowercase() != s(&f, "model").to_lowercase()
        {
            continue;
        }
        let search = norm(s(&f, "q"));
        if ![
            s(&v, "title"),
            s(&v, "filename"),
            s(&v, "prompt"),
            s(&v, "style_prompt"),
        ]
        .iter()
        .any(|x| norm(x).contains(&search))
        {
            continue;
        }
        if !positive.is_empty() || !excluded.is_empty() || ref_fs.is_some() {
            let data = features(&v);
            if !positive
                .keys()
                .all(|t| data.contains_key(&format!("p:+:{t}")))
                || excluded
                    .keys()
                    .any(|t| data.contains_key(&format!("p:+:{t}")))
            {
                continue;
            }
            if let Some(r) = &ref_fs {
                let keys = r.keys().chain(data.keys()).collect::<HashSet<_>>();
                let (mut a, mut b) = (0., 0.);
                for k in keys {
                    let l = *r.get(k).unwrap_or(&0.);
                    let x = *data.get(k).unwrap_or(&0.);
                    a += l.min(x);
                    b += l.max(x)
                }
                let value = if b > 0. { a / b } else { 0. };
                if value < min {
                    continue;
                }
                v["similarity"] = json!(value)
            }
        }
        items.push(v)
    }
    items.sort_by(|a, b| {
        if f["sort"] == "similarity" {
            b["similarity"]
                .as_f64()
                .partial_cmp(&a["similarity"].as_f64())
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(s(b, "created_at").cmp(s(a, "created_at")))
        } else if f["sort"] == "oldest" {
            s(a, "created_at").cmp(s(b, "created_at"))
        } else {
            s(b, "created_at").cmp(s(a, "created_at"))
        }
    });
    Ok(items)
}
