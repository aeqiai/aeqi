import { Routes, Route } from "react-router-dom";
import DocsLayout from "./DocsLayout";
import "./docs.css";

import Introduction from "./pages/Introduction";
import Quickstart from "./pages/Quickstart";
import Installation from "./pages/Installation";

export default function Docs() {
  return (
    <DocsLayout>
      <Routes>
        <Route index element={<Introduction />} />
        <Route path="quickstart" element={<Quickstart />} />
        <Route path="installation" element={<Installation />} />
        {/* Placeholder routes — fill in as you write content */}
        <Route path="concepts/agents" element={<Placeholder title="Agents" />} />
        <Route path="concepts/quests" element={<Placeholder title="Quests" />} />
        <Route path="concepts/memory" element={<Placeholder title="Memory" />} />
        <Route path="concepts/companies" element={<Placeholder title="Companies" />} />
        <Route path="platform/dashboard" element={<Placeholder title="Dashboard" />} />
        <Route path="platform/sessions" element={<Placeholder title="Sessions" />} />
        <Route path="platform/mcp" element={<Placeholder title="MCP Integration" />} />
        <Route path="self-hosting/configuration" element={<Placeholder title="Configuration" />} />
        <Route path="self-hosting/deployment" element={<Placeholder title="Deployment" />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </DocsLayout>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="lead">This page is coming soon.</p>
      <p>
        In the meantime, check the <a href="https://github.com/aeqiai/aeqi/tree/main/docs">docs directory on GitHub</a> for
        the latest documentation.
      </p>
    </>
  );
}
