import type { ReactNode } from "react";

/**
 * Small, dependency-free Markdown renderer for blog posts (server or client).
 * Supports ## / ### headings, paragraphs, - and 1. lists, > quotes, ``` code
 * fences, **bold**, *italic*, `code` and [links](https://…). Everything is
 * rendered as React text — no HTML from the post is ever injected, and only
 * http(s), mailto and site-relative links are allowed.
 */

const INLINE = /(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;

function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href) ? href : null;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const token = m[0];
    if (m[1]) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (m[2]) out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    else if (m[3])
      out.push(
        <code key={key++} dir="ltr" className="rounded bg-mist px-1.5 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      const url = safeHref(href);
      out.push(
        url ? (
          <a key={key++} href={url} className="font-medium text-cobalt underline underline-offset-4 hover:text-ink" {...(/^https?:/.test(url) ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: "h2" | "h3" | "p" | "quote"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "code"; text: string };

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: heading[1].length === 2 ? "h2" : "h3", text: heading[2] });
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      blocks.push({ type: "quote", text: line.replace(/^>\s?/, "") });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      if (para.length) {
        blocks.push({ type: "p", text: para.join(" ") });
        para = [];
      }
      const type = ul ? "ul" : "ol";
      if (list && list.type !== type) {
        blocks.push(list);
        list = null;
      }
      list ??= { type, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (list) {
      blocks.push(list);
      list = null;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div className={`space-y-5 text-lg leading-relaxed text-ink/85 ${className}`}>
      {parse(source).map((block, i) => {
        switch (block.type) {
          case "h2":
            return (
              <h2 key={i} className="pt-6 text-2xl text-ink">
                {inline(block.text)}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="pt-3 text-xl text-ink">
                {inline(block.text)}
              </h3>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-s-4 border-cobalt/40 ps-5 text-ink/75 italic">
                {inline(block.text)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} dir="ltr" className="surface-ink overflow-x-auto rounded-2xl border border-mist bg-canvas p-5 text-sm text-ink">
                <code>{block.text}</code>
              </pre>
            );
          case "ul":
            return (
              <ul key={i} className="ms-6 list-disc space-y-2 marker:text-cobalt">
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="ms-6 list-decimal space-y-2 marker:font-semibold marker:text-cobalt">
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={i}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}
