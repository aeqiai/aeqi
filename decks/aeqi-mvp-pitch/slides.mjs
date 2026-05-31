const productShell = ({
  active = "Roles",
  dock = true,
  focus = "roles",
} = {}) => `
  <div class="product-shell">
    <aside class="product-rail">
      <div class="rail-brand">aeqi</div>
      ${["Home", "Inbox", "Economy"].map((item) => `<span>${item}</span>`).join("")}
      <b>COMPANY</b>
      <strong>Luca Fish</strong>
      ${["Overview", "Roles"].map((item) => `<span class="${active === item ? "is-active" : ""}">${item}</span>`).join("")}
      <b>OPERATE</b>
      ${["Agents", "Events", "Quests", "Ideas"].map((item) => `<span>${item}</span>`).join("")}
    </aside>
    <section class="product-main">
      <header class="product-top">
        <h3>${active}</h3>
        <div><span></span><span></span><button>+ Role</button></div>
      </header>
      ${
        focus === "roles"
          ? `<div class="role-grid">
              <div class="role-card root"><b>Founder</b><small>owner</small></div>
              <div class="role-card mid"><b>Janus</b><small>director</small></div>
              <div class="role-card worker a"><b>AEQI UI Agent</b><small>worker</small></div>
              <div class="role-card worker b"><b>AEQI Events</b><small>worker</small></div>
              <div class="role-card worker c"><b>AEQI Ideas</b><small>worker</small></div>
              <div class="role-line l1"></div><div class="role-line l2"></div><div class="role-line l3"></div>
            </div>`
          : `<div class="idea-panel">
              <p>CEO role</p>
              <h4>Owns company-level direction, capital narrative, and operator leverage.</h4>
              <ul><li>Creates operating plan</li><li>Delegates to worker roles</li><li>Records decisions</li></ul>
            </div>`
      }
      ${
        dock
          ? `<div class="agent-dock">
              <span>Ask Janus anything on this page</span>
              <b>Session linked</b>
            </div>`
          : ""
      }
    </section>
  </div>
`;

const miniMetrics = (items) => `
  <div class="metric-row">
    ${items.map(([label, value]) => `<div><b>${label}</b><span>${value}</span></div>`).join("")}
  </div>
`;

