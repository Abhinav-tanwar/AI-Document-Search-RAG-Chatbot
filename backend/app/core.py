"""Local document store and page-preserving retrieval. No pickle deserialization."""

from __future__ import annotations

import hashlib
import io
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

import faiss
import numpy as np
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 300
MAX_CHUNKS = 1500


class DocumentError(ValueError):
    pass


class Library:
    def __init__(self, path: Path, embeddings):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.embeddings = embeddings
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY, name TEXT, pages INTEGER, chunks INTEGER,
                    pdf BLOB, created TEXT DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY, doc_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
                    page INTEGER, text TEXT, vector BLOB);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
            """)
            model = db.execute("SELECT value FROM settings WHERE key='embedding_model'").fetchone()
            identity = getattr(embeddings, "model", "test")
            if model and model[0] != identity:
                raise RuntimeError(
                    "Embedding model changed. Use a new DATA_DIR or restore the previous model."
                )
            db.execute("INSERT OR IGNORE INTO settings VALUES ('embedding_model', ?)", (identity,))
        path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def documents(self):
        with self.connect() as db:
            return [
                dict(r)
                for r in db.execute(
                    "SELECT id,name,pages,chunks,created FROM documents ORDER BY created DESC,id"
                )
            ]

    def add(self, name, data):
        if not data or len(data) > MAX_BYTES:
            raise DocumentError("Choose a PDF between 1 byte and 20 MB.")
        if not name.lower().endswith(".pdf") or not data.startswith(b"%PDF-"):
            raise DocumentError("Only valid PDF files are supported.")
        doc_id = hashlib.sha256(data).hexdigest()
        with self.lock:
            with self.connect() as db:
                if db.execute("SELECT id FROM documents WHERE id=?", (doc_id,)).fetchone():
                    return {"id": doc_id, "duplicate": True}
            try:
                reader = PdfReader(io.BytesIO(data))
                if reader.is_encrypted:
                    raise DocumentError("This PDF is password-protected. Upload an unlocked copy.")
                if len(reader.pages) > MAX_PAGES:
                    raise DocumentError("Please split PDFs longer than 300 pages.")
                splitter = RecursiveCharacterTextSplitter(chunk_size=1400, chunk_overlap=180)
                chunks = []
                for page, item in enumerate(reader.pages, 1):
                    text = (item.extract_text() or "").replace("\x00", "").strip()
                    for part in splitter.split_text(text):
                        chunks.append((page, part))
                        if len(chunks) > MAX_CHUNKS:
                            raise DocumentError(
                                "This PDF contains too much text. Split it into smaller documents."
                            )
            except DocumentError:
                raise
            except Exception as exc:
                raise DocumentError(
                    "Could not read this PDF. Export a fresh, unlocked PDF and try again."
                ) from exc
            if not chunks:
                raise DocumentError("No selectable text found. Run OCR on this scanned PDF first.")
            vectors = np.asarray(
                self.embeddings.embed_documents([c[1] for c in chunks]), dtype="float32"
            )
            if (
                vectors.ndim != 2
                or vectors.shape[0] != len(chunks)
                or not np.isfinite(vectors).all()
            ):
                raise RuntimeError("Invalid embedding response.")
            faiss.normalize_L2(vectors)
            # Publish the whole document atomically, only after all embeddings succeed.
            with self.connect() as db:
                db.execute(
                    "INSERT INTO documents(id,name,pages,chunks,pdf) VALUES(?,?,?,?,?)",
                    (
                        doc_id,
                        Path(name.replace("\\", "/")).name[:180],
                        len(reader.pages),
                        len(chunks),
                        data,
                    ),
                )
                db.executemany(
                    "INSERT INTO chunks(doc_id,page,text,vector) VALUES(?,?,?,?)",
                    [
                        (doc_id, page, text, vector.tobytes())
                        for (page, text), vector in zip(chunks, vectors)
                    ],
                )
            return {"id": doc_id, "duplicate": False}

    def delete(self, doc_id):
        with self.lock, self.connect() as db:
            return bool(db.execute("DELETE FROM documents WHERE id=?", (doc_id,)).rowcount)

    def pdf(self, doc_id):
        with self.connect() as db:
            row = db.execute("SELECT pdf FROM documents WHERE id=?", (doc_id,)).fetchone()
            return row[0] if row else None

    def search(self, query, selected=None, k=5):
        with self.connect() as db:
            sql = "SELECT c.*,d.name FROM chunks c JOIN documents d ON c.doc_id=d.id"
            params = []
            if selected is not None:
                if not selected:
                    return []
                sql += " WHERE c.doc_id IN (" + ",".join("?" for _ in selected) + ")"
                params = selected
            rows = db.execute(sql, params).fetchall()
        if not rows:
            return []
        matrix = np.vstack([np.frombuffer(r["vector"], dtype="float32") for r in rows])
        query_vector = np.asarray([self.embeddings.embed_query(query)], dtype="float32")
        faiss.normalize_L2(query_vector)
        index = faiss.IndexFlatIP(matrix.shape[1])
        index.add(matrix)
        scores, positions = index.search(query_vector, min(k, len(rows)))
        return [
            dict(
                number=n + 1,
                document_id=rows[i]["doc_id"],
                name=rows[i]["name"],
                page=rows[i]["page"],
                text=rows[i]["text"],
                score=round(float(score), 4),
            )
            for n, (i, score) in enumerate(zip(positions[0], scores[0]))
            if i >= 0
        ]
