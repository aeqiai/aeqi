import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "@/components/BlockAvatar";
import "@/styles/welcome.css";

export default function NewCompanyPage() {
  const navigate = useNavigate();
  const setActiveCompany = useUIStore((s) => s.setActiveCompany);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      await api.createCompany({
        name: name.trim(),
        tagline: tagline.trim() || undefined,
      });
      const companyName = name.trim();
      setActiveCompany(companyName);
      // Backend auto-creates an agent for the company — fetch it immediately
      await fetchAgents();
      navigate(`/${encodeURIComponent(companyName)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create company");
      setCreating(false);
    }
  };

  return (
    <div className="new-co-page">
      <div className="new-co-container new-co-animate">
        <a
          className="new-co-back"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M8.5 3L4.5 7l4 4" />
          </svg>
          Back
        </a>

        <div className="new-co-hero">
          {/* Avatar + Name inline */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setImageUrl(reader.result as string);
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
          />
          <div className="new-co-identity">
            <div
              className="new-co-avatar"
              onClick={() => fileRef.current?.click()}
              title="Upload logo"
            >
              {imageUrl ? (
                <img src={imageUrl} alt="" className="new-co-avatar-img" />
              ) : (
                <BlockAvatar name={name || "W"} size={56} />
              )}
              <span className="new-co-avatar-overlay">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2 11l3.5-3.5L8 10l3-4 3 3M2 14h12" />
                </svg>
              </span>
            </div>
            <div className="new-co-identity-fields">
              <input
                className="new-co-name-input"
                placeholder="Company name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleCreate();
                }}
                autoFocus
              />
              <input
                className="new-co-tagline-input"
                placeholder="Add a tagline..."
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleCreate();
                }}
              />
            </div>
          </div>
        </div>

        {error && <div className="new-co-error">{error}</div>}

        <button
          className="new-co-submit"
          onClick={handleCreate}
          disabled={!name.trim() || creating}
        >
          {creating ? (
            "Creating..."
          ) : (
            <>
              Create company <kbd className="new-co-kbd">↵</kbd>
            </>
          )}
        </button>

        <p className="new-co-hint">
          You can change the name, logo, and tagline anytime from your company settings.
        </p>
      </div>
    </div>
  );
}
