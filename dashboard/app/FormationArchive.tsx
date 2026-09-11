"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import styles from "./formation-archive.module.css";

type Chapter = { id: string; title: string; text: string };
type MountedChapter = Chapter & { nodes: HTMLElement[] };
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
const queryWords = (query: string) => normalize(query).split(" ").filter(Boolean);

export function matchingArchiveChapters<T extends Chapter>(chapters: T[], query: string): T[] {
  const words = queryWords(query);
  return chapters.filter(chapter => words.every(word => normalize(`${chapter.title} ${chapter.text}`).includes(word)));
}

function matchExcerpt(chapter: Chapter, query: string) {
  const text = chapter.text.replace(/\s+/gu, " ").trim();
  const index = normalize(text).indexOf(queryWords(query)[0] ?? "");
  const start = Math.max(0, index - 35);
  const end = Math.min(text.length, start + 150);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function chapterTitle(node: HTMLElement) {
  const heading = node.querySelector<HTMLElement>(":scope > h2, :scope > h3, :scope > h4, :scope > summary, :scope > header h2, :scope > header h3, :scope > header h4, :scope > header > strong");
  return heading?.textContent?.trim() || (node.tagName === "DIV" ? "" : node.getAttribute("aria-label")) || "";
}

/** Index existing rendered records. No children are removed, copied or reparented. */
function readChapters(root: HTMLElement, prefix: string): MountedChapter[] {
  const groups: Array<{ title: string; nodes: HTMLElement[] }> = [];
  const visit = (node: HTMLElement) => {
    if (!node.textContent?.trim()) return;
    const title = chapterTitle(node);
    if (!title && ["DIV", "SECTION", "MAIN"].includes(node.tagName) && node.children.length) {
      Array.from(node.children).forEach(child => visit(child as HTMLElement));
      return;
    }
    if (title) groups.push({ title, nodes: [node] });
    else {
      const previous = groups.at(-1);
      if (previous?.title === "Общие сведения") previous.nodes.push(node);
      else groups.push({ title: "Общие сведения", nodes: [node] });
    }
  };
  Array.from(root.children).forEach(child => visit(child as HTMLElement));
  return groups.map((group, index) => {
    const first = group.nodes[0];
    if (!first.id) first.id = `${prefix}-chapter-${index + 1}`;
    return { id: first.id, title: group.title, nodes: group.nodes, text: group.nodes.map(node => node.textContent ?? "").join(" ") };
  });
}

function openAncestors(target: HTMLElement) {
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true;
  }
}

function queryTarget(chapter: MountedChapter, query: string) {
  const words = queryWords(query);
  if (!words.length) return chapter.nodes[0];
  const records = chapter.nodes.flatMap(node => [node, ...node.querySelectorAll<HTMLElement>("h2,h3,h4,p,li,td,dd,small,blockquote")]);
  // Prefer the smallest complete match so a source deep in a chapter is reachable.
  return records.filter(node => words.every(word => normalize(node.textContent ?? "").includes(word)))
    .sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0] ?? chapter.nodes[0];
}

