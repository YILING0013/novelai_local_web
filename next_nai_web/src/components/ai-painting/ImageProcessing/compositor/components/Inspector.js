"use client";

import { useEditorText } from "./messages";

import { useRef, useState } from "react";
import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  Layers,
  Sun,
  Contrast,
  Droplets,
  Palette,
  Sparkles,
} from "lucide-react";
import { IconButton, NumberField, Slider } from "./Controls";
import { DEFAULT_ADJUSTMENTS, GRADING_CHANNELS, GRADING_RANGES, HSL_CHANNELS, HSL_RANGES } from "../lib/model";
import { parseCubeLut } from "../lib/lut";
import { SHAPE_TYPES } from "../lib/shapes";
import Curves from "./Curves";
import AdjustmentPresets from "./AdjustmentPresets";
import styles from "./InspectorAdjustments.module.css";

const adjustmentGroups = [
  ["明暗", "按亮度分别控制亮部和暗部，正值提亮、负值压暗。", [
    ["exposure", "曝光", -3, 3, 0.05, " EV"],
    ["brightness", "亮度", -100, 100, 1, ""],
    ["contrast", "对比度", -100, 100, 1, ""],
    ["highlights", "高光", -100, 100, 1, ""],
    ["shadows", "阴影", -100, 100, 1, ""],
    ["whites", "白色", -100, 100, 1, ""],
    ["blacks", "黑色", -100, 100, 1, ""],
  ]],
  ["色彩", "自然饱和度优先增强柔和颜色；色调负值偏绿、正值偏洋红。", [
    ["saturation", "饱和度", -100, 200, 1, ""],
    ["vibrance", "自然饱和度", -100, 100, 1, ""],
    ["temperature", "色温", -100, 100, 1, ""],
    ["tint", "色调", -100, 100, 1, ""],
    ["hue", "色相", -180, 180, 1, "°"],
  ]],
  ["细节与光效", "锐化增强边缘，色差偏移红蓝通道，辉光柔化高光。", [
    ["sharpen", "锐化", 0, 100, 1, "%"],
    ["dehaze", "去朦胧", -100, 100, 1, ""],
    ["aberration", "色差", 0, 20, 1, " px"],
    ["bloom", "辉光", 0, 100, 1, "%"],
    ["blur", "高斯模糊", 0, 40, 0.5, " px"],
    ["noise", "颗粒", 0, 60, 1, ""],
    ["vignette", "暗角", 0, 100, 1, "%"],
    ["motion", "运动模糊", 0, 100, 1, " px"],
    ["motionAngle", "运动角度", -180, 180, 1, "°"],
  ]],
  ["输入色阶", "设置输入黑白点与中间调。", [
    ["black", "输入黑场", 0, 254, 1, ""],
    ["white", "输入白场", 1, 255, 1, ""],
    ["gamma", "中间调", 0.1, 4, 0.05, ""],
  ]],
];

const curveChannels = [
  ["curve", "RGB", "#c6dccb"], ["curveRed", "红", "#ee7775"],
  ["curveGreen", "绿", "#8fcf8c"], ["curveBlue", "蓝", "#83acf1"],
];

/** 属性与调色面板，所有改动通过文档事务回调写入。
 * @param {object} props 当前图层、文档和编辑回调。
 * @returns {JSX.Element} 属性面板。
 */
