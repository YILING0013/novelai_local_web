"use client";

import { useEditorText } from "./messages";

import { useRef } from "react";
import { RotateCcw } from "lucide-react";
import { IconButton } from "./Controls";

/** 编辑 RGB 总曲线或单色通道曲线；点击增加控制点，拖动调整，右键删除中间点。
 * @param {object} props 曲线控制点与预览、提交回调。
 * @returns {JSX.Element} 可拖动曲线编辑器。
 */
export default function Curves({ points, onPreview, onCommit, onReset, channel = "RGB", color = "#c6dccb" }) {
  const text = useEditorText();
  const drag = useRef(null),
    latest = useRef(points);
  latest.current = points;
  function position(event) {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      Math.round(
        Math.max(
          0,
          Math.min(255, ((event.clientX - box.left) / box.width) * 255),
        ),
      ),
      Math.round(
        Math.max(
          0,
          Math.min(255, 255 - ((event.clientY - box.top) / box.height) * 255),
        ),
      ),
    ];
  }
  return (
    <div className="curves-control">
      <div className="section-heading">
        <span>{text("曲线 ·")} {channel}</span>
        <IconButton icon={RotateCcw} label={`${text("重置曲线")}: ${channel}`} onClick={onReset} />
      </div>
      <svg
        aria-label={`${channel} ${text("曲线编辑器")}`}
        viewBox="0 0 255 255"
        preserveAspectRatio="none"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = position(event);
          let index = points.findIndex(
            (p) => Math.hypot(p[0] - point[0], p[1] - point[1]) < 14,
          );
          let next = points.map((p) => [...p]);
          if (
            index < 0 &&
            points.length < 16 &&
            point[0] > 0 &&
            point[0] < 255 &&
            !points.some((p) => Math.abs(p[0] - point[0]) < 3)
          ) {
            next.push(point);
            next.sort((a, b) => a[0] - b[0]);
            index = next.indexOf(point);
            onPreview(next);
            latest.current = next;
          }
          drag.current = index;
        }}
        onPointerMove={(event) => {
          if (drag.current === null || drag.current < 0) return;
          const next = latest.current.map((p) => [...p]),
            index = drag.current,
            point = position(event);
          point[0] =
            index === 0
              ? 0
              : index === next.length - 1
                ? 255
                : Math.max(
                    next[index - 1][0] + 1,
                    Math.min(next[index + 1][0] - 1, point[0]),
                  );
          next[index] = point;
          latest.current = next;
          onPreview(next);
        }}
        onPointerUp={() => {
          drag.current = null;
          onCommit();
        }}
        onPointerCancel={() => {
          drag.current = null;
          onCommit();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const point = position(event),
            index = points.findIndex(
              (p) => Math.hypot(p[0] - point[0], p[1] - point[1]) < 14,
            );
          if (index > 0 && index < points.length - 1) {
            onPreview(points.filter((_, i) => i !== index));
            onCommit();
          }
        }}
      >
        {[64, 128, 192].map((v) => (
          <g key={v}>
            <line x1={v} y1="0" x2={v} y2="255" />
            <line x1="0" y1={v} x2="255" y2={v} />
          </g>
        ))}
        <line className="curve-diagonal" x1="0" y1="255" x2="255" y2="0" />
        <polyline
          className="curve-path"
          style={{ stroke: color }}
          points={points.map(([x, y]) => `${x},${255 - y}`).join(" ")}
        />
        {points.map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={255 - y}
            r="4"
            style={{ fill: color }}
            tabIndex="0"
            role="slider"
            aria-label={`${channel} ${text("曲线控制点")} ${index + 1}`}
            aria-valuenow={y}
            aria-valuemin={0}
            aria-valuemax={255}
            onKeyDown={(event) => {
              if (["ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault();
                const next = points.map((p, i) =>
                  i === index
                    ? [
                        p[0],
                        Math.max(
                          0,
                          Math.min(
                            255,
                            p[1] + (event.key === "ArrowUp" ? 1 : -1),
                          ),
                        ),
                      ]
                    : p,
                );
                onPreview(next);
                onCommit();
              }
            }}
          />
        ))}
      </svg>
      <small>{text("点击添加 · 拖动调整 · 右键移除")}</small>
    </div>
  );
}
