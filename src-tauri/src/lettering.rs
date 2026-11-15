use super::*;
use crate::{
    jobs,
    service::{s, Shared},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    imageops::{self, FilterType},
    GrayImage, Luma, RgbImage,
};
use serde_json::{json, Value as V};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    io::Cursor,
};
type E<T> = Result<T, String>;
pub(super) struct Models {
    ctd: Session,
    det: Session,
    cls: Session,
    rec: Session,
    labels: Vec<String>,
    lama: Option<Session>,
    folder: PathBuf,
}
fn session(env: &Environment, path: &Path) -> E<Session> {
    Session::builder(env)
        .map_err(|e| e.to_string())?
        .with_intra_threads(3)
        .map_err(|e| e.to_string())?
        .with_config_entry("session.set_denormal_as_zero", "1")
        .map_err(|e| e.to_string())?
        .commit_from_file(path)
        .map_err(|e| e.to_string())
}
impl Models {
    fn new(env: &Environment, folder: &Path) -> E<Self> {
        let rec = session(env, &folder.join("PP-OCRv6_rec_small.onnx"))?;
        let labels = rec
            .metadata()
            .map_err(|e| e.to_string())?
            .custom("character")
            .ok_or("Missing recognition dictionary")?
            .lines()
            .map(str::to_owned)
            .collect();
        Ok(Self {
            ctd: session(env, &folder.join("comictextdetector.pt.onnx"))?,
            det: session(env, &folder.join("PP-OCRv6_det_small.onnx"))?,
            cls: session(env, &folder.join("ch_ppocr_mobile_v2.0_cls_mobile.onnx"))?,
            rec,
            labels,
            lama: None,
            folder: folder.into(),
        })
    }
}
pub fn release(state: State<'_, InferenceState>) {
    *state.inner.ocr.lock().unwrap() = None;
}
fn input(img: &RgbImage, w: usize, h: usize, bgr: bool, normalize: bool) -> Vec<f32> {
    let mut out = vec![0.; w * h * 3];
    for (x, y, p) in img.enumerate_pixels() {
        if x as usize >= w || y as usize >= h {
            continue;
        }
        for c in 0..3 {
            let v = p[if bgr { 2 - c } else { c }] as f32 / 255.;
            out[c * w * h + y as usize * w + x as usize] = if normalize { 2. * v - 1. } else { v }
        }
    }
    out
}
fn predict(
    s: &mut Session,
    w: usize,
    h: usize,
    data: Vec<f32>,
    idx: usize,
    run: &RunOptions,
) -> E<(Vec<usize>, Vec<f32>)> {
    let input =
        Tensor::from_array(([1i64, 3, h as i64, w as i64], data)).map_err(|e| e.to_string())?;
    let out = s
        .run_with_options(ort::inputs![input], run)
        .map_err(|e| e.to_string())?;
    let (d, x) = out[idx]
        .try_extract_tensor::<f32>()
        .map_err(|e| e.to_string())?;
    Ok((d.iter().map(|n| *n as usize).collect(), x.to_vec()))
}
#[derive(Clone, Copy)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}
fn boxes(mut p: Vec<u8>, w: usize, h: usize, ow: u32, oh: u32) -> Vec<Rect> {
    let mut out = vec![];
    for i in 0..p.len() {
        if p[i] == 0 {
            continue;
        }
        p[i] = 0;
        let mut todo = VecDeque::from([i]);
        let (mut x0, mut x1, mut y0, mut y1, mut count) = (w, 0, h, 0, 0);
        while let Some(i) = todo.pop_front() {
            let (x, y) = (i % w, i / w);
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y);
            count += 1;
            for j in [
                (x > 0).then(|| i - 1),
                (x + 1 < w).then(|| i + 1),
                (y > 0).then(|| i - w),
                (y + 1 < h).then(|| i + w),
            ]
            .into_iter()
            .flatten()
            {
                if p[j] != 0 {
                    p[j] = 0;
                    todo.push_back(j)
                }
            }
        }
        if count < 5 || x1 - x0 < 2 || y1 - y0 < 2 {
            continue;
        }
        let pad = ((x1 - x0).min(y1 - y0) / 3).max(2);
        let x = (x0.saturating_sub(pad) * ow as usize / w) as u32;
        let y = (y0.saturating_sub(pad) * oh as usize / h) as u32;
        let x1 = ((x1 + 1 + pad) * ow as usize / w).min(ow as usize) as u32;
        let y1 = ((y1 + 1 + pad) * oh as usize / h).min(oh as usize) as u32;
        if x1 > x && y1 > y {
            out.push(Rect {
                x,
                y,
                w: x1 - x,
                h: y1 - y,
            });
        }
        if out.len() == 100 {
            break;
        }
    }
    out
}
fn read_line(m: &mut Models, rgb: &RgbImage, r: Rect, run: &RunOptions) -> E<(String, f32)> {
    let mut crop = imageops::crop_imm(rgb, r.x, r.y, r.w, r.h).to_image();
    if crop.height() as f32 > crop.width() as f32 * 1.5 {
        crop = imageops::rotate270(&crop)
    }
    let aspect = crop.width() as f64 / crop.height() as f64;
    let w = (48. * aspect).ceil().clamp(1., 192.) as u32;
    let cls = imageops::resize(&crop, w, 48, FilterType::Triangle);
    let (_, pred) = predict(
        &mut m.cls,
        192,
        48,
        input(&cls, 192, 48, true, true),
        0,
        run,
    )?;
    if pred.len() == 2 && pred[1] > 0.9 {
        crop = imageops::rotate180(&crop)
    }
    let width = (48. * aspect).ceil().clamp(8., 1280.) as usize;
    let w = width.max(320);
    let scaled = imageops::resize(&crop, width as u32, 48, FilterType::Triangle);
    let (dims, data) = predict(&mut m.rec, w, 48, input(&scaled, w, 48, true, true), 0, run)?;
    let n = *dims.last().ok_or("Invalid OCR output")?;
    if n < 2 || n > m.labels.len() + 2 {
        return Err("Recognition dictionary mismatch".into());
    }
    let mut last = 0;
    let mut txt = String::new();
    let mut sum = 0.;
    let mut count = 0;
    for row in data.chunks_exact(n) {
        let (i, score) = row
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap();
        if i > 0 && last != i {
            txt.push_str(m.labels.get(i - 1).map(String::as_str).unwrap_or(" "));
            sum += *score;
            count += 1
        }
        last = i
    }
    Ok((txt, if count > 0 { sum / count as f32 } else { 0. }))
}
fn normalized(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn rebuild(
    m: &mut Models,
    env: &Environment,
    src: image::DynamicImage,
    b: &V,
    op: &Operation,
    stage: impl Fn(&str, u64, u64),
) -> E<(image::DynamicImage, image::DynamicImage, V)> {
    let mut out = src.to_rgba8();
    let (w, h) = out.dimensions();
    let mut rgb = RgbImage::new(w, h);
    for (x, y, p) in out.enumerate_pixels() {
        let a = p[3] as u32;
        rgb.put_pixel(
            x,
            y,
            image::Rgb(std::array::from_fn(|c| {
                ((p[c] as u32 * a + 255 * (255 - a)) / 255) as u8
            })),
        )
    }
    let mut digest = Sha256::new();
    digest.update(format!("{w}x{h}:"));
    digest.update(out.as_raw());
    let hash = format!("{:x}", digest.finalize());
    let run = Arc::new(RunOptions::new().map_err(|e| e.to_string())?);
    *op.run.lock().unwrap() = Some(run.clone());
    op.check()?;
    stage("detecting-text", 0, 1);
    let ratio = 1024. / w.max(h) as f64;
    let (sw, sh) = (
        ((w as f64 * ratio).round() as u32).max(1),
        ((h as f64 * ratio).round() as u32).max(1),
    );
    let shrunk = imageops::resize(&rgb, sw, sh, FilterType::Triangle);
    let (_, seg) = predict(
        &mut m.ctd,
        1024,
        1024,
        input(&shrunk, 1024, 1024, false, false),
        1,
        &run,
    )?;
    if seg.len() != 1024 * 1024 {
        return Err("Invalid CTD mask".into());
    }
    let seg = GrayImage::from_raw(
        1024,
        1024,
        seg.iter().map(|v| (v.clamp(0., 1.) * 255.) as u8).collect(),
    )
    .unwrap();
    let mask = imageops::resize(
        &imageops::crop_imm(&seg, 0, 0, sw, sh).to_image(),
        w,
        h,
        FilterType::Triangle,
    );
    op.check()?;
    let ratio = (736. / w.min(h) as f64).min(1440. / w.max(h) as f64);
    let dw = ((w as f64 * ratio / 32.).round() as usize * 32).max(32);
    let dh = ((h as f64 * ratio / 32.).round() as usize * 32).max(32);
    let det = imageops::resize(&rgb, dw as u32, dh as u32, FilterType::Triangle);
    let (dims, db) = predict(&mut m.det, dw, dh, input(&det, dw, dh, true, true), 0, &run)?;
    if dims.len() != 4 || db.len() != dims[2] * dims[3] {
        return Err("Invalid OCR detection".into());
    }
    let mut rects = boxes(
        db.iter().map(|v| u8::from(*v >= 0.3)).collect(),
        dims[3],
        dims[2],
        w,
        h,
    );
    rects.sort_by_key(|r| {
        (
            r.y,
            if b["reading_direction"] == "rtl" {
                w - r.x
            } else {
                r.x
            },
        )
    });
    let mut blocks = vec![];
    for (i, r) in rects.iter().enumerate() {
        op.check()?;
        stage("recognizing-text", i as u64, rects.len() as u64);
        let (text, confidence) = read_line(m, &rgb, *r, &run)?;
        let key = format!(
            "{:x}",
            Sha256::digest(format!(
                "{hash}:{},{},{},{}",
                r.x,
                r.y,
                r.x + r.w,
                r.y + r.h
            ))
        );
        blocks.push(json!({"id":format!("text-{}",&key[..16]),"bounds":{"x":r.x,"y":r.y,"width":r.w,"height":r.h},"direction":if r.h>r.w*2{"vertical-rl"}else{"horizontal-tb"},"ocrText":text,"text":text,"confidence":confidence,"fontSize":(r.h as f32/1.25).max(10.),"color":"#111111","applied":false,"needsReview":true,"reason":"unmatched-text","dialogueId":null}));
    }
    let dialogues = b["dialogues"].as_array().cloned().unwrap_or_default();
    let assignments = b["assignments"].as_object();
    if assignments.is_some_and(|a| a.keys().any(|id| !blocks.iter().any(|v| v["id"] == *id))) {
        return Err("COMIC_ASSIGNMENT_NOT_FOUND".into());
    }
    let mut used = HashSet::new();
    let texts = blocks
        .iter()
        .map(|v| normalized(s(v, "ocrText")))
        .collect::<Vec<_>>();
    for (i, block) in blocks.iter_mut().enumerate() {
        let selected = assignments.and_then(|a| a.get(s(block, "id")));
        let d = match selected {
            Some(V::Null) => {
                block["reason"] = json!("kept-original");
                continue;
            }
            Some(v) if v.is_object() && matches!(s(v, "action"), "erase" | "replace") => {
                block["editAction"] = v["action"].clone();
                block["text"] = json!(s(v, "text"));
                if !v["direction"].is_null() {
                    block["direction"] = v["direction"].clone()
                }
                None
            }
            Some(v) => Some(
                dialogues
                    .iter()
                    .find(|d| d["id"] == *v)
                    .ok_or("COMIC_DIALOGUES_INVALID")?,
            ),
            None => {
                let matches = dialogues
                    .iter()
                    .filter(|d| normalized(s(d, "text")) == texts[i])
                    .collect::<Vec<_>>();
                if texts[i].is_empty()
                    || texts.iter().filter(|s| *s == &texts[i]).count() != 1
                    || block["confidence"].as_f64().unwrap_or(0.) < 0.6
                    || matches.len() != 1
                {
                    continue;
                }
                Some(matches[0])
            }
        };
        if let Some(d) = d {
            if !used.insert(s(d, "id").to_owned()) {
                continue;
            }
            block["text"] = d["text"].clone();
            block["dialogueId"] = d["id"].clone();
            if d["direction"].is_string() {
                block["direction"] = d["direction"].clone()
            }
        }
        block["needsReview"] = json!(false);
        block["reason"] = V::Null;
    }
    let mut erased = GrayImage::new(w, h);
    for (i, r) in rects.iter().enumerate() {
        op.check()?;
        stage("cleaning-text", i as u64, rects.len() as u64);
        if blocks[i]["needsReview"] == true {
            continue;
        }
        let mut marked = vec![];
        let mut samples = vec![];
        let mut overlap = false;
        for y in r.y..r.y + r.h {
            for x in r.x..r.x + r.w {
                if mask.get_pixel(x, y)[0] >= 76 {
                    if rects.iter().enumerate().any(|(j, b)| {
                        i != j
                            && blocks[j]["needsReview"] == true
                            && x >= b.x
                            && x < b.x + b.w
                            && y >= b.y
                            && y < b.y + b.h
                    }) {
                        overlap = true
                    }
                    marked.push((x, y))
                } else {
                    samples.push(rgb.get_pixel(x, y).0)
                }
            }
        }
        if marked.len() < 4 || samples.is_empty() || overlap {
            blocks[i]["needsReview"] = json!(true);
            blocks[i]["reason"] = json!(if overlap {
                "overlapping-text"
            } else {
                "text-mask-missing"
            });
            continue;
        }
        let bg: [u8; 3] = std::array::from_fn(|ch| {
            let mut v = samples.iter().map(|p| p[ch]).collect::<Vec<_>>();
            let n = v.len() / 2;
            *v.select_nth_unstable(n).1
        });
        let uniform = samples
            .iter()
            .filter(|p| (0..3).all(|ch| p[ch].abs_diff(bg[ch]) <= 14))
            .count()
            * 100
            >= samples.len() * 85;
        if uniform {
            for &(x, y) in &marked {
                out.get_pixel_mut(x, y).0[..3].copy_from_slice(&bg)
            }
            blocks[i]["eraseMethod"] = json!("bubble-fill")
        } else {
            if m.lama.is_none() {
                stage("loading-inpaint", i as u64, rects.len() as u64);
                m.lama = Some(session(env, &m.folder.join("lama_fp32.onnx"))?)
            }
            let pad = (r.w.max(r.h) / 3).max(32);
            let x = r.x.saturating_sub(pad);
            let y = r.y.saturating_sub(pad);
            let cw = (r.x + r.w + pad).min(w) - x;
            let ch = (r.y + r.h + pad).min(h) - y;
            let crop = imageops::resize(
                &imageops::crop_imm(&rgb, x, y, cw, ch).to_image(),
                512,
                512,
                FilterType::Triangle,
            );
            let mut local = GrayImage::new(cw, ch);
            for &(xx, yy) in &marked {
                local.put_pixel(xx - x, yy - y, Luma([255]))
            }
            let mask = imageops::resize(&local, 512, 512, FilterType::Nearest);
            let data =
                Tensor::from_array(([1i64, 3, 512, 512], input(&crop, 512, 512, false, false)))
                    .map_err(|e| e.to_string())?;
            let mt = Tensor::from_array((
                [1i64, 1, 512, 512],
                mask.as_raw()
                    .iter()
                    .map(|v| *v as f32 / 255.)
                    .collect::<Vec<_>>(),
            ))
            .map_err(|e| e.to_string())?;
            stage("inpainting-text", i as u64, rects.len() as u64);
            let predictions = m
                .lama
                .as_mut()
                .unwrap()
                .run_with_options(ort::inputs!["image"=>data,"mask"=>mt], &run)
                .map_err(|e| e.to_string())?;
            let (_, v) = predictions[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            if v.len() != 3 * 512 * 512 {
                return Err("Invalid inpaint output.".into());
            }
            for &(xx, yy) in &marked {
                let pos = ((yy - y) * 512 / ch * 512 + (xx - x) * 512 / cw) as usize;
                let p = out.get_pixel_mut(xx, yy);
                for channel in 0..3 {
                    p[channel] = v[channel * 512 * 512 + pos].clamp(0., 255.) as u8;
                }
            }
            blocks[i]["eraseMethod"] = json!("lama")
        }
        for &(x, y) in &marked {
            erased.put_pixel(x, y, Luma([255]))
        }
        blocks[i]["applied"] = json!(true);
    }
    Ok((
        image::DynamicImage::ImageRgba8(out),
        image::DynamicImage::ImageLuma8(erased),
        json!({"sourceHash":hash,"unmatchedDialogueIds":dialogues.iter().filter(|d|!blocks.iter().any(|v|v["applied"]==true&&v["dialogueId"]==d["id"])).map(|d|&d["id"]).collect::<Vec<_>>(),"blocks":blocks}),
    ))
}
pub async fn job(
    c: Shared,
    app: AppHandle,
    k: String,
    b: V,
    token: tokio_util::sync::CancellationToken,
) -> E<V> {
    let model = model("comic-lettering")?;
    let dir = model_dir(&app, &model)?;
    let inner = app.state::<InferenceState>().inner.clone();
    let (op, _job) = start_job(&inner, &k, None, None)?;
    tauri::async_runtime::spawn_blocking(move||{if token.is_cancelled(){return Err(CANCELLED.into())}let record=read_record(&dir)?.ok_or("CACHE_MISSING")?;let folder=dir.join(record.generation);let env=environment(&inner,&c.resources.join("resources/runtime"))?;let mut slot=inner.ocr.lock().unwrap();if slot.is_none(){for f in &model.files{verify_file(&folder.join(&f.name),f,&op)?}*slot=Some(Models::new(&env,&folder)?)}if b["action"]=="load"{return Ok(json!({"loaded":true,"backend":"cpu"}))}let raw=s(&b,"image");let raw=STANDARD.decode(raw.split_once(',').map(|(_,d)|d).unwrap_or(raw)).map_err(|_|"Invalid image")?;let reader=image::ImageReader::new(Cursor::new(&raw)).with_guessed_format().map_err(|e|e.to_string())?;let(w,h)=reader.into_dimensions().map_err(|e|e.to_string())?;if w==0||h==0||u64::from(w)*u64::from(h)>16_777_216{return Err("Image too large".into())}let src=image::load_from_memory(&raw).map_err(|e|e.to_string())?;let(clean,mask,mut info)=rebuild(slot.as_mut().unwrap(),&env,src,&b,&op,|s,n,t|jobs::progress(&c,&k,s,n,t))?;op.check()?;let db=c.db.lock().unwrap();for (kind,img)in[("image",clean),("mask",mask)]{let mut buf=Cursor::new(vec![]);img.write_to(&mut buf,image::ImageFormat::Png).map_err(|e|e.to_string())?;info[kind]=crate::library::import(&c,&db,"outputs",&format!("comic_{kind}_{k}.png"),buf.get_ref(),&json!({"parameters":{"image_tool":"comic-lettering","comic_lettering_source_hash":info["sourceHash"]}})).map_err(|e|e.2)?}Ok(info)}).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod actual {
    use super::*;
    #[test]
    #[ignore = "requires verified CTD, RapidOCR and LaMa model files"]
    fn real_ocr_and_erase() {
        let folder = PathBuf::from(std::env::var("NOVELAI_OCR_FIXTURE").unwrap());
        let state = InferenceState::default();
        let env = environment(
            &state.inner,
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime"),
        )
        .unwrap();
        let mut m = Models::new(&env, &folder).unwrap();
        let img = image::open(folder.join("dialogue.png")).unwrap();
        let (op, _guard) =
            start_job(&state.inner, &uuid::Uuid::new_v4().to_string(), None, None).unwrap();
        let (copy, empty, first) = rebuild(
            &mut m,
            &env,
            img.clone(),
            &json!({"dialogues":[]}),
            &op,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(copy.to_rgba8(), img.to_rgba8());
        assert!(empty.to_luma8().pixels().all(|p| p[0] == 0));
        let blocks = first["blocks"].as_array().unwrap();
        eprintln!("Recognized blocks: {}", blocks.len());
        let line = blocks
            .iter()
            .find(|v| normalized(s(v, "ocrText")).contains("hello"))
            .expect("Model must recognize HELLO");
        let mut a = json!({});
        a[s(line, "id")] = json!({"action":"erase"});
        let (clean, mask, second) = rebuild(
            &mut m,
            &env,
            img.clone(),
            &json!({"assignments":a}),
            &op,
            |_, _, _| {},
        )
        .unwrap();
        assert!(second["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["applied"] == true));
        let erased = mask.to_luma8();
        assert!(erased.pixels().any(|p| p[0] > 0));
        let orig = img.to_rgba8();
        for (pos, p) in clean.to_rgba8().pixels().enumerate() {
            if erased.as_raw()[pos] == 0 {
                assert_eq!(
                    p.0,
                    <[u8; 4]>::try_from(&orig.as_raw()[pos * 4..pos * 4 + 4]).unwrap()
                )
            }
        }
    }
}