export default function FormationArchive({ children }: { children: ReactNode }) {
  const prefix = useId().replace(/:/gu, "");
  const recordsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef<MountedChapter[]>([]);
  const selectedRef = useRef("");
  const queryRef = useRef("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");

  const applySelection = (id: string, queryText = queryRef.current) => {
    const matches = new Set(matchingArchiveChapters(mounted.current, queryText).map(chapter => chapter.id));
    for (const chapter of mounted.current) for (const node of chapter.nodes) {
      node.setAttribute("data-archive-hidden", String(!(matches.has(chapter.id) && (id === "*" || id === chapter.id))));
      node.setAttribute("data-archive-chapter", chapter.id);
    }
    selectedRef.current = id;
    setSelected(id);
  };

  useEffect(() => {
    const root = recordsRef.current;
    if (!root) return;
    const refresh = () => {
      for (const chapter of mounted.current) for (const node of chapter.nodes) {
        node.removeAttribute("data-archive-hidden");
        node.removeAttribute("data-archive-chapter");
      }
      mounted.current = readChapters(root, prefix);
      setChapters(mounted.current.map(({ id, title, text }) => ({ id, title, text })));
      const matches = matchingArchiveChapters(mounted.current, queryRef.current);
      const id = selectedRef.current === "*" ? "*" : matches.some(chapter => chapter.id === selectedRef.current) ? selectedRef.current : matches[0]?.id ?? "";
      const matchIds = new Set(matches.map(chapter => chapter.id));
      for (const chapter of mounted.current) for (const node of chapter.nodes) {
        node.setAttribute("data-archive-hidden", String(!(matchIds.has(chapter.id) && (id === "*" || id === chapter.id))));
        node.setAttribute("data-archive-chapter", chapter.id);
      }
      selectedRef.current = id;
      setSelected(id);
    };
    const reveal = (target: HTMLElement) => {
      const chapter = mounted.current.find(item => item.nodes.some(node => node === target || node.contains(target)));
      if (!chapter) return false;
      queryRef.current = "";
      setQuery("");
      selectedRef.current = chapter.id;
      setSelected(chapter.id);
      for (const item of mounted.current) for (const node of item.nodes) node.setAttribute("data-archive-hidden", String(item.id !== chapter.id));
      openAncestors(target);
      return true;
    };
    const hashTarget = (hash: string) => {
      try { return hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null; } catch { return null; }
    };
    const onDocumentClick = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("data-archive-chapter-link")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
      const target = hashTarget(url.hash);
      if (target && root.contains(target)) reveal(target);
    };
    const onHashChange = () => {
      const target = hashTarget(location.hash);
      if (target && root.contains(target) && reveal(target)) target.scrollIntoView({ block: "start" });
    };
    // The index depends on rendered component headings, including conditional records.
    const frame = requestAnimationFrame(() => { refresh(); onHashChange(); });
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [children, prefix]);

  const matches = matchingArchiveChapters(chapters, query);
  const updateQuery = (value: string) => {
    queryRef.current = value;
    setQuery(value);
    const next = matchingArchiveChapters(mounted.current, value);
    applySelection(next.some(chapter => chapter.id === selectedRef.current) ? selectedRef.current : next[0]?.id ?? "", value);
  };
  const reset = () => { updateQuery(""); inputRef.current?.focus(); };
  const showAll = () => { queryRef.current = ""; setQuery(""); applySelection("*", ""); };
  const selectChapter = (event: MouseEvent<HTMLAnchorElement>, chapter: Chapter) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    applySelection(chapter.id);
    const source = mounted.current.find(item => item.id === chapter.id);
    if (!source) return;
    const target = queryTarget(source, queryRef.current);
    openAncestors(target);
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.scrollIntoView({ block: "start" });
    target.focus({ preventScroll: true });
  };

  return <div className={styles.archive} data-formation-archive>
    <div className={styles.tools} role="search" aria-label="Поиск в архиве">
      <label htmlFor={`${prefix}-search`}>Найти в архиве</label>
      <input ref={inputRef} id={`${prefix}-search`} type="search" value={query} onChange={event => updateQuery(event.target.value)} placeholder="Название раздела или слова из записи" aria-controls={`${prefix}-records`} />
      {query && <button type="button" onClick={reset}>Сбросить поиск</button>}
      <button type="button" onClick={showAll}>Все разделы</button>
      <span role="status" aria-live="polite">{query ? `Найдено разделов: ${matches.length}` : ""}</span>
    </div>
    <div className={styles.layout}>
      <nav className={styles.chapters} aria-label="Разделы архива">
        {matches.map(chapter => <a key={chapter.id} href={`#${chapter.id}`} data-archive-chapter-link aria-current={selected === chapter.id ? "location" : undefined} onClick={event => selectChapter(event, chapter)}>{chapter.title}{query && <small>{matchExcerpt(chapter, query)}</small>}</a>)}
      </nav>
      <div className={styles.content}>
        {query && !matches.length && <p className={styles.empty}>Ничего не найдено. Измените запрос или сбросьте поиск.</p>}
        <div ref={recordsRef} id={`${prefix}-records`} className={styles.records}>{children}</div>
      </div>
    </div>
  </div>;
}
