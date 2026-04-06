import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

interface NavItem {
  title: string;
  path: string;
  children?: NavItem[];
}

const NAV: NavItem[] = [
  {
    title: "Getting Started",
    path: "/docs",
    children: [
      { title: "Introduction", path: "/docs" },
      { title: "Quickstart", path: "/docs/quickstart" },
      { title: "Installation", path: "/docs/installation" },
    ],
  },
  {
    title: "Core Concepts",
    path: "/docs/concepts",
    children: [
      { title: "Agents", path: "/docs/concepts/agents" },
      { title: "Quests", path: "/docs/concepts/quests" },
      { title: "Memory", path: "/docs/concepts/memory" },
      { title: "Companies", path: "/docs/concepts/companies" },
    ],
  },
  {
    title: "Platform",
    path: "/docs/platform",
    children: [
      { title: "Dashboard", path: "/docs/platform/dashboard" },
      { title: "Sessions", path: "/docs/platform/sessions" },
      { title: "MCP Integration", path: "/docs/platform/mcp" },
    ],
  },
  {
    title: "Self-Hosting",
    path: "/docs/self-hosting",
    children: [
      { title: "Configuration", path: "/docs/self-hosting/configuration" },
      { title: "Deployment", path: "/docs/self-hosting/deployment" },
    ],
  },
];

function NavTree({ items, location }: { items: NavItem[]; location: string }) {
  return (
    <div className="space-y-6">
      {items.map((section) => (
        <div key={section.path}>
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-black/30 mb-2">
            {section.title}
          </div>
          <div className="space-y-0.5">
            {section.children?.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`block text-[13px] py-1.5 px-3 rounded-lg transition-colors ${
                  location === item.path
                    ? "text-black/85 bg-black/[0.04] font-medium"
                    : "text-black/45 hover:text-black/70 hover:bg-black/[0.02]"
                }`}
              >
                {item.title}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Minimap({ items, activeId }: { items: TOCItem[]; activeId: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-black/25 mb-3">
        On this page
      </div>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`block text-[12px] py-0.5 transition-colors ${
            item.level > 2 ? "pl-3" : ""
          } ${
            activeId === item.id
              ? "text-black/70 font-medium"
              : "text-black/30 hover:text-black/50"
          }`}
        >
          {item.text}
        </a>
      ))}
    </div>
  );
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [activeId, setActiveId] = useState("");

  // Extract TOC from rendered content
  useEffect(() => {
    if (!contentRef.current) return;
    const headings = contentRef.current.querySelectorAll("h2, h3");
    const items: TOCItem[] = Array.from(headings).map((h) => ({
      id: h.id || h.textContent?.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "",
      text: h.textContent || "",
      level: parseInt(h.tagName[1]),
    }));
    // Set IDs on headings that don't have them
    headings.forEach((h, i) => {
      if (!h.id && items[i]) h.id = items[i].id;
    });
    setToc(items);
  }, [location.pathname, children]);

  // Track active heading on scroll
  useEffect(() => {
    if (toc.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    toc.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [toc]);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/[0.06]">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/" className="text-[18px] font-bold tracking-[-0.08em] text-black/70 hover:text-black/90 transition-colors leading-none flex items-center">
              æq<span className="inline-block translate-y-[0.04em]">i</span>
            </Link>
            <span className="text-black/15 text-[16px] font-light leading-none">/</span>
            <span className="text-[13px] text-black/40 font-medium leading-none">Docs</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://app.aeqi.ai/login" className="text-[13px] text-black/40 hover:text-black/70 transition-colors">
              Log in
            </a>
            <a href="https://app.aeqi.ai/signup" className="text-[13px] bg-black text-white rounded-lg px-3 py-1.5 font-medium hover:bg-black/85 transition-colors">
              Sign up
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">
        {/* Left sidebar */}
        <aside className="w-56 flex-shrink-0 border-r border-black/[0.04] py-8 px-4 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto hidden lg:block">
          <a
            href="https://github.com/aeqiai/aeqi"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 text-[13px] text-black/45 hover:text-black/70 transition-colors px-3 py-2 rounded-lg hover:bg-black/[0.02] mb-6"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
          <NavTree items={NAV} location={location.pathname} />
        </aside>

        {/* Content */}
        <main ref={contentRef} className="flex-1 min-w-0 py-10 px-8 lg:px-16 max-w-3xl">
          <article className="docs-content">
            {children}
          </article>
        </main>

        {/* Right minimap */}
        <aside className="w-48 flex-shrink-0 py-10 px-4 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto hidden xl:block">
          <Minimap items={toc} activeId={activeId} />
        </aside>
      </div>
    </div>
  );
}
