"use client";

import { useEditorText } from "./messages";

import { NumberField } from "./Controls";
import { DEFAULT_BRUSH, BRUSH_FIELDS } from "../lib/brushes";
import { SHAPES, SHAPE_TYPES } from "../lib/shapes";
import styles from "./ToolProperties.module.css";

const names = { brush: "画笔", eraser: "橡皮擦", clone: "仿制图章", blur: "模糊画笔", mosaic: "马赛克画笔", shape: "形状工具", text: "文字工具", gradient: "渐变工具", marquee: "框选工具", lasso: "套索工具", wand: "魔棒工具", crop: "裁剪工具", fill: "填充工具", eyedropper: "吸管工具" };

/** 跟随当前工具展示常用设置；创建工具同步新建默认值与当前匹配图层。
 * @param {object} props 当前工具、工具设置、选中图层与编辑回调。
 * @returns {JSX.Element} 侧栏工具属性。
 */
export default function ToolProperties({
  tool, brush, setBrush, openBrushSettings, mosaicSize, setMosaicSize,
  shape, setShape, shapeOptions, setShapeOptions, textOptions, setTextOptions,
  color, setColor, backColor, setBackColor, layer, updateLayer,
  selectionShape, setSelectionShape, selectionMode, setSelectionMode,
  tolerance, setTolerance, cropRatio, setCropRatio,
}) {
  const text = useEditorText();
  const painting = ["brush", "eraser", "clone", "blur", "mosaic"].includes(tool);
  const shapeLayer = tool === "shape" && SHAPE_TYPES.includes(layer?.type) ? layer : null;
  const textLayer = tool === "text" && layer?.type === "text" ? layer : null;
  const gradientLayer = tool === "gradient" && layer?.type === "gradient" ? layer : null;
  const currentShape = shapeLayer?.type || shape, currentText = textLayer || textOptions;
  const currentShapeOptions = shapeLayer ? { ...shapeOptions, ...shapeLayer } : shapeOptions;
  const setShapeValue = (key, value) => {
    setShapeOptions({ ...shapeOptions, [key]: value });
    if (shapeLayer) updateLayer({ [key]: value }, "修改形状参数");
  };
  const setTextValue = (key, value) => {
    setTextOptions({ ...textOptions, [key]: value });
    if (textLayer) updateLayer({ [key]: value }, "修改文字属性");
  };

  return (
    <section className={styles.panel} aria-label={text(names[tool])}>
      <div className={styles.heading}><strong>{text(names[tool])}</strong><span>{text("工具设置")}</span></div>
      {painting && <>
        {tool === "mosaic" && <NumberField label={text("马赛克块大小")} value={mosaicSize} min={2} max={128} suffix="px" onChange={(value) => setMosaicSize(Math.round(value))} />}
        {BRUSH_FIELDS.slice(0, 4).map(([key, label, min, max, unit]) => (
          <label className={styles.slider} key={key}>
            <span>{text(label)}<output>{brush[key]}{unit}</output></span>
            <input type="range" aria-label={text(label)} min={min} max={max} value={brush[key]}
              disabled={key === "hardness" && !!brush.tip}
              onChange={(event) => setBrush({ ...brush, [key]: Number(event.target.value) })} />
          </label>
        ))}
        {tool === "brush" && <label className={styles.color}>{text("绘制颜色")}<input type="color" aria-label={text("画笔绘制颜色")} value={color} onChange={(event) => setColor(event.target.value)} /><code>{color}</code></label>}
        <details className={styles.details}>
          <summary>{text("笔尖形状与动态")}</summary>
          {BRUSH_FIELDS.slice(4).map(([key, label, min, max, unit]) => (
            <label className={styles.slider} key={key}>
              <span>{text(label)}<output>{brush[key]}{unit}</output></span>
              <input type="range" aria-label={text(label)} min={min} max={max} value={brush[key]} onChange={(event) => setBrush({ ...brush, [key]: Number(event.target.value) })} />
            </label>
          ))}
          <label className={styles.check}><input type="checkbox" checked={brush.pressureSize} onChange={(event) => setBrush({ ...brush, pressureSize: event.target.checked })} />{text("压感控制大小")}</label>
        </details>
        <div className={styles.actions}>
          <button onClick={() => setBrush({ ...DEFAULT_BRUSH, hardness: 100 })}>{text("硬圆笔")}</button>
          <button onClick={() => setBrush({ ...DEFAULT_BRUSH, hardness: 0, flow: 35 })}>{text("柔圆笔")}</button>
          <button onClick={openBrushSettings}>{text("笔刷库与导入")}</button>
        </div>
        <p className={styles.note}>{text("笔尖：")}{brush.tip?.name || text("圆形")}。{tool === "clone" ? text("Alt 点击画布设定仿制源。") : tool === "mosaic" ? text("拖动涂抹分块；不透明度控制强度，硬度控制边缘。") : tool === "blur" ? text("拖动柔化细节，保留原有透明度。") : tool === "eraser" ? text("在当前图层擦除；编辑蒙版时隐藏对应区域。") : text("流量逐次积墨，不透明度限制整笔浓度。")}</p>
        <p className={styles.note}>{text("有选区时只处理选区内部。模糊和马赛克在编辑蒙版时仅处理蒙版。")}</p>
      </>}

      {tool === "shape" && <>
        <label className={styles.field}>{text("形状预设")}<select aria-label={text("工具形状类型")} value={currentShape} onChange={(event) => {
          const type = event.target.value;
          setShape(type);
          const radius = type === "roundRect" ? shapeOptions.radius || 24 : 0;
          if (["rect", "roundRect"].includes(type)) setShapeOptions({ ...shapeOptions, radius });
          if (shapeLayer) updateLayer({ type, radius, strokeWidth: type === "line" ? Math.max(1, shapeLayer.strokeWidth || 6) : shapeLayer.strokeWidth }, "更换形状");
        }}>{SHAPES.map(([type, name]) => <option key={type} value={type}>{text(name)}</option>)}</select></label>
        <p className={styles.note}>{shapeLayer ? text("正在修改选中的形状，设置也用于下次新建。") : text("拖动画布绘制形状，按 Shift 约束比例。")}</p>
        <label className={styles.color}>{text("填充")}<input type="color" aria-label={text("工具形状填充")} value={shapeLayer?.fill === "transparent" ? color : shapeLayer?.fill || color} onChange={(event) => {
          setColor(event.target.value); if (shapeLayer) updateLayer({ fill: event.target.value }, "修改形状填充");
        }} /></label>
        <label className={styles.color}>{text("描边")}<input type="color" aria-label={text("工具形状描边")} value={shapeLayer?.stroke || backColor} onChange={(event) => {
          setBackColor(event.target.value); if (shapeLayer) updateLayer({ stroke: event.target.value }, "修改形状描边");
        }} /></label>
        <NumberField label={text("形状描边宽度")} value={currentShapeOptions.strokeWidth} min={0} max={200} suffix="px" onChange={(value) => setShapeValue("strokeWidth", value)} />
        {["rect", "roundRect"].includes(currentShape) && <NumberField label={text("圆角半径")} value={currentShapeOptions.radius} min={0} max={500} suffix="px" onChange={(value) => setShapeValue("radius", value)} />}
        {currentShape === "star" && <>
          <NumberField label={text("星形角数")} value={currentShapeOptions.starPoints} min={3} max={20} onChange={(value) => setShapeValue("starPoints", Math.round(value))} />
          <NumberField label={text("星形内径")} value={currentShapeOptions.starInner} min={5} max={95} suffix="%" onChange={(value) => setShapeValue("starInner", value)} />
        </>}
        {currentShape === "arrow" && <>
          <NumberField label={text("箭头长度")} value={currentShapeOptions.arrowHead} min={5} max={95} suffix="%" onChange={(value) => setShapeValue("arrowHead", value)} />
          <NumberField label={text("箭杆宽度")} value={currentShapeOptions.arrowShaft} min={5} max={95} suffix="%" onChange={(value) => setShapeValue("arrowShaft", value)} />
        </>}
        {shapeLayer && <label className={styles.check}><input type="checkbox" checked={shapeLayer.fill === "transparent"} onChange={(event) => updateLayer({ fill: event.target.checked ? "transparent" : color }, "切换形状填充")} />{text("仅描边，无填充")}</label>}
      </>}

      {tool === "text" && <>
        <p className={styles.note}>{text("拖动创建任意大小的文字框；单击空白处创建默认框，双击已有文字编辑。文字在框内自动换行，超出高度的部分裁切。")}</p>
        {textLayer && <>
          <textarea key={`${textLayer.id}-${textLayer.text}`} aria-label={text("工具文字内容")} defaultValue={textLayer.text} rows={4} onBlur={(event) => {
            if (event.target.value !== textLayer.text) updateLayer({ text: event.target.value }, "修改文字");
          }} />
          <div className={styles.columns}>
            <NumberField label={text("文字框宽度")} value={textLayer.width} min={1} max={8192} suffix="px" onChange={(width) => updateLayer({ width }, "调整文字框")} />
            <NumberField label={text("文字框高度")} value={textLayer.height} min={1} max={8192} suffix="px" onChange={(height) => updateLayer({ height }, "调整文字框")} />
          </div>
        </>}
        <label className={styles.field}>{text("字体")}<select aria-label={text("工具字体")} value={currentText.fontFamily || "Arial"} onChange={(event) => setTextValue("fontFamily", event.target.value)}>
          {["Arial", "Georgia", "Verdana", "Times New Roman", "Courier New", "Microsoft YaHei", "SimSun"].map((family) => <option key={family}>{family}</option>)}
        </select></label>
        <div className={styles.columns}>
          <NumberField label={text("工具字号")} value={currentText.fontSize || 72} min={6} max={1000} suffix="px" onChange={(value) => setTextValue("fontSize", value)} />
          <NumberField label={text("工具行距")} value={currentText.lineHeight || 1.2} min={0.5} max={3} step={0.05} onChange={(value) => setTextValue("lineHeight", value)} />
        </div>
        <div className={styles.columns}>
          <label className={styles.field}>{text("字重")}<select aria-label={text("工具字重")} value={currentText.fontWeight || "400"} onChange={(event) => setTextValue("fontWeight", event.target.value)}><option value="400">{text("常规")}</option><option value="700">{text("粗体")}</option></select></label>
          <label className={styles.field}>{text("对齐")}<select aria-label={text("工具文字对齐")} value={currentText.align || "left"} onChange={(event) => setTextValue("align", event.target.value)}><option value="left">{text("左对齐")}</option><option value="center">{text("居中")}</option><option value="right">{text("右对齐")}</option></select></label>
        </div>
        <label className={styles.color}>{text("文字颜色")}<input type="color" aria-label={text("工具文字颜色")} value={textLayer?.fill || color} onChange={(event) => { setColor(event.target.value); if (textLayer) updateLayer({ fill: event.target.value }, "修改文字颜色"); }} /></label>
      </>}

      {tool === "gradient" && <>
        <p className={styles.note}>{text("拖动绘制渐变区域与方向。选择已有渐变图层可继续调整。")}</p>
        <label className={styles.color}>{text("起始颜色")}<input type="color" aria-label={text("工具渐变起始颜色")} value={gradientLayer?.fill || color} onChange={(event) => { setColor(event.target.value); if (gradientLayer) updateLayer({ fill: event.target.value }, "修改渐变颜色"); }} /></label>
        <label className={styles.color}>{text("结束颜色")}<input type="color" aria-label={text("工具渐变结束颜色")} value={gradientLayer?.endColor || backColor} onChange={(event) => { setBackColor(event.target.value); if (gradientLayer) updateLayer({ endColor: event.target.value }, "修改渐变颜色"); }} /></label>
        {gradientLayer && <>
          <label className={styles.field}>{text("渐变类型")}<select aria-label={text("工具渐变类型")} value={gradientLayer.gradientType || "linear"} onChange={(event) => updateLayer({ gradientType: event.target.value }, "修改渐变类型")}><option value="linear">{text("线性")}</option><option value="radial">{text("径向")}</option></select></label>
          <NumberField label={text("工具渐变角度")} value={gradientLayer.gradientAngle || 0} min={-180} max={180} suffix="°" onChange={(gradientAngle) => updateLayer({ gradientAngle }, "修改渐变角度")} />
        </>}
      </>}
      {["marquee", "lasso", "wand"].includes(tool) && <>
        {tool === "marquee" && <label className={styles.field}>{text("选区形状")}<select aria-label={text("工具选区形状")} value={selectionShape} onChange={(event) => setSelectionShape(event.target.value)}><option value="rect">{text("矩形")}</option><option value="ellipse">{text("椭圆")}</option></select></label>}
        <label className={styles.field}>{text("组合方式")}<select aria-label={text("工具选区组合")} value={selectionMode} onChange={(event) => setSelectionMode(event.target.value)}><option value="replace">{text("新选区")}</option><option value="add">{text("添加到选区")}</option><option value="subtract">{text("从选区减去")}</option></select></label>
        {tool === "wand" && <NumberField label={text("魔棒容差")} value={tolerance} min={0} max={255} onChange={setTolerance} />}
        <p className={styles.note}>{tool === "wand" ? text("点击选择与采样点颜色相近的连通区域。容差越大，接纳的色差越大。") : tool === "lasso" ? text("按住并拖动画出自由轮廓，松开后自动闭合。") : text("拖动绘制选区，Shift 可约束为正方形或正圆。")}{text("按 Shift 添加选区，Alt 从选区减去。")}</p>
      </>}
      {tool === "crop" && <>
        <label className={styles.field}>{text("裁剪比例")}<select aria-label={text("工具裁剪比例")} value={cropRatio} onChange={(event) => setCropRatio(event.target.value)}>{["free", "1:1", "3:2", "4:3", "16:9", "3:4", "9:16"].map((ratio) => <option key={ratio} value={ratio}>{ratio === "free" ? text("自由") : ratio}</option>)}</select></label>
        <p className={styles.note}>{text("拖动创建裁剪框，Enter 应用、Esc 取消。裁剪保留画布外的原始图层像素。")}</p>
      </>}
      {["fill", "eyedropper"].includes(tool) && <>
        <label className={styles.color}>{tool === "fill" ? text("填充颜色") : text("当前采样颜色")}<input type="color" aria-label={text("工具前景颜色")} value={color} onChange={(event) => setColor(event.target.value)} /><code>{color}</code></label>
        <p className={styles.note}>{tool === "fill" ? text("点击画布，使用前景色填充选区；未建立选区时填充当前图层。操作可撤销。") : text("点击画布，从当前合成图像中采样颜色并设为前景色。")}</p>
      </>}
    </section>
  );
}
