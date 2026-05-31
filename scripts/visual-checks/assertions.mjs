const ASSERTIONS = {
  "primitive-shell": assertPrimitiveShell,
  "role-detail": assertRoleDetail,
  "company-tools": assertCompanyTools,
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
    const documentEl = select(".company-role-detail-document");
    const inspectorEl = select(".company-role-detail-inspector");
    const roleHeaderEl = select(".company-role-detail-surface-header");
    const detailsHeaderEl = select(".role-inspector-topbar");
    const countEl = select(".idea-convo-title .idea-convo-section-count");

    if (!documentEl) failures.push("Missing role detail document column");
    if (!inspectorEl) failures.push("Missing role detail inspector column");
    if (!roleHeaderEl) failures.push("Missing role detail surface header");
    if (!detailsHeaderEl) failures.push("Missing role inspector header");

    const pageOverflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    if (pageOverflow > 1)
      failures.push(`Page has ${pageOverflow}px horizontal overflow`);

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
        failures.push(
          `Inspector column is too narrow: ${Math.round(inspectorRect.width)}px`,
        );
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

async function assertPrimitiveShell(page) {
  return page.evaluate(() => {
    const failures = [];
    const root = document.querySelector(".company-primitive-shell");
    const header = root?.querySelector(".company-primitive-shell-header");
    const surface = root?.querySelector(".company-primitive-shell-surface");
    const paper = root?.closest(".content-paper");

    if (!root) failures.push("Missing primitive shell root");
    if (!header) failures.push("Missing primitive shell header");
    if (!surface) failures.push("Missing primitive shell surface");

    if (root) {
      const rootStyle = window.getComputedStyle(root);
      if (rootStyle.display !== "grid") {
        failures.push(`Primitive shell root is not grid: ${rootStyle.display}`);
      }
      if (rootStyle.paddingTop !== "0px" && window.innerWidth > 720) {
        failures.push(
          `Primitive shell has unexpected desktop top padding: ${rootStyle.paddingTop}`,
        );
      }
    }

    if (paper) {
      const paperStyle = window.getComputedStyle(paper);
      if (paperStyle.boxShadow !== "none") {
        failures.push(
          "Primitive shell is still wrapped by global content-paper elevation",
        );
      }
      if (Number.parseFloat(paperStyle.borderTopLeftRadius) > 0) {
        failures.push("Primitive shell global paper still has rounded corners");
      }
    } else {
      failures.push(
        "Primitive shell is not mounted inside the app content paper",
      );
    }

    if (header && surface) {
      const headerRect = header.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      if (Math.abs(headerRect.left - surfaceRect.left) > 1) {
        failures.push(
          "Primitive shell header and surface left edges do not align",
        );
      }
      if (Math.abs(headerRect.right - surfaceRect.right) > 1) {
        failures.push(
          "Primitive shell header and surface right edges do not align",
        );
      }
      if (surfaceRect.top <= headerRect.bottom + 4) {
        failures.push(
          "Primitive shell surface is not separated below the shell top rail",
        );
      }
    }

    return failures;
  });
}

async function assertCompanyTools(page) {
  return page.evaluate(() => {
    const failures = [];
    const root = document.querySelector(".company-tools-page");
    const main = document.querySelector(".company-tools-main");
    const header = document.querySelector(".company-tools-page-header");
    const paper = main?.closest(".content-paper");
    const rows = [...document.querySelectorAll(".agent-settings-tool-row")];
    const states = [...document.querySelectorAll(".agent-settings-tool-state")];
    const headerCount = document.querySelector(".company-tools-header-count");

    if (!root) failures.push("Missing company tools page root");
    if (!main) failures.push("Missing company tools main surface");
    if (!header) failures.push("Missing company tools shell top rail");
    if (rows.length === 0) failures.push("No tools rows rendered");
    if (states.length === 0) failures.push("No tool state pills rendered");
    if (headerCount)
      failures.push("Tools header has duplicated enabled count action");

    if (!root?.classList.contains("company-primitive-shell")) {
      failures.push("Tools page is not using the canonical primitive shell");
    }
    if (!header?.classList.contains("company-primitive-shell-header")) {
      failures.push(
        "Tools header is not using the canonical primitive shell header",
      );
    }
    if (!main?.classList.contains("company-primitive-shell-surface")) {
      failures.push(
        "Tools main is not using the canonical primitive shell surface",
      );
    }

    if (root?.classList.contains("company-overview")) {
      failures.push(
        "Tools page still inherits the legacy company-overview shell",
      );
    }
    if (root?.classList.contains("company-apps-page")) {
      failures.push(
        "Tools page still inherits the legacy company-apps-page shell",
      );
    }

    if (paper) {
      const paperStyle = window.getComputedStyle(paper);
      if (paperStyle.boxShadow !== "none") {
        failures.push(
          "Tools page is still wrapped by the global content-paper elevation",
        );
      }
      if (Number.parseFloat(paperStyle.borderTopLeftRadius) > 0) {
        failures.push(
          "Tools page global paper still has rounded content-card corners",
        );
      }
    } else {
      failures.push("Tools page is not mounted inside the app content paper");
    }

    const pageOverflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    if (pageOverflow > 1)
      failures.push(`Page has ${pageOverflow}px horizontal overflow`);

    if (header && main) {
      const headerRect = header.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      if (mainRect.top <= headerRect.bottom + 4) {
        failures.push(
          "Tools working surface is not visually separated below the shell top rail",
        );
      }
    }

    for (const state of states.slice(0, 6)) {
      const rect = state.getBoundingClientRect();
      const style = window.getComputedStyle(state);
      const radius = Number.parseFloat(style.borderRadius);
      if (rect.height < 20 || rect.height > 26) {
        failures.push(
          `Tool state pill height is outside compact range: ${Math.round(rect.height)}px`,
        );
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
