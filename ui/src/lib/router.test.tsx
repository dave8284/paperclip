// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyRouteScope, Link, useNavigate } from "./router";

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "AGE" } }) }));
vi.mock("@/components/IssueLinkQuicklook", () => ({ IssueLinkQuicklook: () => null }));

function EmbeddedProject() {
  const navigate = useNavigate();
  return <><Link to="/projects/launch">Open launch</Link><Link to="/admin">Administration</Link><button onClick={() => navigate("/routines")}>Open routines</button></>;
}
function Portfolio() {
  const location = useLocation();
  return <><output>{location.pathname}</output><Link to="/friday">Portfolio Friday</Link><CompanyRouteScope companyPrefix="FOR"><EmbeddedProject /></CompanyRouteScope></>;
}

describe("portfolio record company navigation", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root.render(<MemoryRouter initialEntries={["/AGE/friday"]}><Routes><Route path="/:companyPrefix/*" element={<Portfolio />} /></Routes></MemoryRouter>));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("keeps embedded records in their company while the portfolio URL belongs to Friday", () => {
    const links = [...host.querySelectorAll("a")];
    expect(links.find(link => link.textContent === "Open launch")?.getAttribute("href")).toBe("/FOR/projects/launch");
    expect(links.find(link => link.textContent === "Portfolio Friday")?.getAttribute("href")).toBe("/AGE/friday");
    expect(links.find(link => link.textContent === "Administration")?.getAttribute("href")).toBe("/admin");
  });

  it("uses the record company for programmatic navigation too", () => {
    act(() => host.querySelector("button")!.click());
    expect(host.querySelector("output")?.textContent).toBe("/FOR/routines");
  });
});
