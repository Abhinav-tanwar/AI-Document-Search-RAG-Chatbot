import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Layers,
  LoaderCircle,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

type Source = {
  number: number;
  document_id: string;
  name: string;
  page: number;
  text: string;
  score: number | null;
};
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  demo?: boolean;
  warning?: boolean;
};
type Doc = { id: string; name: string; pages: number; chunks: number };
const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
async function request(path: string, options?: RequestInit) {
  const response = await fetch(BASE + path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "The request could not be completed. Please try again.",
    );
  }
  return response.status === 204 ? null : response.json();
}
export default function App() {
  const [docs, setDocs] = useState<Doc[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [configured, setConfigured] = useState(false),
    [online, setOnline] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [setup, setSetup] = useState(false),
    [active, setActive] = useState<Source | null>(null);
  const [tab, setTab] = useState<"chat" | "sources">("chat"),
    [demo, setDemo] = useState(false),
    [menu, setMenu] = useState(false);
  const [model, setModel] = useState("OpenAI"),
    [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null);
  async function refresh() {
    try {
      const health = await request("/api/health");
      setConfigured(health.configured);
      setModel(health.model);
      setOnline(true);
      const list: Doc[] = await request("/api/documents");
      setDocs(list);
      setSelected(list.map((d) => d.id));
    } catch {
      setOnline(false);
      setError(
        "The Python backend is offline. Start it using the instructions in README.md.",
      );
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!setup) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSetup(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".setup-modal button:not(:disabled), .setup-modal a[href]",
        ),
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [setup]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  const allSources = messages.flatMap((m) => m.sources || []);
  const sources = [
    ...new Map(
      allSources.map((s) => [`${s.document_id}-${s.page}-${s.text}`, s]),
    ).values(),
  ];
  async function loadDemo() {
    setBusy(true);
    setError("");
    try {
      const d = await request("/api/demo");
      setMessages([
        { role: "user", content: d.question, demo: true },
        {
          role: "assistant",
          content: d.answer,
          sources: d.sources,
          demo: true,
        },
      ]);
      setDemo(true);
      setTab("chat");
      setActive(d.sources[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (!configured) {
      setSetup(true);
      return;
    }
    setUploading(true);
    setError("");
    setMessages([]);
    setActive(null);
    setDemo(false);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024)
          throw new Error(`${file.name} exceeds the 20 MB limit.`);
        const data = new FormData();
        data.append("file", file);
        await request("/api/documents", { method: "POST", body: data });
      }
      setDemo(false);
      setMessages([]);
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await refresh();
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function remove(doc: Doc) {
    if (
      !window.confirm(
        `Delete “${doc.name}” and its searchable text from this local library?`,
      )
    )
      return;
    setError("");
    try {
      await request(`/api/documents/${doc.id}`, { method: "DELETE" });
      setDocs(docs.filter((d) => d.id !== doc.id));
      setSelected(selected.filter((id) => id !== doc.id));
      setMessages([]);
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    if (!configured) {
      setSetup(true);
      return;
    }
    if (!selected.length) {
      setError("Select at least one indexed document first.");
      return;
    }
    const q = question.trim();
    const history = demo ? [] : messages;
    setDemo(false);
    setMessages([...history, { role: "user", content: q }]);
    setQuestion("");
    setBusy(true);
    setError("");
    try {
      const data = await request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          document_ids: selected,
          history: history
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      setMessages([
        ...history,
        { role: "user", content: q },
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources,
          warning: data.citation_warning,
        },
      ]);
      if (data.sources.length) setActive(data.sources[0]);
    } catch (e) {
      setMessages(history);
      setQuestion(q);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Layers size={23} />
          </div>
          <span>
            AI Document Search<small>RAG CHATBOT</small>
          </span>
          <button
            className="icon-button mobile-close"
            aria-label="Close sidebar"
            onClick={() => setMenu(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <button
          className="nav-item current"
          onClick={() => {
            setTab("chat");
            setMenu(false);
          }}
        >
          <BookOpen size={18} /> Document chat{" "}
          <span className="nav-count">{docs.length}</span>
        </button>
        <div className="section-line">
          <span>YOUR LIBRARY</span>
          <span>{docs.length.toString().padStart(2, "0")}</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          aria-label="Upload PDF files"
          onChange={(e) => void upload(e.target.files)}
        />
        <button
          className="upload-button"
          disabled={busy || uploading || !online}
          onClick={() =>
            configured ? fileRef.current?.click() : setSetup(true)
          }
        >
          {uploading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Plus size={18} />
          )}{" "}
          {uploading ? "Indexing PDFs…" : "Add documents"}
        </button>
        <p className="upload-hint">PDF files · up to 20 MB each</p>
        <div className="document-list">
          {docs.map((d) => (
            <div className="document-row" key={d.id}>
              <input
                type="checkbox"
                aria-label={`Include ${d.name}`}
                checked={selected.includes(d.id)}
                disabled={busy || uploading}
                onChange={() => {
                  setSelected(
                    selected.includes(d.id)
                      ? selected.filter((id) => id !== d.id)
                      : [...selected, d.id],
                  );
                  setMessages([]);
                  setActive(null);
                  setDemo(false);
                }}
              />
              <FileText size={17} />
              <div>
                <span title={d.name}>{d.name}</span>
                <small>
                  {d.pages} pages · {d.chunks} passages
                </small>
              </div>
              <button
                className="icon-button"
                disabled={busy || uploading}
                aria-label={`Delete ${d.name}`}
                onClick={() => void remove(d)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!docs.length && (
            <div className="empty-library">
              <div className="mini-document">
                <FileText size={23} />
              </div>
              <p>
                A little less searching.
                <br />A lot more understanding.
              </p>
              <span>Your documents will live here.</span>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="privacy">
            <ShieldCheck size={17} />
            <div>
              <strong>Your workspace, your files</strong>
              <p>
                Stored on this computer. Relevant text is sent to OpenAI when AI
                is enabled.
              </p>
            </div>
          </div>
          <button className="settings-button" onClick={() => setSetup(true)}>
            <Settings2 size={17} /> Connection settings{" "}
            <ChevronRight size={14} />
          </button>
          <div className="user">
            <span className="avatar">AT</span>
            <div>
              <strong>Abhinav Tanwar</strong>
              <small>Personal workspace</small>
            </div>
            <span className="local-pill">LOCAL</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-button"
              aria-label="Open sidebar"
              onClick={() => setMenu(true)}
            >
              <PanelLeftClose size={19} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>Document chat</strong>
          </div>
          <div className={`connection ${online ? "" : "offline"}`}>
            <i />
            {!loaded
              ? "Connecting"
              : !online
                ? "Backend offline"
                : configured
                  ? "AI connected"
                  : "Setup needed"}
          </div>
        </header>
        <div className="workspace-header">
          <div>
            <div className="eyebrow">KNOWLEDGE, WITH CONTEXT</div>
            <h1>
              Your documents. <em>In conversation.</em>
            </h1>
            <p>
              Ask better questions. Get answers you can trace back to the page.
            </p>
          </div>
          <button
            className="help-button"
            aria-label="Setup help"
            onClick={() => setSetup(true)}
          >
            <CircleHelp size={19} />
          </button>
        </div>
        <div className="tabbar">
          <div>
            <button
              className={tab === "chat" ? "tab active" : "tab"}
              onClick={() => setTab("chat")}
            >
              <Sparkles size={16} /> Ask your documents
            </button>
            <button
              className={tab === "sources" ? "tab active" : "tab"}
              onClick={() => setTab("sources")}
            >
              <FileText size={16} /> Sources <span>{sources.length}</span>
            </button>
          </div>
          <span className="index-label">
            <i />
            {demo
              ? "SAMPLE WORKSPACE"
              : `${selected.length} DOCUMENTS SELECTED`}
          </span>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div
          className={`content-grid ${active && tab === "chat" ? "with-source" : ""}`}
        >
          <section className="conversation">
            {tab === "sources" ? (
              <div className="source-library">
                <h2>The evidence behind the answer</h2>
                <p>Open any passage to inspect the original page.</p>
                {!sources.length && (
                  <div className="source-empty">
                    <Search size={28} />
                    <p>Sources appear after your first answer.</p>
                  </div>
                )}
                {sources.map((s, i) => (
                  <button
                    className="source-block"
                    key={i}
                    onClick={() => {
                      setActive(s);
                      setTab("chat");
                    }}
                  >
                    <span className="source-kicker">
                      PAGE {s.page} · {s.name}
                    </span>
                    <p>{s.text}</p>
                    <span className="source-open">
                      Inspect source <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {demo && (
                  <div className="demo-banner">
                    <Sparkles size={14} />
                    <span>
                      Guided demo · fictional document and prepared answer. No
                      AI request was made.
                    </span>
                    <button onClick={() => setSetup(true)}>
                      Connect AI <ArrowUpRight size={13} />
                    </button>
                  </div>
                )}
                {!messages.length ? (
                  <div className="welcome">
                    <div className="welcome-icon">
                      <Sparkles size={30} />
                    </div>
                    <div className="eyebrow">FROM INFORMATION TO INSIGHT</div>
                    <h2>
                      Good answers start
                      <br />
                      with your documents.
                    </h2>
                    <p>
                      Bring your reports, research, and ideas together.
                      <br />
                      AI Document Search finds the relevant passages, so you can
                      focus on what matters.
                    </p>
                    <div className="start-actions">
                      <button
                        className="primary"
                        disabled={!online || uploading}
                        onClick={() =>
                          configured ? fileRef.current?.click() : setSetup(true)
                        }
                      >
                        <Plus size={16} /> Add your first PDF
                      </button>
                      <button
                        className="secondary"
                        disabled={!online || busy}
                        onClick={() => void loadDemo()}
                      >
                        Explore a sample <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="suggestions">
                      <div>
                        <span>01</span>
                        <BookOpen size={19} />
                        <strong>Understand the essentials</strong>
                        <p>Summarize findings without losing the context.</p>
                      </div>
                      <div>
                        <span>02</span>
                        <Search size={19} />
                        <strong>Find the exact detail</strong>
                        <p>
                          Go from a question to the passage that answers it.
                        </p>
                      </div>
                      <div>
                        <span>03</span>
                        <ShieldCheck size={19} />
                        <strong>Check the evidence</strong>
                        <p>Follow citations to the original PDF page.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="message-list">
                    {messages.map((m, i) => (
                      <article key={i} className={`message ${m.role}`}>
                        <div
                          className={`message-avatar ${m.role === "assistant" ? "ai" : ""}`}
                        >
                          {m.role === "user" ? "AT" : <Layers size={19} />}
                        </div>
                        <div className="message-body">
                          <div className="message-label">
                            {m.role === "user" ? "You" : "AI Document Search"}
                            {m.role === "assistant" && (
                              <span>
                                {m.demo
                                  ? "PREPARED EXAMPLE"
                                  : "GROUNDED IN YOUR DOCUMENTS"}
                              </span>
                            )}
                          </div>
                          <div className="markdown">
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          </div>
                          {m.warning && (
                            <p className="citation-warning">
                              The model did not include inline citations. Review
                              the retrieved passages before relying on this
                              answer.
                            </p>
                          )}
                          {m.sources?.length ? (
                            <div className="answer-sources">
                              <div className="source-heading">
                                <Check size={13} /> Retrieved passages · verify
                                each claim
                              </div>
                              <div className="source-chips">
                                {m.sources.map((s) => (
                                  <button
                                    key={s.number}
                                    onClick={() => setActive(s)}
                                    className={
                                      active?.text === s.text ? "selected" : ""
                                    }
                                  >
                                    <span>{s.number}</span>
                                    <FileText size={13} />
                                    <strong>{s.name}</strong>
                                    <small>p. {s.page}</small>
                                    <ArrowUpRight size={12} />
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                    {busy && (
                      <div role="status" className="thinking">
                        <LoaderCircle size={17} className="spin" /> Finding
                        passages and preparing your answer…
                      </div>
                    )}
                    <div ref={end} />
                  </div>
                )}
                <div className="composer-wrap">
                  <form className="composer" onSubmit={ask}>
                    <label className="sr-only" htmlFor="question">
                      Ask about your documents
                    </label>
                    <textarea
                      id="question"
                      rows={2}
                      maxLength={4000}
                      placeholder={
                        demo
                          ? "Connect OpenAI to ask your own questions…"
                          : "What would you like to know about your documents?"
                      }
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void ask(e);
                        }
                      }}
                    />
                    <div className="composer-bottom">
                      <span>
                        <Layers size={13} />
                        {demo
                          ? "Sample preview"
                          : configured
                            ? `${selected.length} PDFs in context`
                            : "Connect OpenAI to get started"}
                      </span>
                      <button
                        type="submit"
                        aria-label="Send question"
                        disabled={
                          busy || uploading || !question.trim() || !online
                        }
                      >
                        {busy ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <ArrowUp size={19} />
                        )}
                      </button>
                    </div>
                  </form>
                  <div className="composer-caption">
                    <span>
                      Answers come from your PDFs. Always check the sources.
                    </span>
                    {messages.length > 0 && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setMessages([]);
                          setActive(null);
                          setDemo(false);
                        }}
                      >
                        New conversation
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
          {active && tab === "chat" && (
            <aside className="source-panel">
              <div className="source-panel-header">
                <span>
                  <FileText size={15} /> SOURCE EXPLORER
                </span>
                <button
                  className="icon-button"
                  aria-label="Close source explorer"
                  onClick={() => setActive(null)}
                >
                  <X size={17} />
                </button>
              </div>
              <div className="source-detail">
                <span className="page-badge">
                  PAGE {active.page.toString().padStart(2, "0")}
                </span>
                <h3>{active.name}</h3>
                <p className="source-description">Original extracted passage</p>
                <div className="paper">
                  <div className="paper-rule" />
                  <span className="paper-label">
                    {active.document_id === "demo"
                      ? "FICTIONAL PILOT BRIEF"
                      : "DOCUMENT EXCERPT"}
                  </span>
                  <blockquote>{active.text}</blockquote>
                  <div className="paper-footer">
                    {active.name}
                    <span>{active.page}</span>
                  </div>
                </div>
                <a
                  className="pdf-link"
                  href={`${BASE}/api/${active.document_id === "demo" ? "demo/pdf" : `documents/${active.document_id}/pdf`}#page=${active.page}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original PDF <ArrowUpRight size={16} />
                </a>
                <div className="source-note">
                  <ShieldCheck size={17} />
                  <p>
                    Citations locate the evidence. They do not guarantee that
                    every generated claim is supported.
                  </p>
                </div>
              </div>
            </aside>
          )}
        </div>
        <footer className="app-footer">
          <span>AI DOCUMENT SEARCH (RAG CHATBOT)</span>
          <span>
            React · FastAPI · LangChain · FAISS{configured ? ` · ${model}` : ""}
          </span>
          <span>Built by Abhinav Tanwar</span>
        </footer>
      </main>
      {setup && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="setup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
          >
            <button
              autoFocus
              className="icon-button modal-close"
              aria-label="Close settings"
              onClick={() => setSetup(false)}
            >
              <X size={20} />
            </button>
            <div className="welcome-icon">
              <Settings2 size={25} />
            </div>
            <div className="eyebrow">ONE CONNECTION. YOUR ENTIRE LIBRARY.</div>
            <h2 id="setup-title">Connect your AI workspace</h2>
            <p>
              AI Document Search runs locally. OpenAI provides the embeddings
              and AI answers; relevant PDF text is sent to its API.
            </p>
            <ol>
              <li>
                Create an API key in your{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAI dashboard ↗
                </a>
                . API billing is separate from a ChatGPT subscription.
              </li>
              <li>
                Copy <code>.env.example</code> to <code>.env</code> in the
                project folder, and privately set <code>OPENAI_API_KEY</code>.
              </li>
              <li>
                Restart the Python backend, then refresh this page. Never paste
                your key into this chat or the frontend.
              </li>
            </ol>
            <div className="setup-status">
              <i className={configured ? "ready" : ""} />
              {configured
                ? "OpenAI key detected. Upload a PDF to test the connection."
                : "Waiting for a local OpenAI API key."}
            </div>
            <div className="modal-actions">
              <button
                className="primary"
                onClick={() => {
                  void refresh();
                  setSetup(false);
                }}
              >
                Check connection
              </button>
              <button
                className="secondary"
                disabled={!online || busy}
                onClick={() => {
                  setSetup(false);
                  void loadDemo();
                }}
              >
                Try the guided demo
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