const slides = [
  {
    eyebrow: "MVP pitch",
    title: "aeqi is the company OS for AI operators.",
    body: "A workspace where founders delegate real company work to agents, see the work happen in context, and keep the operating record.",
    theme: "hero",
    media: "launch",
    footer: "Company OS / Agent dock / Operator loop",
  },
  {
    eyebrow: "Problem",
    title: "AI can do work. Companies cannot delegate it cleanly.",
    body: "The model is no longer the only bottleneck. The missing layer is authority, context, memory, tools, and a visible operating loop.",
    visual: `
      <div class="break-grid">
        <article><b>Chat is detached</b><span>Answers live away from the page where work happens.</span></article>
        <article><b>Automation is brittle</b><span>Fixed workflows break when the business changes.</span></article>
        <article><b>Delegation is invisible</b><span>No shared record of what the agent saw, changed, or learned.</span></article>
      </div>
    `,
    metrics: [
      ["Need", "operator leverage"],
      ["Blocker", "company context"],
      ["Gap", "visible delegation"],
      ["Outcome", "retained use"],
    ],
  },
  {
    eyebrow: "User",
    title: "Founders need leverage before they can hire.",
    body: "The first customer is a technical founder running too many loops alone: roles, ideas, quests, docs, outreach, support, and product iteration.",
    visual: `
      <div class="operator-map">
        <div class="operator-core">Founder</div>
        ${["Roles", "Ideas", "Quests", "Docs", "Outreach", "Support"].map((x, i) => `<span class="node n${i}">${x}</span>`).join("")}
      </div>
    `,
    metrics: [
      ["First user", "founder ops"],
      ["Pain", "manual delegation"],
      ["MVP", "agent dock"],
      ["Proof", "weekly return"],
    ],
  },
  {
    eyebrow: "Product",
    title: "A company workspace with an agent always in reach.",
    body: "The dock sits below the current work surface. It knows the page, can route the user, can edit structured objects, and links every action to a session.",
    visual: productShell({ active: "Roles", focus: "roles" }),
    metrics: [
      ["Dock", "always in reach"],
      ["Context", "current page"],
      ["Actions", "structured edits"],
      ["Trace", "linked session"],
    ],
  },
  {
    eyebrow: "MVP loop",
    title: "One loop proves the product.",
    body: "On the roles page, ask for more workers. On an idea, ask for a CEO role description. On quests, ask for a plan. Watch the agent operate.",
    visual: `
      <div class="loop-strip">
        ${[
          ["1", "Ask in dock", "The agent receives page context."],
          ["2", "Structure work", "It creates roles, ideas, or quests."],
          ["3", "Show progress", "The screen updates in front of the user."],
          ["4", "Record session", "The change is auditable later."],
        ]
          .map(
            ([n, h, p]) =>
              `<article><b>${n}</b><h4>${h}</h4><p>${p}</p></article>`,
          )
          .join("")}
      </div>
    `,
    metrics: [
      ["Roles", "add workers"],
      ["Ideas", "draft roles"],
      ["Quests", "make plans"],
      ["Audit", "record changes"],
    ],
  },
  {
    eyebrow: "Substrate",
    title: "The substrate is real and dogfooded.",
    body: "aeqi already has quests, ideas, agents, events, browser evidence, app integrations, and Google Workspace access. The pitch deck itself is being built through the system.",
    visual: `
      <div class="stack">
        ${[
          ["Operator UI", "agent dock, roles, ideas, quests"],
          ["Runtime", "sessions, memory, tool calls, events"],
          ["Apps", "Google Slides, Drive, Gmail, Calendar"],
          ["Evidence", "screenshots, traces, durable quests"],
        ]
          .map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`)
          .join("")}
      </div>
    `,
    metrics: [
      ["Runtime", "quests + memory"],
      ["Apps", "Google, email"],
      ["Browser", "visible work"],
      ["Dogfood", "built in aeqi"],
    ],
  },
  {
    eyebrow: "Go to market",
    title: "Sell the first useful operator loop.",
    body: "Do not sell the whole autonomous-company dream first. Sell the moment where a founder asks in context and the company workspace changes correctly.",
    visual: `
      <div class="gtm">
        <article><b>Design partners</b><span>3-5 founders with live workflows.</span></article>
        <article><b>Paid pilots</b><span>One concrete loop per company.</span></article>
        <article><b>Retention proof</b><span>Return use beats demo excitement.</span></article>
      </div>
    `,
    metrics: [
      ["ICP", "solo founders"],
      ["Wedge", "operator loop"],
      ["Price", "paid pilots"],
      ["Proof", "retention"],
    ],
  },
  {
    eyebrow: "Positioning",
    title: "Everyone else sells a piece of the loop.",
    body: "Chat tools answer. Automation tools connect. Coding tools build. aeqi is the operating surface where agents work inside the company record.",
    visual: `
      <table class="matrix">
        <tr><th></th><th>Chat</th><th>Workflow</th><th>Code</th><th>aeqi</th></tr>
        <tr><td>Knows company state</td><td>partial</td><td>thin</td><td>repo-only</td><td>yes</td></tr>
        <tr><td>Edits business objects</td><td>no</td><td>fixed</td><td>custom</td><td>yes</td></tr>
        <tr><td>Shows work in context</td><td>no</td><td>logs</td><td>terminal</td><td>yes</td></tr>
        <tr><td>Durable operating memory</td><td>weak</td><td>weak</td><td>repo</td><td>yes</td></tr>
      </table>
    `,
    metrics: [
      ["ChatGPT", "horizontal chat"],
      ["Zapier", "workflow glue"],
      ["Replit", "code surface"],
      ["aeqi", "company OS"],
    ],
  },
  {
    eyebrow: "Why us",
    title: "Founder-led. Product-native. Built through aeqi.",
    body: "The product is not a dashboard around an agent story. The company is already using the runtime, memory, quests, and integrations to build itself.",
    visual: productShell({ active: "Ideas", focus: "idea" }),
    metrics: [
      ["Founder", "operator-led"],
      ["Product", "dogfooded"],
      ["Speed", "ship daily"],
      ["Taste", "UX native"],
    ],
  },
  {
    eyebrow: "Ask",
    title: "Help us reach the first undeniable user loop.",
    body: "Raise a focused angel/pre-seed round to finish the agent dock MVP, onboard design partners, measure retained usage, and turn dogfood into public proof.",
    visual: `
      <div class="ask-panel">
        <h3>Milestones</h3>
        <p>3-5 design partners</p>
        <p>25-100 created Companies</p>
        <p>First paid pilots</p>
        <p>One public operator loop people can feel</p>
      </div>
    `,
    metrics: [
      ["Raise", "angel/pre-seed"],
      ["Build", "agent dock"],
      ["Prove", "3-5 partners"],
      ["Expand", "paid pilots"],
    ],
  },
];

function renderSlide(slide, index) {
  const number = String(index + 1).padStart(2, "0");
  const isHero = slide.theme === "hero";
  return `
    <section class="slide ${isHero ? "slide-hero" : ""}" data-slide="${number}">
      ${
        isHero
          ? `<img class="hero-image" src="../../apps/ui/public/launch-hero.png" alt="" />
             <div class="hero-scrim"></div>`
          : ""
      }
      <div class="brand">aeqi</div>
      <div class="slide-copy">
        <p class="eyebrow">${slide.eyebrow}</p>
        <h1>${slide.title}</h1>
        <p class="body">${slide.body}</p>
        ${slide.metrics ? miniMetrics(slide.metrics) : ""}
      </div>
      ${
        isHero
          ? `<div class="hero-footer">${slide.footer}</div>`
          : `<div class="visual">${slide.visual}</div>`
      }
      <div class="page-number">${number} / 10</div>
    </section>
  `;
}

document.getElementById("deck").innerHTML = slides.map(renderSlide).join("");
