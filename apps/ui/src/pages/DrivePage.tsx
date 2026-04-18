import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { useDaemonStore } from "@/store/daemon";

interface DriveFile {
  id: string;
  agent_id: string;
  name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
}

/** Walk up parent_id to find the root ancestor id. */
function findRootId(agents: { id: string; name: string; parent_id?: string | null }[], id: string) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  let current = byId.get(id) || agents.find((a) => a.name === id);
  for (let i = 0; i < 20 && current; i++) {
    if (!current.parent_id) return current.id;
    current = byId.get(current.parent_id);
  }
  return current?.id || id;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function DrivePage() {
  const { agentId = "" } = useParams<{ agentId?: string }>();
  const agents = useDaemonStore((s) => s.agents);
  const rootId = findRootId(agents, agentId);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!rootId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDriveFiles(rootId);
      if (res.ok) setFiles(res.files);
      else setError("Failed to load files");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [rootId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleUpload = useCallback(
    async (fileList: FileList | File[]) => {
      if (!rootId) return;
      const arr = Array.from(fileList);
      if (arr.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const f of arr) {
          if (f.size > 25 * 1024 * 1024) {
            setError(`${f.name} is larger than 25 MB`);
            continue;
          }
          const res = await api.uploadDriveFile(rootId, f);
          if (!res.ok) {
            setError(res.error || `Upload failed: ${f.name}`);
          }
        }
        await loadFiles();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [rootId, loadFiles],
  );

  const handleDelete = useCallback(async (fid: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      const res = await api.deleteDriveFile(fid);
      if (res.ok) setFiles((prev) => prev.filter((f) => f.id !== fid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) handleUpload(e.dataTransfer.files);
  };

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Drive
        </h1>
        <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
          Shared drive for this root agent. Any agent in the tree can read these files. 25 MB per
          file.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragOver ? "var(--text-primary)" : "var(--border)"}`,
          borderRadius: "var(--radius-md)",
          padding: "28px 20px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "var(--state-hover)" : "transparent",
          transition: "all 0.15s ease",
          marginBottom: 20,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--text-secondary)",
            }}
          >
            <Spinner size="sm" /> Uploading...
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, color: "var(--text-primary)", marginBottom: 4 }}>
              Drop files here or click to upload
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Up to 25 MB per file</div>
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 16,
            borderRadius: "var(--radius-md)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <EmptyState title="No files yet" description="Upload a file to get started." />
      ) : (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}
        >
          {files.map((f, idx) => (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderBottom:
                  idx === files.length - 1 ? "none" : "1px solid var(--color-border-faint)",
                fontSize: 13,
              }}
            >
              <a
                href={api.driveDownloadUrl(f.id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: "var(--text-primary)",
                  textDecoration: "none",
                  fontWeight: 450,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={f.name}
              >
                {f.name}
              </a>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {formatBytes(f.size_bytes)}
              </span>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: 11,
                  flexShrink: 0,
                  minWidth: 90,
                  textAlign: "right",
                }}
              >
                {formatDate(f.uploaded_at)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(f.id, f.name)}
                aria-label={`Delete ${f.name}`}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