export default function Inspector({
  doc,
  layer,
  tab,
  update,
  preview,
  finishPreview,
  addAdjustment,
  openResize,
  maskEditing,
  setMaskEditing,
  maskAction,
  toolProperties,
  adjustmentTargetName,
  adjustmentTargets = [],
  onAdjustmentTargetChange,
}) {
  const text = useEditorText();
  const [hslChannel, setHslChannel] = useState("red");
  const [curveChannel, setCurveChannel] = useState("curve");
  const [gradingChannel, setGradingChannel] = useState("shadows");
  const [lutMessage, setLutMessage] = useState("");
  const [lutError, setLutError] = useState(false);
  const [lutLoading, setLutLoading] = useState(false);
  const lutInput = useRef(null), importContext = useRef(null);
  const a = layer ? { ...DEFAULT_ADJUSTMENTS, ...layer.adjustments } : null;
  const selectedBand = HSL_CHANNELS.find(({ key }) => key === hslChannel);
  const selectedGrading = GRADING_CHANNELS.find(({ key }) => key === gradingChannel);
  const selectedCurve = curveChannels.find(([key]) => key === curveChannel);
  importContext.current = { id: `${doc.id}:${layer?.id}`, layer, adjustments: a, update };
  return (
    <div className="inspector">
      <div className="inspector-scroll">
        {tab === "adjustments" ? (
          <>
            <div className="adjust-presets">
              {[
                [Sun, text("曝光"), { exposure: 0.35 }],
                [Contrast, text("黑白"), { grayscale: 1 }],
                [
                  Palette,
                  text("复古"),
                  { saturation: -25, temperature: 20, contrast: 12 },
                ],
                [Droplets, text("模糊"), { blur: 5 }],
                [Sparkles, text("胶片"), { noise: 14, contrast: 10, vignette: 25 }],
                [Layers, text("反相"), { invert: 1 }],
              ].map(([Icon, name, settings]) => (
                <button
                  key={name}
                  onClick={() => addAdjustment(name, settings)}
                  title={`${text("新建调整图层")}: ${name}`}
                >
                  <Icon size={18} />
                  <span>{name}</span>
                </button>
              ))}
            </div>
            {layer && layer.type !== "group" ? (
              <>
                <AdjustmentPresets adjustments={a} disabledApply={layer.locked} onApply={(values, label) => update({ adjustments: values }, label)} />
                <div className="section-heading">
                  <span>
                    {layer.type === "adjustment"
                      ? adjustmentTargetName ? `关联：${adjustmentTargetName}` : text("调整下方所有图层")
                      : text("为此图层添加独立调整")}
                  </span>
                  <IconButton
                    icon={RotateCcw}
                    label={text("重置调色")}
                    onClick={() =>
                      update(
                        { adjustments: { ...DEFAULT_ADJUSTMENTS } },
                        text("重置调色"),
                      )
                    }
                  />
                </div>
                {layer.type === "adjustment" && onAdjustmentTargetChange ? (
                  <label className={styles.targetField}>
                    <span>{text("调整目标")}</span>
                    <select aria-label={text("调整图层目标")} value={layer.targetId || ""} disabled={layer.locked}
                      onChange={(event) => onAdjustmentTargetChange(event.target.value)}>
                      <option value="">{text("下方全部图层")}</option>
                      {adjustmentTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                    </select>
                  </label>
                ) : layer.type !== "adjustment" && (
                  <p className={styles.help}>{text("修改参数会创建独立调整项。查看或保存已有调色效果，请先选中图层关联的调整项。")}</p>
                )}
                {adjustmentGroups.map(([name, help, fields], index) => (
                  <details className={styles.group} key={name} open={index === 0}>
                    <summary>{text(name)}</summary>
                    <p className={styles.help}>{text(help)}</p>
                    {fields.map(([key, label, min, max, step, suffix]) => (
                      <div className={styles.field} key={key}>
                        <Slider
                          label={label}
                          value={a[key]}
                          min={min}
                          max={max}
                          step={step}
                          suffix={suffix}
                          onPreview={(value) => preview({ adjustments: { ...a, [key]: value } })}
                          onCommit={finishPreview}
                        />
                        <div className={styles.range} aria-hidden="true"><span>{min}{suffix}</span><span>{max}{suffix}</span></div>
                      </div>
                    ))}
                  </details>
                ))}
                <details className={styles.group}>
                  <summary>{text("HSL 混色")}</summary>
                  <p className={styles.help}>{text("选择色带，分别调整该范围的色相、饱和度与明度。相邻颜色平滑过渡，灰阶保持中性。")}</p>
                  <div className={styles.hslChannels} role="group" aria-label={text("HSL 混色色带")}>
                    {HSL_CHANNELS.map(({ key, label, color }) => (
                      <button
                        type="button"
                        key={key}
                        aria-label={text(label)}
                        aria-pressed={hslChannel === key}
                        title={text(label)}
                        onClick={() => { finishPreview(); setHslChannel(key); }}
                      >
                        <span className={styles.hslColor} style={{ background: color }} />
                        <span>{text(label)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="section-heading">
                    <span>{text(selectedBand.label)}{text("混色")}</span>
                    <IconButton icon={RotateCcw} label={`${text("重置")} ${text(selectedBand.label)}`} onClick={() => update({
                      adjustments: {
                        ...a,
                        hsl: { ...a.hsl, [hslChannel]: { ...DEFAULT_ADJUSTMENTS.hsl[hslChannel] } },
                      },
                    }, `重置${selectedBand.label}混色`)} />
                  </div>
                  {[["hue", text("色相偏移"), "°"], ["saturation", text("饱和度"), "%"], ["lightness", text("明度"), "%"]].map(([key, label, suffix]) => (
                    <div className={styles.field} key={`${hslChannel}-${key}`}>
                      <Slider
                        label={`${text(selectedBand.label)} · ${label}`}
                        value={a.hsl[hslChannel][key]}
                        min={HSL_RANGES[key][0]}
                        max={HSL_RANGES[key][1]}
                        suffix={suffix}
                        onPreview={(value) => preview({
                          adjustments: {
                            ...a,
                            hsl: { ...a.hsl, [hslChannel]: { ...a.hsl[hslChannel], [key]: value } },
                          },
                        })}
                        onCommit={finishPreview}
                      />
                      <div className={styles.range} aria-hidden="true"><span>{HSL_RANGES[key][0]}{suffix}</span><span>{HSL_RANGES[key][1]}{suffix}</span></div>
                    </div>
                  ))}
                </details>
                <details className={styles.group}>
                  <summary>{text("色彩分级")}</summary>
                  <p className={styles.help}>{text("为阴影、中间调、高光或整体加入色彩。混合控制区域重叠，平衡控制明暗区域的占比。")}</p>
                  <div className={styles.channelTabs} role="group" aria-label={text("色彩分级区域")}>
                    {GRADING_CHANNELS.map(({ key, label }) => (
                      <button type="button" key={key} aria-pressed={gradingChannel === key}
                        onClick={() => { finishPreview(); setGradingChannel(key); }}>{text(label)}</button>
                    ))}
                  </div>
                  <div className="section-heading">
                    <span>{text(selectedGrading.label)}{text("分级")}</span>
                    <IconButton icon={RotateCcw} label={`${text("重置")} ${text(selectedGrading.label)}`} onClick={() => update({
                      adjustments: { ...a, grading: { ...a.grading, [gradingChannel]: { ...DEFAULT_ADJUSTMENTS.grading[gradingChannel] } } },
                    }, `重置${selectedGrading.label}分级`)} />
                  </div>
                  {[["hue", text("色相"), "°"], ["saturation", text("饱和度"), "%"], ["lightness", text("明度"), "%"]].map(([key, label, suffix]) => (
                    <Slider key={`${gradingChannel}-${key}`} label={`${text(selectedGrading.label)} · ${label}`}
                      value={a.grading[gradingChannel][key]} min={GRADING_RANGES[key][0]} max={GRADING_RANGES[key][1]} suffix={suffix}
                      onPreview={(value) => preview({ adjustments: {
                        ...a, grading: { ...a.grading, [gradingChannel]: { ...a.grading[gradingChannel], [key]: value } },
                      } })} onCommit={finishPreview} />
                  ))}
                  <Slider label={text("分级混合")} value={a.gradingBlending} min={0} max={100} suffix="%"
                    onPreview={(value) => preview({ adjustments: { ...a, gradingBlending: value } })} onCommit={finishPreview} />
                  <Slider label={text("分级平衡")} value={a.gradingBalance} min={-100} max={100}
                    onPreview={(value) => preview({ adjustments: { ...a, gradingBalance: value } })} onCommit={finishPreview} />
                </details>
                <details className={styles.group}>
                  <summary>3D LUT</summary>
                  <p className={styles.help}>{text("导入 .cube 色彩查找表，可调整强度。LUT 会完整保存到项目和后处理预设中。")}</p>
                  <div className={styles.lutActions}>
                    <button disabled={layer.locked || lutLoading} onClick={() => lutInput.current.click()}>{lutLoading ? text("正在读取…") : text("导入 .cube")}</button>
                    <button disabled={layer.locked || !a.lut || lutLoading} onClick={() => {
                      update({ adjustments: { ...a, lut: null } }, "移除 LUT");
                      setLutMessage("");
                    }}>{text("移除")}</button>
                  </div>
                  <input ref={lutInput} type="file" accept=".cube" hidden aria-label={text("导入 LUT 文件")} onChange={async (event) => {
                    const file = event.target.files[0];
                    event.target.value = "";
                    if (!file) return;
                    const selection = importContext.current.id;
                    setLutLoading(true);
                    try {
                      if (file.size > 32 * 1024 * 1024) throw new Error("LUT 文件不能超过 32 MB。");
                      const lut = parseCubeLut(await file.text(), file.name);
                      const current = importContext.current;
                      if (current.id !== selection || current.layer.locked) throw new Error("选中图层已切换或锁定，请在目标图层重新导入。");
                      current.update({ adjustments: { ...current.adjustments, lut, lutStrength: 100 } }, `导入 LUT · ${lut.name}`);
                      setLutMessage(`已导入 ${lut.name}。`);
                      setLutError(false);
                    } catch (failure) {
                      setLutMessage(failure.message);
                      setLutError(true);
                    } finally {
                      setLutLoading(false);
                    }
                  }} />
                  {a.lut && <>
                    <p className={styles.lutMeta}>{a.lut.name}<span>{a.lut.size} × {a.lut.size} × {a.lut.size}</span></p>
                    <Slider label={text("LUT 强度")} value={a.lutStrength} min={0} max={100} suffix="%"
                      onPreview={(value) => preview({ adjustments: { ...a, lutStrength: value } })} onCommit={finishPreview} />
                  </>}
                  {lutMessage && <p className={`${styles.help} ${lutError ? styles.error : ""}`} role={lutError ? "alert" : "status"}>{lutMessage}</p>}
                </details>
                <details className={styles.group}>
                  <summary>{text("曲线与映射")}</summary>
                  <div className={styles.channelTabs} role="group" aria-label={text("曲线通道")}>
                    {curveChannels.map(([key, label, color]) => (
                      <button key={key} type="button" aria-pressed={curveChannel === key} style={{ color }}
                        onClick={() => { finishPreview(); setCurveChannel(key); }}>{text(label)}</button>
                    ))}
                  </div>
                  <Curves
                    points={a[curveChannel]}
                    channel={text(selectedCurve[1])}
                    color={selectedCurve[2]}
                    onPreview={(points) =>
                      preview({ adjustments: { ...a, [curveChannel]: points } })
                    }
                    onCommit={finishPreview}
                    onReset={() =>
                      update(
                        {
                          adjustments: {
                            ...a,
                            [curveChannel]: [
                              [0, 0],
                              [255, 255],
                            ],
                          },
                        },
                        `重置${selectedCurve[1]}曲线`,
                      )
                    }
                  />
                  <div className={styles.mappingToggles}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!a.grayscale}
                        onChange={(e) =>
                          update(
                            {
                              adjustments: {
                                ...a,
                                grayscale: Number(e.target.checked),
                              },
                            },
                            text("黑白"),
                          )
                        }
                      />
                      {text("黑白")}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!a.invert}
                        onChange={(e) =>
                          update(
                            {
                              adjustments: {
                                ...a,
                                invert: Number(e.target.checked),
                              },
                            },
                            text("反相"),
                          )
                        }
                      />
                      {text("反相")}
                    </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={a.duotone}
                      onChange={(e) =>
                        update(
                          { adjustments: { ...a, duotone: e.target.checked } },
                          text("渐变映射"),
                        )
                      }
                    />
                    {text("渐变映射")}
                  </label>
                  </div>
                  {a.duotone && (
                    <div className="color-row">
                      <label>
                        {text("暗部")}
                        <input
                          aria-label={text("映射暗部")}
                          type="color"
                          value={a.shadowColor}
                          onChange={(e) =>
                            update(
                              {
                                adjustments: {
                                  ...a,
                                  shadowColor: e.target.value,
                                },
                              },
                              text("渐变映射"),
                            )
                          }
                        />
                      </label>
                      <label>
                        {text("亮部")}
                        <input
                          aria-label={text("映射亮部")}
                          type="color"
                          value={a.highlightColor}
                          onChange={(e) =>
                            update(
                              {
                                adjustments: {
                                  ...a,
                                  highlightColor: e.target.value,
                                },
                              },
                              text("渐变映射"),
                            )
                          }
                        />
                      </label>
                    </div>
                  )}
                </details>
              </>
            ) : (
              <p className="panel-empty">
                {text("选择一个图层进行调色，或添加调整图层。")}
              </p>
            )}
          </>
        ) : toolProperties ? toolProperties : layer ? (
          <>
            <div className="section-heading">
              <span>
                {layer.type === "group"
                  ? text("文件夹")
                  : layer.type === "adjustment"
                    ? text("调整图层")
                    : text("变换")}
              </span>
              <small>
                {layer.type === "raster"
                  ? text("像素图层")
                  : layer.type === "text"
                    ? text("文字图层")
                    : text("可编辑")}
              </small>
            </div>
            {!["group", "adjustment"].includes(layer.type) && (
              <>
                <div className="fields-grid">
                  <NumberField
                    label="X"
                    value={layer.x}
                    onChange={(x) => update({ x }, "移动图层")}
                    suffix="px"
                  />
                  <NumberField
                    label="Y"
                    value={layer.y}
                    onChange={(y) => update({ y }, "移动图层")}
                    suffix="px"
                  />
                  <NumberField
                    label={text("宽")}
                    value={layer.width}
                    min={1}
                    max={8192}
                    onChange={(width) => update({ width }, "调整宽度")}
                    suffix="px"
                  />
                  <NumberField
                    label={text("高")}
                    value={layer.height}
                    min={1}
                    max={8192}
                    onChange={(height) => update({ height }, "调整高度")}
                    suffix="px"
                  />
                  <NumberField
                    label={text("角度")}
                    value={layer.rotation}
                    min={-360}
                    max={360}
                    onChange={(rotation) => update({ rotation }, "旋转图层")}
                    suffix="°"
                  />
                  <div className="transform-actions">
                    <IconButton
                      icon={FlipHorizontal2}
                      label={text("水平翻转图层")}
                      onClick={() =>
                        update({ flipX: !layer.flipX }, text("水平翻转"))
                      }
                    />
                    <IconButton
                      icon={FlipVertical2}
                      label={text("垂直翻转图层")}
                      onClick={() =>
                        update({ flipY: !layer.flipY }, text("垂直翻转"))
                      }
                    />
                  </div>
                </div>
                <div className="alignment-row">
                  <span>{text("对齐画布")}</span>
                  <button onClick={() => update({ x: 0 }, text("左对齐"))}>{text("左")}</button>
                  <button
                    onClick={() =>
                      update({ x: (doc.width - layer.width) / 2 }, "水平居中")
                    }
                  >
                    {text("中")}
                  </button>
                  <button
                    onClick={() =>
                      update({ x: doc.width - layer.width }, text("右对齐"))
                    }
                  >
                    {text("右")}
                  </button>
                  <button
                    onClick={() =>
                      update({ y: (doc.height - layer.height) / 2 }, "垂直居中")
                    }
                  >
                    {text("垂直")}
                  </button>
                </div>
              </>
            )}
            {layer.type === "text" && (
              <>
                <div className="section-heading">
                  <span>{text("文字")}</span>
                </div>
                <textarea
                  className="text-content"
                  aria-label={text("文字内容")}
                  value={layer.text}
                  onChange={(e) => preview({ text: e.target.value })}
                  onBlur={finishPreview}
                />
                <select
                  aria-label={text("字体")}
                  value={layer.fontFamily}
                  onChange={(e) =>
                    update({ fontFamily: e.target.value }, "修改字体")
                  }
                >
                  {[...new Set([
                    layer.fontFamily,
                    "Arial",
                    "Georgia",
                    "Verdana",
                    "Times New Roman",
                    "Courier New",
                    "Microsoft YaHei",
                    "SimSun",
                  ])].map((font) => (
                    <option key={font}>{font}</option>
                  ))}
                </select>
                <div className="fields-grid">
                  <NumberField
                    label={text("字号")}
                    value={layer.fontSize}
                    min={6}
                    max={1000}
                    onChange={(fontSize) => update({ fontSize }, "修改字号")}
                  />
                  <NumberField
                    label={text("行距")}
                    value={layer.lineHeight || 1.2}
                    min={0.5}
                    max={3}
                    step={0.05}
                    onChange={(lineHeight) =>
                      update({ lineHeight }, "修改行距")
                    }
                  />
                </div>
                <div className="toggle-row">
                  <select
                    aria-label={text("字重")}
                    value={layer.fontWeight || "400"}
                    onChange={(e) =>
                      update({ fontWeight: e.target.value }, "修改字重")
                    }
                  >
                    <option value="400">{text("常规")}</option>
                    <option value="700">{text("粗体")}</option>
                  </select>
                  <select
                    aria-label={text("文字对齐")}
                    value={layer.align || "left"}
                    onChange={(e) =>
                      update({ align: e.target.value }, text("文字对齐"))
                    }
                  >
                    <option value="left">{text("左对齐")}</option>
                    <option value="center">{text("居中")}</option>
                    <option value="right">{text("右对齐")}</option>
                  </select>
                </div>
              </>
            )}
            {["text", "gradient", ...SHAPE_TYPES].includes(
              layer.type,
            ) && (
              <>
                <div className="section-heading">
                  <span>{text("外观")}</span>
                </div>
                <div className="color-row">
                  <label>
                    {text("填充")}
                    <input
                      aria-label={text("图层填充颜色")}
                      type="color"
                      value={
                        layer.fill === "transparent" ? "#000000" : layer.fill
                      }
                      onChange={(e) =>
                        update({ fill: e.target.value }, "修改填充")
                      }
                    />
                  </label>
                  <code>{layer.fill.toUpperCase()}</code>
                </div>
                {SHAPE_TYPES.includes(layer.type) && (
                  <>
                    <div className="color-row">
                      <label>
                        {text("描边")}
                        <input
                          aria-label={text("描边颜色")}
                          type="color"
                          value={layer.stroke}
                          onChange={(e) =>
                            update({ stroke: e.target.value }, "修改描边")
                          }
                        />
                      </label>
                      <NumberField
                        label={text("线宽")}
                        value={layer.strokeWidth}
                        min={0}
                        max={200}
                        onChange={(strokeWidth) =>
                          update({ strokeWidth }, "修改描边")
                        }
                      />
                    </div>
                    {["rect", "roundRect"].includes(layer.type) && (
                      <NumberField
                        label={text("圆角")}
                        value={layer.radius}
                        min={0}
                        max={500}
                        onChange={(radius) => update({ radius }, "修改圆角")}
                      />
                    )}
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={layer.fill === "transparent"}
                        onChange={(e) =>
                          update(
                            {
                              fill: e.target.checked
                                ? "transparent"
                                : "#eac6a0",
                            },
                            "切换填充",
                          )
                        }
                      />
                      {text("无填充")}
                    </label>
                  </>
                )}
                {layer.type === "gradient" && (
                  <>
                    <div className="color-row">
                      <label>
                        {text("终点色")}
                        <input
                          aria-label={text("渐变终点色")}
                          type="color"
                          value={layer.endColor}
                          onChange={(e) =>
                            update({ endColor: e.target.value }, text("渐变终点色"))
                          }
                        />
                      </label>
                      <select
                        aria-label={text("渐变类型")}
                        value={layer.gradientType || "linear"}
                        onChange={(e) =>
                          update({ gradientType: e.target.value }, text("渐变类型"))
                        }
                      >
                        <option value="linear">{text("线性")}</option>
                        <option value="radial">{text("径向")}</option>
                      </select>
                    </div>
                    <NumberField
                      label={text("渐变角度")}
                      value={layer.gradientAngle || 0}
                      min={-360}
                      max={360}
                      onChange={(gradientAngle) =>
                        update({ gradientAngle }, text("渐变角度"))
                      }
                    />
                  </>
                )}
              </>
            )}
            {!["group", "adjustment"].includes(layer.type) && (
              <>
                <div className="section-heading">
                  <span>{text("图层效果")}</span>
                  <small>{text("非破坏")}</small>
                </div>
                <Slider
                  label={text("投影模糊")}
                  value={layer.effects.shadow}
                  max={100}
                  onPreview={(shadow) =>
                    preview({ effects: { ...layer.effects, shadow } })
                  }
                  onCommit={finishPreview}
                />
                <Slider
                  label={text("外发光")}
                  value={layer.effects.glow}
                  max={80}
                  onPreview={(glow) =>
                    preview({ effects: { ...layer.effects, glow } })
                  }
                  onCommit={finishPreview}
                />
                <div className="color-row">
                  <label>
                    {text("颜色叠加")}
                    <input
                      aria-label={text("颜色叠加")}
                      type="color"
                      value={layer.effects.overlay || "#ffffff"}
                      onChange={(e) =>
                        update(
                          {
                            effects: {
                              ...layer.effects,
                              overlay: e.target.value,
                            },
                          },
                          text("颜色叠加"),
                        )
                      }
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() =>
                      update(
                        { effects: { ...layer.effects, overlay: "" } },
                        "清除颜色叠加",
                      )
                    }
                  >
                    {text("清除")}
                  </button>
                </div>
              </>
            )}
            {layer.mask && (
              <>
                <div className="section-heading">
                  <span>{text("图层蒙版")}</span>
                </div>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={maskEditing}
                    onChange={(e) => setMaskEditing(e.target.checked)}
                  />
                  {text("用画笔编辑蒙版")}
                </label>
                <div className="toggle-row">
                  <button onClick={() => maskAction("invert")}>{text("反相")}</button>
                  <button onClick={() => maskAction("toggle")}>
                    {layer.maskEnabled ? text("禁用") : text("启用")}
                  </button>
                  <button onClick={() => maskAction("remove")}>{text("删除")}</button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="panel-empty">
            <Layers size={28} />
            <p>{text("选择图层查看属性")}</p>
            <small>{text("在画布上点击，或从下方图层列表选择。")}</small>
          </div>
        )}
        <div className="document-info">
          <div className="section-heading">
            <span>{text("文档")}</span>
            <button className="text-button" onClick={openResize}>
              {text("调整尺寸")}
            </button>
          </div>
          <div>
            <span>
              {doc.width} × {doc.height} px
            </span>
            <small>sRGB · 8 bit</small>
          </div>
        </div>
      </div>
    </div>
  );
}
