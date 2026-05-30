import { execFileSync } from "node:child_process";

const deckId = "1cEc2aokQky78P7sp5SAq_fg43xJ9JOsFUzDXS_CInDM";
const trustId = "C68sd4DX6K7aSLaTyfPnAw7cqN5Fj82qX7JyuDj8NVY4";
const mcp = "/home/claudedev/.aeqi/bin/aeqi-mcp-http";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i], process.argv[i + 1]);
const baseUrl = args.get("--base-url");
if (!baseUrl) {
  console.error(
    "Usage: node decks/aeqi-mvp-pitch/sync-google-slides.mjs --base-url <public image folder url>",
  );
  process.exit(2);
}

function googleRequest(method, url, body) {
  const payload = {
    action: "call",
    provider: "google",
    tool: "google.request",
    arguments: {
      method,
      url,
      required_scopes: ["https://www.googleapis.com/auth/presentations"],
      ...(body ? { body } : {}),
    },
    credential_scope_kind: "trust",
    credential_scope_id: trustId,
  };
  const raw = execFileSync(mcp, ["apps", JSON.stringify(payload)], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.data?.json;
}

const presentation = googleRequest(
  "GET",
  `https://slides.googleapis.com/v1/presentations/${deckId}?fields=pageSize,slides(objectId,pageElements(objectId))`,
);

const slides = presentation.slides.slice(0, 10);
const width = presentation.pageSize.width;
const height = presentation.pageSize.height;
const requests = [];

slides.forEach((slide, index) => {
  for (const element of slide.pageElements ?? []) {
    requests.push({ deleteObject: { objectId: element.objectId } });
  }
  const slideNumber = String(index + 1).padStart(2, "0");
  requests.push({
    createImage: {
      objectId: `aeqi_html_deck_${slideNumber}_${Date.now()}`,
      url: `${baseUrl.replace(/\/$/, "")}/slide-${slideNumber}.png`,
      elementProperties: {
        pageObjectId: slide.objectId,
        size: { width, height },
        transform: {
          scaleX: 1,
          scaleY: 1,
          translateX: 0,
          translateY: 0,
          unit: "EMU",
        },
      },
    },
  });
});

googleRequest(
  "POST",
  `https://slides.googleapis.com/v1/presentations/${deckId}:batchUpdate`,
  {
    requests,
  },
);

console.log(`synced ${slides.length} rendered slides into ${deckId}`);
