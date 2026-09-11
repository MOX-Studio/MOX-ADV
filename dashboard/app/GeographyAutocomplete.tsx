"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { GeographyOption } from "../lib/geography-search.ts";
import styles from "./geography-autocomplete.module.css";

export default function GeographyAutocomplete({ defaultValue = "", disabled = false, validationError, onValueChange }: { defaultValue?: string; disabled?: boolean; validationError?: string; onValueChange?: (value: string) => void }) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [options, setOptions] = useState<GeographyOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selected = useRef(defaultValue);
  const focused = useRef(false);
  const query = value.trim();

  useEffect(() => {
    if (query.length < 2 || query.length > 100 || query === selected.current || disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setOpen(focused.current);
      fetch(`/api/p0/geography?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Не удалось загрузить варианты");
          const result = await response.json() as { options: GeographyOption[] };
          if (!Array.isArray(result.options)) throw new Error("Не удалось загрузить варианты");
          if (!controller.signal.aborted) { setOptions(result.options); setActive(result.options.length ? 0 : -1); }
        })
        .catch(() => { if (!controller.signal.aborted) setError("Не удалось загрузить варианты"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, disabled]);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);

  function choose(option: GeographyOption) {
    selected.current = option.name;
    setValue(option.name);
    onValueChange?.(option.name);
    setOpen(false);
    setOptions([]);
    setActive(-1);
    setLoading(false);
    setError("");
  }

  return <div className={styles.field}>
    <label htmlFor={id}>География клиентов</label>
    <input id={id} name="customer_geography" value={value} required maxLength={1000} disabled={disabled}
      aria-invalid={Boolean(validationError)} aria-describedby={validationError ? `${id}-validation-error` : undefined}
      role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`}
      aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
      autoComplete="off" onChange={(event) => {
        selected.current = ""; setValue(event.target.value); onValueChange?.(event.target.value); setOptions([]); setActive(-1); setError(""); setLoading(false); setOpen(false);
      }}
      onFocus={() => { focused.current = true; if (query.length >= 2 && (options.length || error)) setOpen(true); }}
      onBlur={() => { focused.current = false; setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); return; }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
          event.preventDefault(); setOpen(true);
          setActive((current) => event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length);
        }
        if (event.key === "Enter" && open && active >= 0 && options[active]) { event.preventDefault(); choose(options[active]); }
      }} />
    {validationError && <small id={`${id}-validation-error`} className="owner-goal-field-error" role="alert">{validationError}</small>}
    {open && <div className={styles.dropdown}>
      {loading ? <p role="status">Поиск…</p> : error ? <p role="status">{error}</p> : !options.length ? <p role="status">Нет подходящих вариантов</p> : null}
      <ul id={`${id}-options`} role="listbox" aria-label="Варианты географии">
        {options.map((option, index) => <li key={option.id} role="presentation">
          <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={active === index} tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
            <strong>{option.name}</strong>{option.context && <small>{option.context}</small>}
          </button>
        </li>)}
      </ul>
    </div>}
  </div>;
}
