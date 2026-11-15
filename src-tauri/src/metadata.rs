use crate::service::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, RgbaImage};
use serde_json::{json, Value as V};
use std::io::{Cursor, Read, Write};
const MAX: usize = 4 * 1024 * 1024;
fn decoded(v: &str) -> V {
    serde_json::from_str::<V>(v)
        .ok()
        .filter(|x| x.is_object() || x.is_array())
        .unwrap_or_else(|| json!(v))
}
fn stealth(px: &RgbaImage, ch: usize) -> Option<V> {
    let cap = px.as_raw().len() / 4 * ch;
    if cap < 152 {
        return None;
    }
    let (height, mut index) = (px.height() as usize, 0usize);
    let mut byte = || {
        let mut n = 0u8;
        for _ in 0..8 {
            let p = index / ch;
            let component = if ch == 1 { 3 } else { index % 3 };
            n = (n << 1) | (px.get_pixel((p / height) as u32, (p % height) as u32)[component] & 1);
            index += 1;
        }
        n
    };
    let magic = (0..15).map(|_| byte()).collect::<Vec<_>>();
    if magic.as_slice()
        != if ch == 1 {
            b"stealth_pngcomp"
        } else {
            b"stealth_rgbcomp"
        }
        && magic.as_slice()
            != if ch == 1 {
                b"stealth_pnginfo"
            } else {
                b"stealth_rgbinfo"
            }
    {
        return None;
    }
    let bits = u32::from_be_bytes([byte(), byte(), byte(), byte()]) as usize;
    if bits % 8 != 0 || bits == 0 || bits / 8 > MAX || bits + 152 > cap {
        return None;
    }
    let data = (0..bits / 8).map(|_| byte()).collect::<Vec<_>>();
    let raw = if magic.ends_with(b"comp") {
        let mut raw = vec![];
        flate2::read::GzDecoder::new(data.as_slice())
            .take(MAX as u64 + 1)
            .read_to_end(&mut raw)
            .ok()?;
        raw
    } else {
        data
    };
    (raw.len() <= MAX)
        .then(|| String::from_utf8(raw).ok().map(|s| decoded(&s)))
        .flatten()
}
fn write_stealth(px: &mut RgbaImage, ch: usize, v: &V) -> Res<()> {
    let mut gz = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
    gz.write_all(&serde_json::to_vec(v)?)?;
    let data = gz.finish()?;
    let mut buf = if ch == 1 {
        b"stealth_pngcomp".to_vec()
    } else {
        b"stealth_rgbcomp".to_vec()
    };
    buf.extend_from_slice(&((data.len() * 8) as u32).to_be_bytes());
    buf.extend(data);
    if buf.len() * 8 > px.as_raw().len() / 4 * ch {
        return Err(Fault::bad(
            "The image is too small for its embedded metadata.",
        ));
    }
    let h = px.height() as usize;
    for (i, c) in buf.into_iter().enumerate() {
        for bit in 0..8 {
            let index = i * 8 + bit;
            let p = index / ch;
            let component = if ch == 1 { 3 } else { index % 3 };
            let value = &mut px.get_pixel_mut((p / h) as u32, (p % h) as u32)[component];
            *value = (*value & 254) | ((c >> (7 - bit)) & 1);
        }
    }
    Ok(())
}
pub fn read(pic: &DynamicImage, raw: &[u8], texts: &V) -> V {
    let mut doc = json!({});
    if let Some(m) = texts.as_object().filter(|m| !m.is_empty()) {
        let mut png = json!({});
        for (k, v) in m {
            png[k] = v.as_str().map(decoded).unwrap_or_else(|| v.clone())
        }
        doc["png"] = png
    }
    if let Ok(mut reader) = image::ImageReader::new(Cursor::new(raw))
        .with_guessed_format()
        .and_then(|r| r.into_decoder().map_err(std::io::Error::other))
    {
        use image::ImageDecoder;
        if let Ok(Some(exif)) = reader.exif_metadata() {
            doc["exif_raw"] = json!(STANDARD.encode(exif))
        }
    }
    let px = pic.to_rgba8();
    if let Some(v) = stealth(&px, 1) {
        doc["stealth"] = v
    }
    if let Some(v) = stealth(&px, 3) {
        doc["stealth_rgb"] = v
    }
    doc
}
fn aliases(k: &str) -> &str {
    match k {
        "prompt" | "input" | "Description" => "positivePrompt",
        "negative_prompt" | "uc" => "negativePrompt",
        "scale" => "guidanceScale",
        "noise_schedule" => "noiseSchedule",
        "cfg_rescale" => "promptGuidanceRescale",
        "sm" => "smea",
        "sm_dyn" => "dyn",
        "model_name" => "model",
        _ => k,
    }
}
fn scopes(v: &V, path: &mut Vec<String>, out: &mut V, bindings: &mut Vec<V>) {
    if let Some(m) = v.as_object() {
        for (k, v) in m {
            path.push(k.to_owned());
            if matches!(
                k.as_str(),
                "Comment" | "parameters" | "Description" | "metadata" | "JSON" | "UserComment"
            ) && v.is_object()
            {
                scopes(v, path, out, bindings)
            } else {
                out[k] = v.clone();
                let alias = aliases(k);
                if matches!(
                    alias,
                    "positivePrompt"
                        | "negativePrompt"
                        | "guidanceScale"
                        | "noiseSchedule"
                        | "promptGuidanceRescale"
                        | "smea"
                        | "dyn"
                        | "width"
                        | "height"
                        | "steps"
                        | "seed"
                        | "sampler"
                        | "model"
                        | "characterTabs"
                        | "use_coords"
                        | "ucPresetId"
                        | "qualityPresetId"
                ) {
                    out[alias] = v.clone();
                    bindings.push(json!({"path":path,"parameter_path":[alias]}));
                }
            }
            path.pop();
        }
    }
}
pub fn parameters(doc: &V) -> (V, Vec<V>) {
    let mut params = json!({});
    let mut bs = vec![];
    for k in ["png", "stealth", "stealth_rgb"] {
        scopes(&doc[k], &mut vec![k.into()], &mut params, &mut bs)
    }
    (params, bs)
}
pub fn export(pic: &DynamicImage, original: &V, b: &V) -> Res<Vec<u8>> {
    let mut doc = match s(b, "mode") {
        "strip" => json!({}),
        "edit" => b
            .get("template_metadata_document")
            .or(b.get("metadata_document"))
            .unwrap_or(original)
            .clone(),
        _ => return Err(Fault::bad("Choose edit or strip.")),
    };
    if !doc.is_object() {
        return Err(Fault::bad("Invalid metadata document."));
    }
    if s(b, "mode") == "edit" {
        if let Some(changes) = b["parameters"].as_object() {
            let (_, bs) = parameters(&doc);
            for (k, val) in changes {
                let mut bound = false;
                for binding in &bs {
                    if binding["parameter_path"][0] == *k {
                        let mut cur = &mut doc;
                        for key in binding["path"].as_array().unwrap() {
                            cur = &mut cur[key.as_str().unwrap()];
                        }
                        *cur = val.clone();
                        bound = true;
                    }
                }
                if !bound {
                    if !doc["png"].is_object() && !doc["png"].is_null() {
                        return Err(Fault::bad("Invalid PNG metadata."));
                    }
                    if doc["png"]["Comment"].is_object() || doc["png"]["Comment"].is_null() {
                        doc["png"]["Comment"][k] = val.clone()
                    } else {
                        doc["png"][k] = val.clone()
                    }
                }
            }
        }
    }
    let mut px = pic.to_rgba8();
    for p in px.pixels_mut() {
        if !original["stealth_rgb"].is_null() || !doc["stealth_rgb"].is_null() {
            for v in &mut p.0[..3] {
                *v &= 254
            }
        }
        if !original["stealth"].is_null() || !doc["stealth"].is_null() {
            p[3] = if p[3] >= 254 { 255 } else { p[3] & 254 }
        }
    }
    for (k, ch) in [("stealth", 1), ("stealth_rgb", 3)] {
        if !doc[k].is_null() {
            write_stealth(&mut px, ch, &doc[k])?
        }
    }
    let mut buf = vec![];
    let mut info = png::Info::with_size(px.width(), px.height());
    info.color_type = png::ColorType::Rgba;
    info.bit_depth = png::BitDepth::Eight;
    if let Some(exif) = doc["exif_raw"].as_str() {
        info.exif_metadata = Some(
            STANDARD
                .decode(exif)
                .map_err(|_| Fault::bad("Invalid EXIF data."))?
                .into(),
        )
    }
    let mut enc =
        png::Encoder::with_info(&mut buf, info).map_err(|_| Fault::bad("Invalid PNG."))?;
    if let Some(m) = doc["png"].as_object() {
        for (k, v) in m {
            enc.add_itxt_chunk(
                k.clone(),
                v.as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| v.to_string()),
            )
            .map_err(|_| Fault::bad("Invalid PNG metadata."))?
        }
    }
    {
        let mut wr = enc
            .write_header()
            .map_err(|_| Fault::bad("PNG encoding failed."))?;
        wr.write_image_data(px.as_raw())
            .map_err(|_| Fault::bad("PNG encoding failed."))?;
    }
    Ok(buf)
}
