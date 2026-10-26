import { useEffect, useState } from 'react'
import { LogoMark } from './Logo'
import { DOCS, DOCS_GROUPS, DOCS_UPDATED, DOCS_VERSION, docById, type Block, type DocSection } from '@/content/docs'

// ── Inline text parser ────────────────────────────────────────────────────────
// Supports `code`, **bold**, [label](href). No raw markdown remains after render.

type Span =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string }

function parseSpans(raw: string): Span[] {
  const spans: Span[] = []
  // Combined regex: backtick code, **bold**, [label](href)
  const re = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) spans.push({ kind: 'text', text: raw.slice(last, m.index) })
    // Links first, so a label may itself hold `code` or **bold**.
    if (m[1] !== undefined) spans.push({ kind: 'link', text: m[1], href: m[2] })
    else if (m[3] !== undefined) spans.push({ kind: 'code', text: m[3] })
    else spans.push({ kind: 'bold', text: m[4] })
    last = m.index + m[0].length
  }
  if (last < raw.length) spans.push({ kind: 'text', text: raw.slice(last) })
  return spans
}

function InlineText({ text }: { text: string }) {
  const spans = parseSpans(text)
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.text}</span>
        if (s.kind === 'code') return <code key={i} className="[overflow-wrap:anywhere] font-mono text-[0.88em] bg-ink/[0.07] rounded px-1 py-0.5">{s.text}</code>
        if (s.kind === 'bold') return <strong key={i}>{s.text}</strong>
        // link
        const label = <InlineText text={s.text} />
        return s.href.startsWith('#/')
          ? <a key={i} href={s.href} className="underline underline-offset-2 hover:text-serial">{label}</a>
          : <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-serial">{label}</a>
      })}
    </>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {}, // clipboard blocked: the code is still selectable
    )
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="serial text-[10px] tracking-[0.08em] px-2.5 py-1 rounded-full border border-paper/20 text-paper/85 hover:text-paper hover:border-paper/40 transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Block renderers ───────────────────────────────────────────────────────────

function BlockP({ text }: { text: string }) {
  return <p className="text-[16px] leading-[1.65] text-ink/90 my-4"><InlineText text={text} /></p>
}

function BlockH3({ text }: { text: string }) {
  return <h2 className="heading-tight text-[18px] text-ink mt-8 mb-3"><InlineText text={text} /></h2>
}

function BlockList({ items }: { items: string[] }) {
  return (
    <ul className="my-4 space-y-2 pl-5 list-disc marker:text-ink/80">
      {items.map((item, i) => (
        <li key={i} className="text-[16px] leading-[1.65] text-ink/90"><InlineText text={item} /></li>
      ))}
    </ul>
  )
}

