use crate::{inference::*, service::*};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, Rgba, RgbaImage};
use serde_json::{json, Value as V};
use std::{
    collections::{HashMap, VecDeque},
    io::Cursor,
    sync::Mutex,
};
use tauri::Manager;
type Loaded = (String, String, String, V);
#[derive(Default)]
pub struct Jobs {
    rows: Mutex<VecDeque<(String, V)>>,
    loaded: Mutex<Option<Loaded>>,
    cancel: Mutex<HashMap<String, tokio_util::sync::CancellationToken>>,
}
impl Jobs {
    pub fn is_busy(&self) -> bool {
        self.cancel.lock().map_or(true, |tasks| !tasks.is_empty())
    }
}
fn fault(e: String) -> Fault {
    Fault(400, "LOCAL_INFERENCE_ERROR".into(), e)
}
fn patch(c: &Core, k: &str, values: V) {
    if let Some((_, v)) = c
        .tasks
        .rows
        .lock()
        .unwrap()
        .iter_mut()
        .find(|(_, v)| v["id"] == k)
    {
        v.as_object_mut()
            .unwrap()
            .extend(values.as_object().unwrap().clone());
    }
}
pub fn progress(c: &Core, k: &str, stage: &str, n: u64, total: u64) {
    patch(c, k, json!({"stage":stage,"completed":n,"total":total}))
}
fn models() -> Vec<V> {
    serde_json::from_str(include_str!("../resources/models.json")).unwrap()
}
pub async fn route(c: &Shared, owner: &str, method: &str, p: &[&str], b: &V) -> Res<V> {
    let app = c.app.get().ok_or_else(Fault::unsupported)?;
    let latest = |key: Option<&str>| {
        c.tasks
            .rows
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(o, v)| o == owner && key.is_none_or(|k| v["id"] == k))
            .map(|(_, v)| v.clone())
    };
    match (p, method) {
        ([], "GET") => {
            let mut models = models();
            let loaded = c.tasks.loaded.lock().unwrap().clone();
            for m in &mut models {
                m["cached"] = json!(inference_model_status(app.clone(), s(m, "id").into())
                    .await
                    .map_err(fault)?
                    .is_some());
                m["loaded"] = json!(loaded.as_ref().is_some_and(|(_, id, ..)| m["id"] == *id));
            }
            Ok(
                json!({"models":models,"models_dir":c.root.join("models"),"runtime":{"available":true,"version":"1.24.4","providers":["CPUExecutionProvider","DmlExecutionProvider"]},"device":loaded.map(|(_,_,d,_)|d).unwrap_or("auto".into()),"busy":!c.tasks.cancel.lock().unwrap().is_empty(),"job":latest(None)}),
            )
        }
        (["jobs", k], "GET") => latest(Some(k)).ok_or_else(Fault::missing),
        (["jobs", k, "cancel"], "POST") => {
            let v = latest(Some(k)).ok_or_else(Fault::missing)?;
            if let Some(t) = c.tasks.cancel.lock().unwrap().get(*k) {
                t.cancel();
                inference_cancel(app.state(), k.to_string());
            }
            Ok(v)
        }
        (["release"], "POST") => {
            if !c.tasks.cancel.lock().unwrap().is_empty() {
                return Err(Fault::bad("A job is running."));
            }
            if let Some((sid, _, _, _)) = c.tasks.loaded.lock().unwrap().take() {
                inference_close(app.state(), sid)
            }
            lettering::release(app.state());
            Ok(json!({"released":true}))
        }
        (["jobs"], "POST") => {
            let m = models()
                .into_iter()
                .find(|m| m["id"] == b["model_id"])
                .ok_or_else(|| Fault::bad("Unknown model."))?;
            let a = s(b, "action");
            if !matches!(a, "download" | "load") && a != s(&m, "kind") {
                return Err(Fault::bad("Invalid model operation."));
            }
            let dev = b["device"].as_str().unwrap_or("auto");
            if !matches!(dev, "auto" | "cpu" | "directml") {
                return Err(Fault::bad("Unsupported device."));
            }
            let scale = b["scale"].as_u64().unwrap_or(4);
            if !(2..=4).contains(&scale) {
                return Err(Fault::bad("Invalid scale."));
            }
            let key = id();
            let token = tokio_util::sync::CancellationToken::new();
            {
                let mut active = c.tasks.cancel.lock().unwrap();
                if !active.is_empty() {
                    return Err(Fault(
                        409,
                        "LOCAL_INFERENCE_BUSY".into(),
                        "An inference job is running.".into(),
                    ));
                }
                active.insert(key.clone(), token.clone());
            }
            let v = json!({"id":key,"model_id":m["id"],"kind":m["kind"],"action":a,"status":"running","stage":"queued","completed":0,"total":0});
            {
                let mut rows = c.tasks.rows.lock().unwrap();
                if rows.len() >= 12 {
                    rows.pop_front();
                }
                rows.push_back((owner.to_string(), v.clone()));
            }
            let core = c.clone();
            let b = b.clone();
            tokio::spawn(async move {
                let r = run(&core, &key, &m, &b, &token).await;
                let patch_v = match r {
                    Ok(v) => json!({"status":"completed","stage":"completed","result":v}),
                    Err(_) if token.is_cancelled() => {
                        json!({"status":"cancelled","stage":"cancelled"})
                    }
                    Err(e) => json!({"status":"failed","stage":"failed","error":e,"error_code":e}),
                };
                patch(&core, &key, patch_v);
                core.tasks.cancel.lock().unwrap().remove(&key);
            });
            Ok(v)
        }
        _ => Err(Fault::missing()),
    }
}
async fn tensor(
    app: &tauri::AppHandle,
    sid: &str,
    k: &str,
    input: &str,
    shape: Vec<i64>,
    values: Vec<f32>,
) -> Result<(Vec<usize>, Vec<f32>), String> {
    let bytes = values.iter().flat_map(|v| v.to_le_bytes()).collect();
    let raw = tensor_run(
        app.state(),
        sid.into(),
        k.into(),
        input.into(),
        shape,
        bytes,
    )
    .await?;
    let n = u32::from_le_bytes(raw[..4].try_into().unwrap()) as usize;
    let meta: V = serde_json::from_slice(&raw[4..4 + n]).map_err(|e| e.to_string())?;
    let first = &meta[0];
    let dims = first["dims"]
        .as_array()
        .ok_or("Invalid output shape")?
        .iter()
        .map(|s| s.as_u64().unwrap_or(0) as usize)
        .collect::<Vec<_>>();
    let off = 4 + n + first["offset"].as_u64().unwrap_or(0) as usize;
    let len = first["length"].as_u64().unwrap_or(0) as usize;
    let out = raw
        .get(off..off + len * 4)
        .ok_or("Invalid output")?
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect::<Vec<_>>();
    if out.iter().any(|v| !v.is_finite()) {
        return Err("Invalid model output".into());
    }
    Ok((dims, out))
}
async fn run(
    c: &Shared,
    k: &str,
    m: &V,
    b: &V,
    t: &tokio_util::sync::CancellationToken,
) -> Result<V, String> {
    let app = c.app.get().unwrap();
    let mid = s(m, "id").to_owned();
    let act = s(b, "action");
    let dev = b["device"].as_str().unwrap_or("auto");
    let check = || {
        if t.is_cancelled() {
            Err("INFERENCE_CANCELLED".to_string())
        } else {
            Ok(())
        }
    };
    if inference_model_status(app.clone(), mid.clone())
        .await?
        .is_none()
    {
        inference_model_download(app.clone(), app.state(), mid.clone(), k.into()).await?;
    }
    check()?;
    if act == "download" {
        return Ok(json!({"downloaded":true}));
    }
    let loaded = c.tasks.loaded.lock().unwrap().clone();
    if mid == "comic-lettering" {
        if let Some((sid, _, _, _)) = loaded {
            inference_close(app.state(), sid);
        }
        let result =
            lettering::job(c.clone(), app.clone(), k.to_string(), b.clone(), t.clone()).await?;
        *c.tasks.loaded.lock().unwrap() = Some((String::new(), mid, "cpu".into(), V::Null));
        return Ok(result);
    }
    lettering::release(app.state());
    let (sid, info) = match loaded {
        Some((sid, id, d, info)) if id == mid && d == dev => (sid, info),
        old => {
            if let Some((sid, ..)) = old {
                inference_close(app.state(), sid);
                *c.tasks.loaded.lock().unwrap() = None;
            }
            let sid = uuid::Uuid::new_v4().to_string();
            let info = inference_open(
                app.clone(),
                app.state(),
                mid.clone(),
                sid.clone(),
                k.to_owned(),
                dev != "cpu",
            )
            .await?;
            *c.tasks.loaded.lock().unwrap() =
                Some((sid.clone(), mid.clone(), dev.into(), info.clone()));
            (sid, info)
        }
    };
    patch(c, k, json!({"provider":info["backend"]}));
    if act == "load" {
        return Ok(json!({"loaded":true,"backend":info["backend"]}));
    }
    let raw = s(b, "image");
    let raw = STANDARD
        .decode(raw.split_once(',').map(|(_, d)| d).unwrap_or(raw))
        .map_err(|_| "Invalid image")?;
    if raw.len() > 30 * 1024 * 1024 {
        return Err("Image too large".into());
    }
    let reader = image::ImageReader::new(Cursor::new(&raw))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let (w, h) = reader.into_dimensions().map_err(|e| e.to_string())?;
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 32_000_000 {
        return Err("Image too large".into());
    }
    let img = image::load_from_memory(&raw)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    let input = info["inputNames"][0].as_str().ok_or("No model input")?;
    if act == "tagger" {
        let size = m["inputSize"].as_u64().unwrap() as u32;
        let wd = m["inputLayout"] == "NHWC";
        let mut white = RgbaImage::from_pixel(w, h, Rgba([255, 255, 255, 255]));
        image::imageops::overlay(&mut white, &img, 0, 0);
        let ratio = size as f64 / (w.max(h) as f64);
        let resized = image::imageops::resize(
            &white,
            ((w as f64 * ratio).round() as u32).max(1),
            ((h as f64 * ratio).round() as u32).max(1),
            FilterType::CatmullRom,
        );
        let mut boximg = RgbaImage::from_pixel(
            size,
            size,
            if wd {
                Rgba([255, 255, 255, 255])
            } else {
                Rgba([0, 0, 0, 255])
            },
        );
        image::imageops::overlay(
            &mut boximg,
            &resized,
            ((size - resized.width()) / 2) as i64,
            ((size - resized.height()) / 2) as i64,
        );
        let n = (size * size) as usize;
        let mut data = vec![0.; 3 * n];
        for (i, p) in boximg.pixels().enumerate() {
            for ch in 0..3 {
                if wd {
                    data[i * 3 + ch] = p[2 - ch] as f32
                } else {
                    data[n * ch + i] = p[ch] as f32 / 127.5 - 1.
                }
            }
        }
        let size = size as i64;
        check()?;
        let (_, out) = tensor(
            app,
            &sid,
            k,
            input,
            if wd {
                vec![1, size, size, 3]
            } else {
                vec![1, 3, size, size]
            },
            data,
        )
        .await?;
        let labels = info["labels"]
            .as_str()
            .ok_or("No labels")?
            .trim_start_matches('\u{feff}');
        let mut csv = csv::Reader::from_reader(labels.as_bytes());
        let header = csv.headers().map_err(|e| e.to_string())?.clone();
        let name = header
            .iter()
            .position(|v| v == "name")
            .ok_or("Invalid labels")?;
        let cat = header
            .iter()
            .position(|v| v == "category")
            .ok_or("Invalid labels")?;
        let rows = csv
            .records()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if rows.len() != out.len() {
            return Err("LOCAL_MODEL_LABELS_MISMATCH".into());
        }
        let mut tags = vec![];
        for (row, x) in rows.iter().zip(out) {
            let group = match row.get(cat) {
                Some("0") => "general",
                Some("1") => "style",
                Some("3") => "copyright",
                Some("4") => "character",
                Some("5") => "meta",
                _ => continue,
            };
            let threshold = b[format!("{group}_threshold")]
                .as_f64()
                .or(m["defaultThresholds"][group].as_f64())
                .unwrap_or(0.35);
            if f64::from(x) > threshold {
                tags.push(json!({"tag":row.get(name).unwrap_or("").replace('_'," "),"category":group,"confidence":x}))
            }
        }
        tags.sort_by(|a, b| {
            b["confidence"]
                .as_f64()
                .partial_cmp(&a["confidence"].as_f64())
                .unwrap()
        });
        return Ok(
            json!({"text":tags.iter().map(|v|s(v,"tag")).collect::<Vec<_>>().join(", "),"tags":tags}),
        );
    }
    let scale = b["scale"].as_u64().unwrap_or(4) as u32;
    if u64::from(w) * u64::from(h) * 16 > 32_000_000 || w.max(h) > 4096 {
        return Err("LOCAL_UPSCALE_SIZE".into());
    }
    let size = m["tileSize"].as_u64().unwrap() as usize;
    let ctx = m["tileContext"].as_u64().unwrap() as usize;
    let off = m["outputOffset"].as_u64().unwrap_or(0) as usize;
    let core = size - ctx * 2;
    let (w, h) = (w as usize, h as usize);
    let mut dst = RgbaImage::new((w * 4) as u32, (h * 4) as u32);
    let alpha = image::imageops::resize(&img, (w * 4) as u32, (h * 4) as u32, FilterType::Triangle);
    let mut done = 0;
    let total = w.div_ceil(core) * h.div_ceil(core);
    for top in (0..h).step_by(core) {
        for left in (0..w).step_by(core) {
            check()?;
            let mut data = vec![0.; 3 * size * size];
            for y in 0..size {
                for x in 0..size {
                    let yy = (top + y).saturating_sub(ctx).min(h - 1);
                    let xx = (left + x).saturating_sub(ctx).min(w - 1);
                    let p = img.get_pixel(xx as u32, yy as u32);
                    for ch in 0..3 {
                        data[ch * size * size + y * size + x] = p[ch] as f32 / 255.;
                    }
                }
            }
            let (dims, v) = tensor(
                app,
                &sid,
                k,
                input,
                vec![1, 3, size as i64, size as i64],
                data,
            )
            .await?;
            let side = size * 4 - 2 * off;
            if dims != [1, 3, side, side] {
                return Err("LOCAL_UPSCALE_OUTPUT".into());
            }
            for y in 0..core.min(h - top) * 4 {
                for x in 0..core.min(w - left) * 4 {
                    let j = (ctx * 4 - off + y) * side + ctx * 4 - off + x;
                    let rgb =
                        |ch: usize| (v[ch * side * side + j].clamp(0., 1.) * 255.).round() as u8;
                    let (xx, yy) = ((left * 4 + x) as u32, (top * 4 + y) as u32);
                    dst.put_pixel(
                        xx,
                        yy,
                        Rgba([rgb(0), rgb(1), rgb(2), alpha.get_pixel(xx, yy)[3]]),
                    )
                }
            }
            done += 1;
            progress(c, k, "inference", done, total as u64);
        }
    }
    check()?;
    let dst = if scale == 4 {
        dst
    } else {
        image::imageops::resize(
            &dst,
            w as u32 * scale,
            h as u32 * scale,
            FilterType::Lanczos3,
        )
    };
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(dst)
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    check()?;
    let v=crate::library::import(c,&c.db.lock().unwrap(),"outputs",&format!("upscale_{k}.png"),buf.get_ref(),&json!({"parameters":{"image_tool":"local-upscale","local_upscale_model":mid,"local_upscale_factor":scale}})).map_err(|e|e.2)?;
    Ok(json!({"image":v}))
}
