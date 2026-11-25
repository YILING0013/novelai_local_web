use crate::service::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use serde_json::{json, Value as V};
use std::io::Cursor;
const MODELS: [&str; 9] = [
    "nai-diffusion-3",
    "nai-diffusion-furry-3",
    "nai-diffusion-4-curated-preview",
    "nai-diffusion-4-full",
    "nai-diffusion-4-5-curated",
    "nai-diffusion-4-5-full",
    "nai-diffusion-5-curated",
    "nai-diffusion-5-full",
    "nai-diffusion-5-full-medium",
];
fn model(v: &V) -> Res<&str> {
    let m = v["model"].as_str().unwrap_or(MODELS[0]);
    if MODELS.contains(&m) {
        Ok(m)
    } else {
        Err(Fault::bad("Unsupported model."))
    }
}
fn cost(w: u64, h: u64, steps: u64, m: &str, strength: f64) -> Res<u64> {
    let p = (w * h) as f64;
    let mut c = (2.951823174884865e-6 * p
        + 5.753298233447344e-7
            * p
            * if m.ends_with("medium") {
                14. / 1.06521739
            } else {
                steps as f64
            })
    .ceil();
    if m.contains("diffusion-5") {
        c *= 1.5
    }
    let c = (c * strength).ceil().max(2.) as u64;
    if c > 140 {
        return Err(Fault::bad("Reduce resolution or steps."));
    }
    Ok(c)
}
pub fn estimate(b: &V, snapshot: &V) -> Res<V> {
    let (w, h) = (
        b["source_width"].as_u64().unwrap_or(0),
        b["source_height"].as_u64().unwrap_or(0),
    );
    if !(64..=8192).contains(&w) || !(64..=8192).contains(&h) || w * h > 16_777_216 {
        return Err(Fault::bad("Invalid source dimensions."));
    }
    let (w, h, c, st, n, steps) = match s(b, "image_tool") {
        "upscale" => {
            let c = [1048576, 1747627, 2446678, 3145728]
                .iter()
                .position(|x| w * h <= *x)
                .ok_or_else(|| Fault::bad("Source image too large."))? as u64
                + 1;
            (2 * w, 2 * h, c, 0., 0., 0)
        }
        "enhance" => {
            let m = model(b)?;
            let a = b["upscale_amount"].as_f64().unwrap_or(1.);
            let (w, h) = if b["upscale_amount"] == "max" && m.contains("diffusion-5") {
                let (x, y) = ((w / 16 * 32) as f64, (h / 16 * 32) as f64);
                let r = (3145728. / (x * y)).sqrt().min(1.);
                let mut out = (
                    (x * r / 32.).round() as u64 * 32,
                    (y * r / 32.).round() as u64 * 32,
                );
                if out.0 * out.1 > 3145728 {
                    out = (
                        (x * r / 32.).floor() as u64 * 32,
                        (y * r / 32.).floor() as u64 * 32,
                    )
                }
                out
            } else if (a == 1. || a == 1.5) && b["upscale_amount"] != "max" {
                (
                    (w as f64 * a / 64.).round() as u64 * 64,
                    (h as f64 * a / 64.).round() as u64 * 64,
                )
            } else {
                return Err(Fault::bad("Invalid enhance amount."));
            };
            if w * h > 3145728 || w.max(h) > 4096 || w.min(h) < 64 {
                return Err(Fault::bad("Unsupported output dimensions."));
            }
            let st = b["strength"].as_f64().unwrap_or(0.2);
            let n = b["noise"].as_f64().unwrap_or(0.);
            let steps = if m.ends_with("medium") {
                14
            } else {
                b["steps"].as_u64().unwrap_or(28)
            };
            if !(0.0..=1.0).contains(&st) || !(0.0..=1.0).contains(&n) || !(1..=50).contains(&steps)
            {
                return Err(Fault::bad("Invalid tool parameters."));
            }
            (w, h, cost(w, h, steps, m, st)?, st, n, steps)
        }
        _ => return Err(Fault::bad("Choose an image tool.")),
    };
    let balance = if snapshot["stale"] == true {
        None
    } else {
        snapshot["anlas"]["total"].as_i64()
    };
    let mut v = json!({"width":w,"height":h,"cost":c,"balance":balance,"affordable":balance.map(|x|x>=c as i64)});
    if steps > 0 {
        v["strength"] = json!(st);
        v["noise"] = json!(n);
        v["steps"] = json!(steps)
    }
    Ok(v)
}
fn bytes(input: &str) -> Res<Vec<u8>> {
    let data = input
        .split_once(',')
        .filter(|(h, _)| h.starts_with("data:image/") && h.ends_with(";base64"))
        .map(|(_, b)| b)
        .unwrap_or(input);
    let raw = STANDARD
        .decode(data)
        .map_err(|_| Fault::bad("Invalid base64 image."))?;
    if raw.len() > 30 * 1024 * 1024 || image::guess_format(&raw).is_err() {
        return Err(Fault::bad("Invalid image."));
    }
    Ok(raw)
}
fn normalize_v5(par: &mut V, b: &V, prompt: &str, medium: bool) {
    let selected = match b["ucPresetId"].as_str() {
        Some(s @ ("heavy" | "light" | "furryFocus" | "humanFocus" | "none")) => s,
        _ => ["heavy", "light", "furryFocus", "humanFocus", "none"]
            .get(b["ucPreset"].as_u64().unwrap_or(4) as usize)
            .copied()
            .unwrap_or("none"),
    };
    par["tag_hint_uc_preset"] = json!(match selected {
        "heavy" => 2,
        "light" => 3,
        "humanFocus" => 4,
        "furryFocus" => 5,
        _ => 0,
    });
    par["ucPresetId"] = json!(selected);
    par["deliberate_euler_ancestral_bug"] = json!(false);
    par["prefer_brownian"] = json!(true);
    par["image_format"] = json!("png");
    if let Some(chars) = b["characterPrompts"].as_array().filter(|a| !a.is_empty()) {
        let active: Vec<_> = chars
            .iter()
            .enumerate()
            .filter(|(_, c)| c["enabled"] != false && !s(c, "prompt").trim().is_empty())
            .map(|(i, _)| i)
            .collect();
        par["characterPrompts"] = json!(active.iter().map(|&i| &chars[i]).collect::<Vec<_>>());
        for field in ["v4_prompt", "v4_negative_prompt"] {
            let source = &par[field]["caption"]["char_captions"];
            let values = active
                .iter()
                .filter_map(|&i| source.get(i))
                .cloned()
                .collect::<Vec<_>>();
            par[field]["caption"]["char_captions"] = json!(values);
        }
    }
    if medium {
        let heavy="lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
        let negative = if prompt.to_lowercase().contains("nsfw") {
            heavy.into()
        } else {
            format!("nsfw, {heavy}")
        };
        par["negative_prompt"] = json!(negative);
        par["v4_negative_prompt"]["caption"]["base_caption"] = json!(negative);
        if let Some(chars) = par["characterPrompts"].as_array_mut() {
            for c in chars.iter_mut().filter(|v| v.is_object()) {
                c["uc"] = json!("");
            }
        }
        if let Some(chars) = par["v4_negative_prompt"]["caption"]["char_captions"].as_array_mut() {
            for c in chars.iter_mut().filter(|v| v.is_object()) {
                c["char_caption"] = json!("");
            }
        }
        par["sampler"] = json!("k_euler_ancestral");
        par["noise_schedule"] = json!("karras");
        par["ucPresetId"] = json!("heavy");
        par["tag_hint_uc_preset"] = json!(2);
        par.as_object_mut().unwrap().remove("cfg_rescale");
    }
}
/// 将编辑器的参考图与逐图设置写入官方请求。V5 和 V4.5 使用各自的尺寸与强度范围。
fn apply_director_references(par: &mut V, b: &V, v5: bool) -> Res<()> {
    let invalid =
        |message: &str| Fault(400, "NOVELAI_REQUEST_FORMAT_INVALID".into(), message.into());
    let cached = b["director_reference_images_cached"]
        .as_array()
        .filter(|images| !images.is_empty());
    let images = cached.or_else(|| b["director_reference_images"].as_array());
    let count = images.map_or(0, Vec::len);
    if count > 12 {
        return Err(Fault(
            400,
            "NOVELAI_REFERENCE_LIMIT_EXCEEDED".into(),
            "At most 12 precise references are supported.".into(),
        ));
    }
    for (field, maximum) in [
        (
            "director_reference_strength_values",
            if v5 { 5. } else { 1. },
        ),
        (
            "director_reference_secondary_strength_values",
            if v5 { 0. } else { 1. },
        ),
        ("director_reference_information_extracted", 1.),
    ] {
        if let Some(values) = b.get(field) {
            if !values.as_array().is_some_and(|items| {
                items.len() == count
                    && items
                        .iter()
                        .all(|v| v.as_f64().is_some_and(|n| (0.0..=maximum).contains(&n)))
            }) {
                return Err(invalid(&format!(
                    "{field} must match the images and contain values between 0 and {maximum}."
                )));
            }
            par[field] = values.clone();
        }
    }
    if let Some(descriptions) = b.get("director_reference_descriptions") {
        if !descriptions
            .as_array()
            .is_some_and(|items| items.is_empty() || items.len() == count)
        {
            return Err(invalid("Reference descriptions must match the images."));
        }
        par["director_reference_descriptions"] = descriptions.clone();
    }
    if let Some(images) = images {
        let mut data = Vec::with_capacity(count);
        for entry in images {
            let value = if cached.is_some() {
                &entry["data"]
            } else {
                entry
            };
            let encoded = value
                .as_str()
                .ok_or_else(|| invalid("Each reference must include image data."))?;
            let raw = bytes(encoded)?;
            let reader = ImageReader::new(Cursor::new(&raw)).with_guessed_format()?;
            if raw.len() > 20 * 1024 * 1024
                || !matches!(
                    reader.format(),
                    Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)
                )
            {
                return Err(invalid(
                    "Use a PNG, JPEG, or WebP reference of up to 20 MiB.",
                ));
            }
            let decoder = reader
                .into_decoder()
                .map_err(|_| invalid("Invalid precise reference image."))?;
            let (width, height) = decoder.dimensions();
            let (short, long) = (width.min(height), width.max(height));
            // V5 长边按 64 分档，短边取 1024² 像素预算内的最大 64 倍数。
            let allowed = if v5 {
                (1024..=4096).contains(&long)
                    && long % 64 == 0
                    && short == 1_048_576 / long / 64 * 64
            } else {
                matches!((short, long), (1024, 1536) | (1472, 1472))
            };
            if !allowed {
                return Err(invalid(
                    "Unsupported precise reference resolution for the selected model.",
                ));
            }
            // 确认像素也能完整解码，避免把只有合法文件头的损坏图片提交给官方。
            DynamicImage::from_decoder(decoder)
                .map_err(|_| invalid("Invalid precise reference image."))?;
            // 桌面端和 Android 直连官方接口，发送完整原图数组，无需缓存密钥。
            data.push(STANDARD.encode(raw));
        }
        par["director_reference_images"] = json!(data);
    }
    Ok(())
}
pub fn payload(b: &V) -> Res<V> {
    if ["captcha_token", "recaptcha_token", "turnstile_token"]
        .iter()
        .any(|k| b.get(k).is_some())
    {
        return Err(Fault::bad("Site verification fields are not accepted."));
    }
    let m = model(b)?;
    let v5 = m.contains("diffusion-5");
    let modern = v5 || m.contains("diffusion-4");
    for field in [
        "director_reference_images_cached",
        "director_reference_images",
    ] {
        if b.get(field).is_some_and(|value| !value.is_array()) {
            return Err(Fault::bad(&format!("{field} must be an array.")));
        }
    }
    let prompt = b["positivePrompt"]
        .as_str()
        .or(b["prompt"].as_str())
        .unwrap_or("1girl");
    let neg = s(b, "negativePrompt");
    let active = |prefix: &str| {
        b.as_object().is_some_and(|m| {
            m.iter()
                .any(|(k, v)| k.starts_with(prefix) && v.as_array().is_some_and(|a| !a.is_empty()))
        })
    };
    let director = active("director_reference_");
    let vibe = active("reference_") || !s(b, "reference_image").is_empty();
    let infill = !s(b, "mask").is_empty() || b["action"] == "infill";
    let conflict = if infill && m == "nai-diffusion-5-curated" {
        Some((
            "NOVELAI_INPAINT_MODEL_NOT_SUPPORTED",
            "V5 Curated does not support inpainting.",
        ))
    } else if director && v5 && infill {
        Some((
            "NOVELAI_INPAINT_REFERENCE_NOT_SUPPORTED",
            "V5 inpainting does not support precise reference.",
        ))
    } else if director && m.ends_with("medium") {
        Some((
            "NOVELAI_REFERENCE_HIGH_EFFORT_REQUIRED",
            "V5 precise reference requires High effort.",
        ))
    } else if vibe && v5 {
        Some((
            "MODEL_CAPABILITY_NOT_SUPPORTED",
            "V5 does not support Vibe.",
        ))
    } else if director && !v5 && !m.contains("diffusion-4-5") {
        Some((
            "NOVELAI_REFERENCE_MODEL_NOT_SUPPORTED",
            "Precise reference requires a V4.5 or V5 model.",
        ))
    } else if director && vibe {
        Some((
            "NOVELAI_REFERENCE_VIBE_CONFLICT",
            "Precise reference and Vibe cannot be used together.",
        ))
    } else if vibe && modern && infill {
        Some((
            "NOVELAI_INPAINT_VIBE_NOT_SUPPORTED",
            "V4 and V4.5 inpainting do not support Vibe.",
        ))
    } else {
        None
    };
    if let Some((code, message)) = conflict {
        return Err(Fault(400, code.into(), message.into()));
    }
    let (mut w, mut h) = (
        b["width"].as_u64().unwrap_or(if v5 { 832 } else { 512 }),
        b["height"].as_u64().unwrap_or(if v5 { 1216 } else { 512 }),
    );
    if w == 0 || h == 0 || w > 65536 || h > 65536 {
        return Err(Fault::bad("Invalid render dimensions."));
    }
    let large = b["use_upscale_credits"] == true || b["image_tool"] == "enhance";
    let (max_px, max_side, max_steps) = if large {
        (3145728_u64, 4096_u64, 50_u64)
    } else {
        (1048576, 2048, 28)
    };
    let step = if b["image_tool"] == "enhance" { 32 } else { 64 };
    if w * h > max_px
        || w > max_side
        || h > max_side
        || w % step != 0
        || h % step != 0
        || w < step
        || h < step
    {
        let ratio = ((max_px as f64) / (w * h) as f64).sqrt().min(1.);
        w = ((w as f64 * ratio / 64.).floor() as u64 * 64).clamp(64, max_side);
        h = ((h as f64 * ratio / 64.).floor() as u64 * 64).clamp(64, max_side);
    }
    let steps = if m.ends_with("medium") {
        14
    } else {
        b["steps"].as_u64().unwrap_or(if v5 { 23 } else { 28 })
    };
    if steps == 0 || (v5 && large && steps > 50) {
        return Err(Fault::bad("Invalid step count."));
    }
    let steps = steps.min(max_steps);
    let scale = match b.get("scale") {
        None => Some(if v5 { 7. } else { 10. }),
        Some(value) => value.as_f64(),
    }
    .filter(|value| (0. ..=20.).contains(value))
    .ok_or_else(|| {
        Fault(
            400,
            "NOVELAI_GUIDANCE_SCALE_INVALID".into(),
            "CFG scale must be between 0 and 20.".into(),
        )
    })?;
    if large {
        cost(
            w,
            h,
            steps,
            m,
            b["inpaint_strength"]
                .as_f64()
                .or(b["strength"].as_f64())
                .unwrap_or(1.),
        )?;
    }
    let seed = b["seed"]
        .as_u64()
        .unwrap_or_else(|| rand::random::<u32>() as u64);
    let mut par = json!({"width":w,"height":h,"steps":steps,"n_samples":1,"scale":scale,"seed":seed,"sampler":b["sampler"].as_str().unwrap_or(if v5{"k_euler_ancestral"}else{"k_euler"}),"noise_schedule":b.get("noise_schedule").cloned().unwrap_or_else(||if v5{json!("karras")}else{json!(0)}),"cfg_rescale":b["promptGuidanceRescale"].as_f64().unwrap_or(0.),"negative_prompt":neg,"params_version":if v5{4}else{3},"legacy":false,"legacy_uc":false,"legacy_v3_extend":false,"autoSmea":false,"dynamic_thresholding":false,"controlnet_strength":1,"add_original_image":true,"normalize_reference_strength_multiple":true,"inpaintImg2ImgStrength":1});
    let mut upstream_model = m.to_owned();
    let mut action = "generate";
    if !s(b, "image").is_empty() {
        par["image"] = json!(STANDARD.encode(bytes(s(b, "image"))?));
        action = "img2img";
        par["strength"] = json!(b["strength"].as_f64().unwrap_or(0.7));
        par["noise"] = json!(b["noise"].as_f64().unwrap_or(0.1));
    }
    if !s(b, "mask").is_empty() {
        if action != "img2img" {
            return Err(Fault::bad("Unsupported mask."));
        }
        action = "infill";
        upstream_model = format!("{}-inpainting", m.trim_end_matches("-preview"));
        par["mask"] = json!(STANDARD.encode(bytes(s(b, "mask"))?));
        par["inpaintImg2ImgStrength"] = json!(b["inpaint_strength"].as_f64().unwrap_or(1.));
    }
    if modern {
        par["characterPrompts"] = b.get("characterPrompts").cloned().unwrap_or(json!([]));
        par["use_coords"] = json!(b["use_coords"].as_bool().unwrap_or(!v5));
        par["v4_prompt"] = json!({"caption":{"base_caption":prompt,"char_captions":b.get("v4_prompt_char_captions").cloned().unwrap_or(json!([]))},"use_coords":par["use_coords"],"use_order":b["use_order"].as_bool().unwrap_or(true)});
        par["v4_negative_prompt"] = json!({"caption":{"base_caption":neg,"char_captions":b.get("v4_negative_prompt_char_captions").cloned().unwrap_or(json!([]))},"legacy_uc":false});
    }
    if v5 {
        par["straight_alpha"] = json!(true);
        par["tag_hint_qt"] = json!(1);
        par["tag_hint_uc_preset"] = json!(0);
        par["ucPresetId"] = json!("none");
        par["qualityPresetId"] = json!("standard");
        for k in [
            "qualityPresetId",
            "ucPresetId",
            "tag_hint_qt",
            "tag_hint_uc_preset",
            "tag_hint_transparent_background",
        ] {
            if let Some(v) = b.get(k) {
                par[k] = v.clone()
            }
        }
    } else {
        par["extra_noise_seed"] = json!(seed);
        par["ucPreset"] =
            json!([3, 2, 2, 2, 3, 4, 4, 4, 4][MODELS.iter().position(|&x| x == m).unwrap()]);
        par["use_new_shared_trial"] = json!(true);
        for k in [
            "sm",
            "sm_dyn",
            "prefer_brownian",
            "deliberate_euler_ancestral_bug",
            "reference_image_multiple",
            "reference_strength_multiple",
            "reference_information_extracted_multiple",
        ] {
            if let Some(v) = b.get(k) {
                par[k] = v.clone()
            }
        }
    }
    if v5 {
        normalize_v5(&mut par, b, prompt, m.ends_with("medium"));
    } else {
        par["dynamic_thresholding"] = json!(b["decrisp"] == true);
        par["prefer_brownian"] = json!(b["prefer_brownian"].as_bool().unwrap_or(true));
        par["sm"] = json!(b["sm"].as_bool().unwrap_or(false));
        par["sm_dyn"] = json!(b["sm_dyn"].as_bool().unwrap_or(false));
        par["deliberate_euler_ancestral_bug"] = json!(b["deliberate_euler_ancestral_bug"]
            .as_bool()
            .unwrap_or(false));
        if modern {
            par["v4_negative_prompt"]
                .as_object_mut()
                .unwrap()
                .remove("legacy_uc");
        }
        par["qualityToggle"] = json!(false);
        par["skip_cfg_above_sigma"] = if b["variety"] == true {
            json!(58)
        } else {
            V::Null
        };
    }
    if director {
        apply_director_references(&mut par, b, v5)?;
    }
    if action == "infill" {
        if par["inpaintImg2ImgStrength"]
            .as_f64()
            .is_some_and(|x| x < 1.)
        {
            par["img2img"] = json!({"color_correct":b["color_correct"].as_bool().unwrap_or(true),"strength":par["inpaintImg2ImgStrength"]})
        }
        par["add_original_image"] = json!(b["disabled_original_image"] != true);
    }
    let mut req = json!({"model":upstream_model,"input":prompt,"action":action,"parameters":par});
    if v5 {
        req["use_new_shared_trial"] = json!(true)
    }
    Ok(req)
}
pub async fn generate(c: &Shared, caller: &str, sess: &Session, op: &str, b: &V) -> Res<V> {
    let _lock = c.image_lock.try_lock().map_err(|_| {
        Fault(
            409,
            "IMAGE_OPERATION_BUSY".into(),
            "Another image operation is running.".into(),
        )
    })?;
    let i = b["index"].as_u64().unwrap_or(0);
    let mut tool_body;
    let b = if op == "generate" && b["image_tool"] == "enhance" {
        let raw = bytes(s(b, "image"))?;
        let (w, h) = image::ImageReader::new(Cursor::new(raw))
            .with_guessed_format()?
            .into_dimensions()
            .map_err(|_| Fault::bad("Invalid Enhance source image."))?;
        tool_body = b.clone();
        let m = tool_body
            .as_object_mut()
            .ok_or_else(|| Fault::bad("Invalid body."))?;
        m.retain(|k, _| {
            !k.starts_with("director_reference_")
                && !k.starts_with("reference_")
                && !matches!(k.as_str(), "mask" | "req_type")
        });
        tool_body["source_width"] = json!(w);
        tool_body["source_height"] = json!(h);
        let v = estimate(&tool_body, &sess.snapshot)?;
        for k in ["steps", "strength", "noise", "width", "height"] {
            tool_body[k] = v[k].clone();
        }
        tool_body["sm"] = json!(false);
        tool_body["sm_dyn"] = json!(false);
        &tool_body
    } else {
        b
    };
    let op = if op == "generate" && b["image_tool"] == "upscale" {
        "upscale"
    } else {
        op
    };
    let mut req = if op == "generate" {
        payload(b)?
    } else {
        let mut v = json!({"image":STANDARD.encode(bytes(s(b,"image"))?)});
        for k in [
            "req_type",
            "defry",
            "prompt",
            "width",
            "height",
            "model",
            "scale",
            "declared_blur_sigma",
            "information_extracted",
        ] {
            if let Some(val) = b.get(k) {
                v[k] = val.clone()
            }
        }
        v
    };
    let mut endpoint = match op {
        "generate" => "generate-image",
        "vibe" => "encode-vibe",
        "upscale" => "upscale",
        "augment" => "augment-image",
        _ => return Err(Fault::bad("Unknown tool.")),
    };
    if op == "generate" && !s(b, "req_type").is_empty() {
        endpoint = "augment-image";
        req = json!({"req_type":b["req_type"],"image":STANDARD.encode(bytes(s(b,"image"))?),"width":b["width"],"height":b["height"],"prompt":b["prompt"],"defry":b["defry"]})
    }
    if endpoint == "upscale" {
        let data = bytes(s(b, "image"))?;
        let (w, h) = image::ImageReader::new(Cursor::new(data))
            .with_guessed_format()?
            .into_dimensions()
            .map_err(|_| Fault::bad("Invalid image."))?;
        estimate(
            &json!({"image_tool":"upscale","source_width":w,"source_height":h}),
            &sess.snapshot,
        )?;
        req["width"] = json!(w);
        req["height"] = json!(h);
        req["scale"] = json!(2);
        req["model"] = json!("nai-diffusion-5-curated")
    }
    if b["image_tool"] == "enhance" {
        req["parameters"]["upscaled_enhance"] = json!(b["upscale_amount"] == "max");
    }
    if endpoint == "upscale" {
        req["declared_blur_sigma"] = json!(0);
    }
    if b["image_tool"] == "enhance" && b["upscale_amount"] == "max" {
        req["parameters"]["upscaled_enhance"] = json!(true);
        req["parameters"]["width"] = b["source_width"].clone();
        req["parameters"]["height"] = b["source_height"].clone();
    }
    let context = crate::works::context(&c.db.lock().unwrap(), b)?;
    let mut lease = crate::batch::Lease::start(c, caller, b)?;
    let (raw, mime) = crate::official::request(
        c,
        &sess.token,
        Some(&sess.token),
        "POST",
        &format!("/ai/{endpoint}"),
        Some(&req),
    )
    .await?;
    if op == "vibe" {
        lease.complete();
        return Ok(
            json!({"encoding":STANDARD.encode(raw),"mime_type":mime,"account_snapshot":sess.snapshot,"correlation_id":id()}),
        );
    }
    let mut seed = req["parameters"]["seed"].clone();
    let data = if image::guess_format(&raw).is_ok() {
        raw
    } else if raw.starts_with(b"PK") {
        use std::io::Read;
        let mut zip = zip::ZipArchive::new(Cursor::new(raw))
            .map_err(|_| Fault::bad("Invalid image archive."))?;
        if zip.len() != 1 {
            return Err(Fault::bad("Unexpected image count."));
        }
        let mut buf = vec![];
        zip.by_index(0)
            .map_err(|_| Fault::bad("Invalid archive."))?
            .take(30 * 1024 * 1024 + 1)
            .read_to_end(&mut buf)?;
        buf
    } else {
        let v: V = serde_json::from_slice(&raw)?;
        let a = v["images"]
            .as_array()
            .filter(|a| a.len() == 1)
            .ok_or_else(|| Fault::bad("Invalid image result."))?;
        if !a[0]["seed"].is_null() {
            seed = a[0]["seed"].clone()
        }
        bytes(s(&a[0], "image"))?
    };
    let mut params = crate::works::safe(b)?;
    if let Some(m) = req["parameters"].as_object() {
        for k in [
            "width",
            "height",
            "steps",
            "scale",
            "seed",
            "sampler",
            "noise_schedule",
            "cfg_rescale",
            "negative_prompt",
            "v4_prompt",
            "v4_negative_prompt",
            "characterPrompts",
            "use_coords",
            "sm",
            "sm_dyn",
            "strength",
            "noise",
            "upscaled_enhance",
        ] {
            if let Some(v) = m.get(k) {
                params[k] = v.clone();
            }
        }
    }
    if b["image_tool"] == "enhance" {
        params["upscaled_enhance"] = json!(b["upscale_amount"] == "max");
    }
    if !b["version_editor"].is_null() && !context.is_null() {
        let ed = crate::works::editor(&b["version_editor"])?;
        if !ed["parameterState"]["characterTabs"].is_null() {
            params["characterTabs"] = ed["parameterState"]["characterTabs"].clone()
        }
        params["editor_state"] = ed;
    }
    params["seed"] = seed.clone();
    let f = image::guess_format(&data).map_err(|_| Fault::bad("Invalid output image."))?;
    let mut result =
        json!({"data":STANDARD.encode(&data),"mime_type":f.to_mime_type(),"seed":seed,"index":i});
    let stored = (|| -> Res<(Vec<u8>, V)> {
        let pic =
            image::load_from_memory(&data).map_err(|_| Fault::bad("Invalid generated image."))?;
        let (_, doc) = crate::library::inspect(&pic, &data, f);
        let (embedded, _) = crate::metadata::parameters(&doc);
        let mut saved = crate::works::safe(&params)?;
        saved.as_object_mut().unwrap().retain(|k, _| {
            !matches!(k.as_str(), "image" | "mask" | "editor_state")
                && !k.starts_with("director_reference")
                && !k.starts_with("reference_")
        });
        saved
            .as_object_mut()
            .unwrap()
            .extend(embedded.as_object().unwrap().clone());
        saved["width"] = json!(pic.width());
        saved["height"] = json!(pic.height());
        let has_params = embedded
            .as_object()
            .unwrap()
            .keys()
            .any(|k| !matches!(k.as_str(), "width" | "height"));
        if has_params {
            return Ok((data.clone(), saved));
        }
        let mut template = doc.clone();
        let mut comment = saved.clone();
        comment["prompt"] = json!(s(&saved, "positivePrompt"));
        comment["uc"] = json!(s(&saved, "negativePrompt"));
        template["png"]["Comment"] = comment;
        template["png"]["Description"] = json!(s(&saved, "positivePrompt"));
        Ok((
            crate::metadata::export(
                &pic,
                &doc,
                &json!({"mode":"edit","metadata_document":template}),
            )?,
            saved,
        ))
    })();
    let (stored, saved_params) = match stored {
        Ok(v) => v,
        Err(_) => {
            result["save_error"] = json!("LOCAL_IMAGE_SAVE_FAILED");
            lease.complete();
            return Ok(
                json!({"images":[result],"account_snapshot":sess.snapshot,"correlation_id":id(),"batch_id":b["batch_id"],"index":i}),
            );
        }
    };
    let db = c.db.lock().unwrap();
    let settings = load(&db, "settings", "settings")?.unwrap_or(json!({}));
    // 桌面和 Android 共用这个原生后端，生成后的实际种子用于输出文件名。
    let prefix = settings["fileNamePrefix"].as_str().unwrap_or("AI_Image");
    let prompt = saved_params["positivePrompt"].as_str().unwrap_or("").trim();
    let seed_text = seed.as_u64().map(|s| s.to_string()).unwrap_or_else(id);
    let now = chrono::Local::now();
    let random = |length| {
        use rand::{distributions::Alphanumeric, Rng};
        rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(length)
            .map(char::from)
            .collect::<String>()
    };
    let stem = match settings["namingMethod"].as_str().unwrap_or("seed") {
        "custom" => {
            static TOKENS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
                regex::Regex::new(r"\{(\w+)(?::(\d{1,3}))?\}").unwrap()
            });
            let template = settings["fileNameTemplate"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("{prefix}_{seed}_{date}");
            TOKENS
                .replace_all(template, |caps: &regex::Captures<'_>| {
                    let limit = caps
                        .get(2)
                        .and_then(|n| n.as_str().parse::<usize>().ok())
                        .filter(|n| *n > 0)
                        .map(|n| n.min(120));
                    match &caps[1] {
                        "prefix" => prefix.to_owned(),
                        "seed" => seed_text.clone(),
                        "prompt" => prompt.chars().take(limit.unwrap_or(32)).collect(),
                        "random" => random(limit.unwrap_or(8)),
                        "date" => now.format("%Y-%m-%d").to_string(),
                        "time" => now.format("%H-%M-%S").to_string(),
                        "timestamp" => now.timestamp_millis().to_string(),
                        _ => caps[0].to_owned(),
                    }
                })
                .into_owned()
        }
        method => {
            let label = match method {
                "prompt32" if !prompt.is_empty() => prompt.chars().take(32).collect(),
                "random" => random(8),
                "datetime" | "localDateTime" => now.format("%Y-%m-%d_%H-%M-%S").to_string(),
                "timestamp" => now.timestamp_millis().to_string(),
                _ => seed_text.clone(),
            };
            format!("{prefix}_{label}")
        }
    };
    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_control() || c.is_whitespace() || r#"<>:"/\|?*"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let stem = cleaned.trim_matches(['.', '_', '-']);
    let filename = format!(
        "{}.{}",
        if stem.is_empty() { &seed_text } else { stem },
        image::guess_format(&stored).unwrap_or(f).extensions_str()[0]
    );
    match crate::library::import(
        c,
        &db,
        "outputs",
        &filename,
        &stored,
        &json!({"parameters":saved_params,"prompt":saved_params["positivePrompt"]}),
    ) {
        Ok(mut item) => {
            let saved = crate::gallery_files::save_new(c, &db, &mut item, &stored);
            if saved.is_err() {
                result["save_error"] = json!("LOCAL_IMAGE_SAVE_FAILED");
            }
            result["saved_file"] =
                json!({"id":item["id"],"filename":item["filename"],"url":item["url"]});
            result["width"] = item["width"].clone();
            result["height"] = item["height"].clone();
            if let Some(w) = context["work_id"].as_str() {
                params["width"] = item["width"].clone();
                params["height"] = item["height"].clone();
                match crate::works::handle(
                    &db,
                    "POST",
                    &["works", w, "versions"],
                    &json!({"image_ids":[item["id"]],"parent_id":context["parent_version_id"],"parameters":params,"operation":"generate","message":"生成图片"}),
                ) {
                    Ok(v) => {
                        result["version"] = json!({"work_id":w,"work_title":v["work"]["title"],"version_id":v["version"]["id"],"number":v["version"]["number"]})
                    }
                    Err(_) => result["version_error"] = json!("LOCAL_VERSION_SAVE_FAILED"),
                }
            }
        }
        Err(_) => result["save_error"] = json!("LOCAL_IMAGE_SAVE_FAILED"),
    };
    lease.complete();
    Ok(
        json!({"images":[result],"account_snapshot":sess.snapshot,"correlation_id":id(),"batch_id":b["batch_id"],"index":i}),
    )
}