function BlockSteps({ items }: { items: { title: string; text: string }[] }) {
  return (
    <ol className="my-4 space-y-5">
      {items.map((step, i) => (
        <li key={i} className="flex gap-4">
          <span className="serial text-[12px] text-serial flex-none pt-[3px]">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <p className="font-semibold text-[16px] text-ink mb-1">{step.title}</p>
            <p className="text-[16px] leading-[1.65] text-ink/80"><InlineText text={step.text} /></p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function BlockTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-[12px]" style={{ border: '1px solid rgba(11,42,33,0.10)' }}>
      <table className="w-full min-w-[34rem] text-[15px] text-left border-collapse">
        <thead>
          <tr className="bg-ink/[0.04] border-b border-ink/10">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold text-ink serial text-[12px] tracking-[0.06em] whitespace-nowrap">
                <InlineText text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0 border-ink/10">
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-3 text-ink/85 align-top leading-[1.5]"><InlineText text={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BlockNote({ tone, text }: { tone: 'info' | 'warn'; text: string }) {
  const isWarn = tone === 'warn'
  return (
    <div
      className="my-4 rounded-[12px] px-4 py-3.5 flex gap-3"
      style={{
        background: isWarn ? 'rgba(154,91,0,0.07)' : 'rgba(30,122,76,0.07)',
        border: isWarn ? '1px solid rgba(154,91,0,0.18)' : '1px solid rgba(30,122,76,0.18)',
      }}
    >
      <span
        className="serial text-[10px] font-medium flex-none pt-[3px] tracking-[0.08em]"
        style={{ color: isWarn ? '#9A5B00' : '#1E7A4C' }}
      >
        {isWarn ? 'HEADS UP' : 'NOTE'}
      </span>
      <p className="text-[15px] leading-[1.6] text-ink/85"><InlineText text={text} /></p>
    </div>
  )
}

function BlockCode({ code }: { code: string }) {
  return (
    <div className="my-4 rounded-[12px] overflow-hidden bg-ink" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-end px-4 py-2 border-b border-paper/10">
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto">
        <pre className="font-mono text-[13px] leading-relaxed text-paper/90 p-4 min-w-0" style={{ tabSize: 2 }}>
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

function BlockFlow({ label, nodes }: { label: string; nodes: { title: string; sub: string }[] }) {
  return (
    <div className="my-6">
      <p className="serial text-[11px] text-ink/80 mb-4 tracking-[0.08em]">{label}</p>
      <ol
        aria-label={label}
        className="flex flex-col lg:flex-row items-start lg:items-stretch gap-0"
      >
        {nodes.map((node, i) => (
          <li key={i} className="flex w-full flex-col items-center lg:w-auto lg:flex-1 lg:flex-row lg:items-stretch min-w-0">
            {/* Card */}
            <div
              className="w-full lg:flex-1 rounded-[14px] px-4 py-3.5 bg-surface text-center"
              style={{ border: '1px solid rgba(11,42,33,0.10)', boxShadow: '0 4px 12px -4px rgba(11,42,33,0.10)' }}
            >
              <p className="font-semibold text-[15px] text-ink">{node.title}</p>
              <p className="text-[13px] text-ink/80 mt-1 leading-snug">{node.sub}</p>
            </div>
            {/* Arrow between nodes */}
            {i < nodes.length - 1 && (
              <div className="flex-none self-center text-ink/80 text-[18px] my-1 lg:my-0 lg:mx-2 rotate-90 lg:rotate-0 select-none" aria-hidden="true">
                →
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function RenderBlock({ block }: { block: Block }) {
  switch (block.type) {
    case 'p':     return <BlockP text={block.text} />
    case 'h3':    return <BlockH3 text={block.text} />
    case 'list':  return <BlockList items={block.items} />
    case 'steps': return <BlockSteps items={block.items} />
    case 'table': return <BlockTable head={block.head} rows={block.rows} />
    case 'note':  return <BlockNote tone={block.tone} text={block.text} />
    case 'code':  return <BlockCode code={block.code} />
    case 'flow':  return <BlockFlow label={block.label} nodes={block.nodes} />
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ current }: { current: DocSection }) {
  // One list of links for every screen size: on phones it folds behind a toggle.
  // Keyed by section in DocsPage, so the phone menu closes on navigation.
  const [open, setOpen] = useState(false)
  return (
    <nav aria-label="Docs" className="w-full lg:w-[240px] shrink-0 lg:sticky lg:top-24">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="docs-contents"
        onClick={() => setOpen((o) => !o)}
        className="lg:hidden flex w-full items-center justify-between rounded-[14px] bg-surface px-4 py-3 text-[15px] font-semibold text-ink"
        style={{ border: '1px solid rgba(11,42,33,0.12)' }}
      >
        Contents
        <span aria-hidden="true" className={`text-ink/80 text-[12px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      <div id="docs-contents" className={`${open ? 'block' : 'hidden'} mt-2 rounded-[14px] bg-surface p-2 lg:mt-0 lg:block lg:bg-transparent lg:p-0`}>
        <SidebarLinks current={current} />
      </div>
    </nav>
  )
}

function SidebarLinks({ current }: { current: DocSection }) {
  return (
    <div className="space-y-5">
      {DOCS_GROUPS.map((group) => {
        const sections = DOCS.filter((d) => d.group === group)
        return (
          <div key={group}>
            <p className="serial text-[10px] text-ink/80 tracking-[0.12em] uppercase px-2 mb-1">{group}</p>
            <ul className="space-y-0.5">
              {sections.map((d) => (
                <li key={d.id}>
                  <a
                    href={`#/docs/${d.id}`}
                    aria-current={d.id === current.id ? 'page' : undefined}
                    className={[
                      'block px-2 py-1.5 rounded-[8px] text-[14px] leading-snug transition-colors',
                      d.id === current.id
                        ? 'bg-ink/[0.07] text-ink font-semibold'
                        : 'text-ink/80 hover:text-ink hover:bg-ink/[0.04]',
                    ].join(' ')}
                  >
                    {d.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function DocsPage({ section }: { section: string | undefined }) {
  const doc = docById(section)
  const idx = DOCS.indexOf(doc)
  const prev = idx > 0 ? DOCS[idx - 1] : null
  const next = idx < DOCS.length - 1 ? DOCS[idx + 1] : null

  useEffect(() => {
    window.scrollTo?.(0, 0)
  }, [section])

  return (
    <div className="min-h-dvh bg-paper text-ink">

      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur-sm border-b border-ink/20">
        <div className="mx-auto max-w-[1120px] flex items-center justify-between gap-4 px-4 sm:px-6 h-14">
          <a href="#/" className="inline-flex items-center gap-2.5 text-ink shrink-0">
            <LogoMark className="size-9" />
            <span className="sr-only sm:not-sr-only engraved text-[17px] tracking-[0.06em]" style={{ fontStretch: '125%' }}>ArcSlot</span>
          </a>
          <a
            href="#/app"
            className="inline-flex items-center h-9 px-5 rounded-full text-[14px] font-semibold text-paper bg-ink hover:bg-ink/90 transition-colors"
          >
            Open app
          </a>
        </div>
      </header>

      {/* Body: sidebar + article */}
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-10 flex flex-col lg:flex-row gap-10 lg:gap-16 lg:items-start">

        <Sidebar key={doc.id} current={doc} />

        {/* Article */}
        <main className="w-full flex-1 min-w-0 max-w-[72ch]">
          {/* Group label */}
          <p className="serial text-[11px] text-serial tracking-[0.12em] uppercase mb-3">{doc.group}</p>

          {/* Title */}
          <h1 className="heading-tight text-[32px] sm:text-[36px] leading-[1.05] text-ink mb-4">{doc.title}</h1>

          {/* Summary */}
          <p className="text-[18px] leading-[1.55] text-ink/80 mb-8 border-b border-ink/15 pb-8">{doc.summary}</p>

          {/* Blocks */}
          {doc.blocks.map((block, i) => (
            <RenderBlock key={i} block={block} />
          ))}

          {/* Prev / Next */}
          <div className="mt-12 pt-8 border-t border-ink/15 flex flex-col sm:flex-row gap-4 justify-between">
            {prev ? (
              <a
                href={`#/docs/${prev.id}`}
                className="group flex flex-col gap-0.5 text-left rounded-[12px] px-4 py-3 hover:bg-ink/[0.04] transition-colors"
                style={{ border: '1px solid rgba(11,42,33,0.10)' }}
              >
                <span className="serial text-[10px] text-ink/80 tracking-[0.08em]">← PREVIOUS</span>
                <span className="text-[15px] font-semibold text-ink group-hover:text-serial transition-colors">{prev.title}</span>
              </a>
            ) : <div />}
            {next ? (
              <a
                href={`#/docs/${next.id}`}
                className="group flex flex-col gap-0.5 text-right rounded-[12px] px-4 py-3 hover:bg-ink/[0.04] transition-colors"
                style={{ border: '1px solid rgba(11,42,33,0.10)' }}
              >
                <span className="serial text-[10px] text-ink/80 tracking-[0.08em]">NEXT →</span>
                <span className="text-[15px] font-semibold text-ink group-hover:text-serial transition-colors">{next.title}</span>
              </a>
            ) : <div />}
          </div>

          {/* Footer meta */}
          <p className="mt-8 serial text-[11px] text-ink/80 tracking-[0.06em]">
            Last updated {DOCS_UPDATED} · {DOCS_VERSION}
          </p>
        </main>
      </div>
    </div>
  )
}
