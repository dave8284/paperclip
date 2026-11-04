import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "@/lib/router";
import { PendingApproval } from "@/pages/PendingApproval";
import { expect, userEvent, within } from "storybook/test";
import { storybookAuthSession } from "../../fixtures/paperclipData";
import { prepareFixtureApi, type FixtureState } from "../../support/capability-gaps/api";

function WaitingList() {
  return <Routes>
    <Route path="/pending-approval" element={<PendingApproval />} />
    <Route path="/workspace" element={<p>Approved workspace destination</p>} />
  </Routes>;
}
const meta = {
  id: "feature-waiting-list",
  title: "Getting started and access/Login, invitations, and access/Waiting list",
  component: WaitingList,
  parameters: {
    layout: "fullscreen",
    initialEntries: ["/pending-approval"],
    paperclip: {
      capabilities: ["access/login"], status: "current", implementation: "production", boundary: "fixtures",
      notes: "Production PendingApproval with fixture registration, one finite confetti acknowledgement, refresh feedback, approval redirect, and suspended/rejected/error states. Motion respects browser preference. Workspace destination is a marker; these stories do not approve real accounts, send email or prove OAuth.",
    },
  },
  beforeEach: ({ parameters }) => {
    let reads = 0;
    return prepareFixtureApi([
      { path: "/api/auth/get-session", state: "ready", read: () => storybookAuthSession },
      { path: "/api/registration", state: parameters.registrationState as FixtureState | undefined,
        read: () => {
          reads += 1;
          if (reads > 1 && parameters.refreshing) return new Promise(() => {});
          return { status: reads > 1 && parameters.approveOnRefresh ? "approved" : parameters.status ?? "pending",
            isInstanceAdmin: false, userId: storybookAuthSession.user.id };
        } },
      { path: "/api/auth/sign-out", method: "POST", state: "mutation-failure", read: () => ({}) },
    ]).cleanup;
  },
} satisfies Meta<typeof WaitingList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Pending: Story = {};
export const Loading: Story = { parameters: { registrationState: "loading" } };
export const Failed: Story = { parameters: { registrationState: "failure" } };
export const Suspended: Story = { parameters: { status: "suspended" } };
export const Rejected: Story = { parameters: { status: "rejected" } };
export const StillPending: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Refresh approval status" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Your account is still waiting for approval.");
  },
};
export const Refreshing: Story = {
  parameters: { refreshing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Refresh approval status" }));
    await expect(await canvas.findByRole("button", { name: "Checking approval…" })).toBeDisabled();
  },
};
export const ApprovedAfterRefresh: Story = {
  parameters: { approveOnRefresh: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Refresh approval status" }));
    await canvas.findByText("Approved workspace destination");
  },
};
export const SignOutFailed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Sign out" }));
    await canvas.findByRole("alert");
  },
};
