use crate::service::*;
use rusqlite::Connection;
use serde_json::{json, Value as V};
use std::collections::{HashMap, HashSet};
fn list(v: &V) -> Res<Vec<V>> {
    v.as_array()
        .cloned()
        .ok_or_else(|| Fault::bad("Expected an array."))
}
fn prepare(mut n: V) -> Res<V> {
    field(&n, "title", 1024)?;
    if n["id"].is_null() {
        n["id"] = json!(id())
    }
    field(&n, "id", 128)?;
    Ok(n)
}
pub fn handle(db: &Connection, m: &str, p: &[&str], b: &V) -> Res<V> {
    let book = load(db, "book", "main")?.unwrap_or(json!({"notes":[],"groups":[]}));
    let (mut notes, mut groups) = (list(&book["notes"])?, list(&book["groups"])?);
    let mut out = V::Null;
    match (p, m) {
        (["notes"], "GET") => return Ok(book),
        (["notes"], "POST") => {
            let mut n = prepare(b["note"].clone())?;
            if n.get("created_at").is_none() {
                n["created_at"] = json!(chrono::Utc::now().timestamp_millis() as f64 / 1000.);
            }
            out = json!({"note":n});
            notes.push(n)
        }
        (["notes"], "PUT") if b["notes"].is_array() => {
            notes = list(&b["notes"])?
                .into_iter()
                .map(prepare)
                .collect::<Res<_>>()?;
            if !b["groups"].is_null() {
                groups = list(&b["groups"])?
            }
        }
        (["notes"], "PUT") => {
            let mut n = b["note"].clone();
            let prev = notes
                .iter_mut()
                .find(|r| {
                    if n["id"].is_string() {
                        r["id"] == n["id"]
                    } else {
                        r["title"] == b.get("original_title").unwrap_or(&n["title"]).clone()
                    }
                })
                .ok_or_else(Fault::missing)?;
            n["id"] = prev["id"].clone();
            *prev = prepare(n)?;
            out = json!({"note":prev})
        }
        (["notes"], "DELETE") => {
            let pos = notes
                .iter()
                .position(|n| {
                    if b["id"].is_string() {
                        n["id"] == b["id"]
                    } else {
                        n["title"] == b["title"]
                    }
                })
                .ok_or_else(Fault::missing)?;
            notes.remove(pos);
            out = json!({"deleted":true})
        }
        (["notes", "batch"], "POST") => {
            let titles = list(&b["titles"])?;
            if titles.is_empty()
                || titles
                    .iter()
                    .any(|t| !notes.iter().any(|n| &n["title"] == t))
            {
                return Err(Fault::missing());
            }
            match s(b, "action") {
                "move" => {
                    for n in notes.iter_mut().filter(|n| titles.contains(&n["title"])) {
                        n["group_id"] = b["group_id"].clone()
                    }
                }
                "delete" => notes.retain(|n| !titles.contains(&n["title"])),
                _ => return Err(Fault::bad("Unknown batch action.")),
            }
        }
        (["notes", "import"], "POST") => {
            let c = &b["content"];
            let incoming = if c.is_array() {
                list(c)?
            } else {
                list(&c["texts"])?
            };
            let mut gs = c["groups"].as_array().cloned().unwrap_or_default();
            let map = gs
                .iter()
                .map(|g| (s(g, "id").to_string(), id()))
                .collect::<HashMap<_, _>>();
            for g in &mut gs {
                g["id"] = json!(map[s(g, "id")]);
                if let Some(p) = g["parent_id"].as_str() {
                    g["parent_id"] =
                        json!(map.get(p).ok_or_else(|| Fault::bad("Invalid parent."))?)
                }
            }
            groups.extend(gs);
            for mut n in incoming {
                n["id"] = json!(id());
                if let Some(p) = n["group_id"].as_str() {
                    n["group_id"] = json!(map.get(p).ok_or_else(|| Fault::bad("Invalid group."))?)
                }
                notes.push(prepare(n)?)
            }
        }
        (["note-groups"], "POST") => {
            groups.push(json!({"id":id(),"name":field(b,"name",128)?,"parent_id":b["parent_id"]}))
        }
        (["note-groups", k], "PUT") => {
            let g = groups
                .iter_mut()
                .find(|x| x["id"] == *k)
                .ok_or_else(Fault::missing)?;
            g["name"] = json!(field(b, "name", 128)?)
        }
        (["note-groups", k], "DELETE") => {
            if !groups.iter().any(|x| x["id"] == *k) {
                return Err(Fault::missing());
            }
            let mut gone = HashSet::from([k.to_string()]);
            for _ in 0..3 {
                let xs = groups
                    .iter()
                    .filter(|g| gone.contains(s(g, "parent_id")))
                    .map(|g| s(g, "id").to_string())
                    .collect::<Vec<_>>();
                gone.extend(xs)
            }
            groups.retain(|g| !gone.contains(s(g, "id")));
            for n in &mut notes {
                if gone.contains(s(n, "group_id")) {
                    n["group_id"] = V::Null
                }
            }
        }
        _ => return Err(Fault::missing()),
    }
    let mut seen = HashSet::new();
    let mut keys = HashSet::new();
    for n in &notes {
        if !seen.insert(s(n, "title")) || !keys.insert(s(n, "id")) {
            return Err(Fault(
                409,
                "NOTE_TITLE_EXISTS".into(),
                "This note already exists.".into(),
            ));
        }
        if !n["group_id"].is_null() && !groups.iter().any(|g| g["id"] == n["group_id"]) {
            return Err(Fault::bad("Invalid note group."));
        }
    }
    for g in &groups {
        let mut next = g;
        for depth in 0..=3 {
            if depth == 3 {
                return Err(Fault::bad("Groups support three levels."));
            }
            if next["parent_id"].is_null() {
                break;
            }
            next = groups
                .iter()
                .find(|x| x["id"] == next["parent_id"])
                .ok_or_else(|| Fault::bad("Unknown parent group."))?;
        }
    }
    let book = json!({"notes":notes,"groups":groups});
    put(db, "book", "main", &book)?;
    Ok(if out.is_null() { book } else { out })
}
