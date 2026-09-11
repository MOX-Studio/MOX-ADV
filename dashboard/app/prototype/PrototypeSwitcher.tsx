"use client";

import { useEffect } from "react";
import styles from "./prototype-switcher.module.css";

export type PrototypeVariant = {
  key: string;
  name: string;
  label?: string;
};

export default function PrototypeSwitcher({
  variants,
  current,
  onChange,
  ariaLabel = "Переключатель вариантов прототипа",
  previousLabel = "Предыдущий вариант",
  nextLabel = "Следующий вариант",
}: {
  variants: PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  previousLabel?: string;
  nextLabel?: string;
}) {
  const currentIndex = Math.max(0, variants.findIndex((variant) => variant.key === current));

  function cycle(direction: -1 | 1) {
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    onChange(variants[nextIndex].key);
  }

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      cycle(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (process.env.NODE_ENV === "production") return null;

  const variant = variants[currentIndex];
  return <aside className={styles.switcher} aria-label={ariaLabel}>
    <button type="button" onClick={() => cycle(-1)} aria-label={previousLabel}>←</button>
    <strong>{variant.label ?? `${variant.key} · ${variant.name}`}</strong>
    <button type="button" onClick={() => cycle(1)} aria-label={nextLabel}>→</button>
  </aside>;
}
