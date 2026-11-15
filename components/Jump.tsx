"use client";
import { useEffect, useState } from "react";

// A row of chips that jump to each section on the page. It reads the section
// headings itself, so it never drifts out of step with what is on screen.
export default function Jump({ dep }: { dep: unknown }) {
  const [items, setItems] = useState<{ label: string; el: Element }[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const heads = Array.from(document.querySelectorAll("main .page > section > h2"));
    const list = heads.map((h) => ({
      label: (h.getAttribute("data-jump") || h.childNodes[0]?.textContent || "").trim(),
      el: h.parentElement as Element,
    })).filter((x) => x.label);
    setItems(list);
    if (!list.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(list.findIndex((x) => x.el === e.target));
        }
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );
    list.forEach((x) => io.observe(x.el));
    return () => io.disconnect();
  }, [dep]);

  if (items.length < 3) return null;
  return (
    <nav className="jump" aria-label="On this page">
      {items.map((x, i) => (
        <button key={x.label + i} aria-current={i === active ? "true" : undefined}
          onClick={() => x.el.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {x.label}
        </button>
      ))}
    </nav>
  );
}
