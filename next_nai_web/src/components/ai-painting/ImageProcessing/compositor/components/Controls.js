"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useEditorText } from "./messages";

/** 带工具提示和无障碍名称的图标按钮。
 * @param {object} props 图标、名称与按钮属性。
 * @returns {JSX.Element} 按钮。
 */
export function IconButton({
  icon: Icon,
  label,
  active,
  className = "",
  ...props
}) {
  const text = useEditorText();
  const displayLabel = text(label);
  return (
    <button
      type="button"
      title={displayLabel}
      aria-label={displayLabel}
      aria-pressed={active === undefined ? undefined : active}
      className={`icon-button ${active ? "active" : ""} ${className}`}
      {...props}
    >
      <Icon size={17} strokeWidth={1.65} />
    </button>
  );
}

/** 数值字段在失焦或回车时提交，避免输入中间态产生错误历史。
 * @param {object} props 字段名称、数值、范围和提交事件。
 * @returns {JSX.Element} 数值输入框。
 */
export function NumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 1,
  suffix = "",
  disabled = false,
}) {
  const text = useEditorText();
  const displayLabel = text(label);
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  const submit = () => {
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) {
      const next = Math.max(min, Math.min(max, number));
      if (next !== value) onChange(next);
      setDraft(String(next));
    } else setDraft(String(value));
  };
  return (
    <label className="number-field">
      <span>{displayLabel}</span>
      <input
        aria-label={displayLabel}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      <small>{suffix}</small>
    </label>
  );
}

/** 连续调节时预览，在一次滑动结束后写入一条历史。
 * @param {object} props 数值范围与预览、提交回调。
 * @returns {JSX.Element} 滑杆。
 */
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  suffix = "",
  onPreview,
  onCommit,
}) {
  const text = useEditorText();
  const displayLabel = text(label);
  const original = useRef(value);
  return (
    <label className="slider-field">
      <span>
        {displayLabel}
        <output>
          {Math.round(value * 100) / 100}
          {suffix}
        </output>
      </span>
      <input
        aria-label={displayLabel}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => {
          original.current = value;
        }}
        onChange={(e) => onPreview(Number(e.target.value))}
        onPointerUp={(e) =>
          onCommit(Number(e.currentTarget.value), original.current)
        }
        onKeyDown={() => {
          original.current = value;
        }}
        onKeyUp={(e) =>
          onCommit(Number(e.currentTarget.value), original.current)
        }
      />
    </label>
  );
}

/** 模态窗口管理焦点和 Escape，键盘操作不会穿透编辑画布。
 * @param {object} props 标题、关闭回调和内容。
 * @returns {JSX.Element} 对话框。
 */
export function Modal({ title, onClose, children, wide = false }) {
  const text = useEditorText();
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    (node.querySelector("input, button, select, textarea") || node).focus();
    const handle = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab") {
        const items = [
          ...node.querySelectorAll(
            "button:not(:disabled), input:not(:disabled), textarea, select, a[href]",
          ),
        ];
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    node.addEventListener("keydown", handle);
    return () => {
      node.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={text(title)}
        className={`modal ${wide ? "wide" : ""}`}
        tabIndex={-1}
      >
        <header>
          <h2>{text(title)}</h2>
          <IconButton icon={X} label="关闭对话框" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
