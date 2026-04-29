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

/** Resolve the entity that owns this agent — the canonical drive scope. */
function findRootId(agents: { id: string; name: string; entity_id?: string | null }[], id: string) {
  const found = agents.find((a) => a.id === id) || agents.find((a) => a.name === id);
  return found?.entity_id || found?.id || id;
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
    <div className="page-content drive-page">
      <div className="drive-page-head">
        <span className="drive-page-eyebrow">Drive</span>
        <h1 className="drive-page-title">Workspace files</h1>
        <p className="drive-page-subtitle">
          Shared across every agent in this workspace. 25 MB per file.
        </p>
      </div>

      <div
        className={`drive-dropzone${dragOver ? " drive-dropzone--hover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
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
          <div className="drive-dropzone-state">
            <Spinner size="sm" /> Uploading…
          </div>
        ) : (
          <div className="drive-dropzone-state">
            <span className="drive-dropzone-primary">Drop files or click to upload</span>
          </div>
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
        <EmptyState
          title="No files yet"
          description="Drop a file above — any agent in the workspace can read it."
        />
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
                  fontFamily: "var(--font-sans)",
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
