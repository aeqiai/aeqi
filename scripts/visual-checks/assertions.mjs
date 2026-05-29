const ASSERTIONS = {
  "role-detail": assertRoleDetail,
  "trust-tools": assertTrustTools,
};

export async function runLayoutAssertions(page, names) {
  const failures = [];
  for (const name of names) {
    const assertion = ASSERTIONS[name];
    if (!assertion) {
      failures.push(`Unknown layout assertion: ${name}`);
      continue;
    }
    failures.push(...(await assertion(page)));
  }
  return failures;
}

async function assertRoleDetail(page) {
  return page.evaluate(() => {
    const failures = [];
    const select = (selector) => document.querySelector(selector);
    const documentEl = select(".trust-role-detail-document");
    const inspectorEl = select(".trust-role-detail-inspector");
    const roleHeaderEl = select(".trust-role-detail-surface-header");
    const detailsHeaderEl = select(".role-inspector-topbar");
    const countEl = select(".idea-convo-title .idea-convo-section-count");

    if (!documentEl) failures.push("Missing role detail document column");
    if (!inspectorEl) failures.push("Missing role detail inspector column");
    if (!roleHeaderEl) failures.push("Missing role detail surface header");
    if (!detailsHeaderEl) failures.push("Missing role inspector header");

    const pageOverflow =
      document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (pageOverflow > 1) failures.push(`Page has ${pageOverflow}px horizontal overflow`);

    if (roleHeaderEl && detailsHeaderEl) {
      const roleHeader = roleHeaderEl.getBoundingClientRect();
      const detailsHeader = detailsHeaderEl.getBoundingClientRect();
      if (Math.abs(roleHeader.top - detailsHeader.top) > 2) {
        failures.push("Role idea and Details headers are not baseline-aligned");
      }
    }

    if (documentEl && inspectorEl && window.innerWidth >= 1100) {
      const documentRect = documentEl.getBoundingClientRect();
      const inspectorRect = inspectorEl.getBoundingClientRect();
      if (documentRect.right > inspectorRect.left + 1) {
        failures.push("Role document overlaps the inspector column");
      }
      if (inspectorRect.width < 260) {
        failures.push(`Inspector column is too narrow: ${Math.round(inspectorRect.width)}px`);
      }
    }

    if (countEl) {
      const countRect = countEl.getBoundingClientRect();
      const countStyle = window.getComputedStyle(countEl);
      const radius = Number.parseFloat(countStyle.borderRadius);
      if (Math.abs(countRect.width - countRect.height) > 1) {
        failures.push("Activity count is not square");
      }
      if (radius < countRect.height / 2 - 1) {
        failures.push("Activity count is not circular");
      }
    } else {
      failures.push("Missing activity count badge");
    }

    return failures;
  });
}

async function assertTrustTools(page) {
  return page.evaluate(() => {
    const failures = [];
    const main = document.querySelector(".trust-tools-main");
    const rows = [...document.querySelectorAll(".agent-settings-tool-row")];
    const states = [...document.querySelectorAll(".agent-settings-tool-state")];
    const headerCount = document.querySelector(".trust-tools-header-count");

    if (!main) failures.push("Missing trust tools main surface");
    if (rows.length === 0) failures.push("No tools rows rendered");
    if (states.length === 0) failures.push("No tool state pills rendered");
    if (headerCount) failures.push("Tools header has duplicated enabled count action");

    const pageOverflow =
      document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (pageOverflow > 1) failures.push(`Page has ${pageOverflow}px horizontal overflow`);

    for (const state of states.slice(0, 6)) {
      const rect = state.getBoundingClientRect();
      const style = window.getComputedStyle(state);
      const radius = Number.parseFloat(style.borderRadius);
      if (rect.height < 20 || rect.height > 26) {
        failures.push(`Tool state pill height is outside compact range: ${Math.round(rect.height)}px`);
        break;
      }
      if (radius < rect.height / 2 - 1) {
        failures.push("Tool state is not pill-shaped");
        break;
      }
    }

    return failures;
  });
}
