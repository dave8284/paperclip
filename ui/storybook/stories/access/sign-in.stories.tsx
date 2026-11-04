import type { Meta, StoryObj } from "@storybook/react-vite";
import { Routes, Route } from "@/lib/router";
import { AuthPage } from "@/pages/Auth";
import { Companies } from "@/pages/Companies";
import { expect, userEvent, within } from "storybook/test";
import { storybookAuthSession } from "../../fixtures/paperclipData";
import { prepareFixtureApi, type FixtureState } from "../../support/capability-gaps/api";

function SignIn() {
  return <Routes>
    <Route path="/auth" element={<AuthPage />} />
    <Route path="/companies" element={<Companies />} />
    <Route path="/PAP/companies" element={<Companies />} />
  </Routes>;
}
const meta = {
  id: "feature-sign-in",
  title: "Getting started and access/Login, invitations, and access/Sign in",
  component: SignIn,
  parameters: {
    layout: "fullscreen",
    initialEntries: ["/auth?next=/companies"],
    paperclip: {
      capabilities: ["access/login"],
      status: "current",
      implementation: "production",
      boundary: "fixtures",
      notes: "Production AuthPage always offers Google-only entry, including legacy password options. Covers waiting-list entry, options/session loading/errors, and Google submission pending/failure. SignedIn starts with a fixture session and follows native routing; no Google consent/redirect is simulated as successful. Real OAuth, bootstrap claim and sign-out require separate verification.",
    },
  },
  beforeEach: ({ parameters }) => prepareFixtureApi([
    { path: "/api/health", state: "ready", read: () => ({ status: "ok", deploymentMode: "authenticated", authReady: true }) },
    { path: "/api/auth/get-session", read: () => parameters.signedIn ? storybookAuthSession : null },
    { path: "/api/registration/options", state: parameters.authOptionsState as FixtureState | undefined,
      read: () => ({ googleEnabled: parameters.googleUnavailable !== true,
        ...(parameters.legacyOptions ? {} : { passwordSignInEnabled: false }),
        passwordSignUpEnabled: Boolean(parameters.legacyOptions), approvalRequired: true }) },
    { path: "/api/auth/sign-in/social", method: "POST",
      read: () => Response.json({ error: "Google sign-in is simulated in this preview." }, { status: 503 }) },
  ], parameters.fixtureState as FixtureState).cleanup,
} satisfies Meta<typeof SignIn>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SignedOut: Story = {};
export const GoogleOnly: Story = {
  parameters: { legacyOptions: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Continue with Google" });
    await expect(canvas.queryByLabelText("Email")).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText("Password")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Create one" })).not.toBeInTheDocument();
  },
};
export const JoinWaitingList: Story = { parameters: { initialEntries: ["/auth?mode=sign_up"] } };
export const GoogleSignInFailed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Continue with Google" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Google sign-in is simulated in this preview.");
  },
};
export const OptionsLoading: Story = { parameters: { authOptionsState: "loading" } };
export const OptionsFailed: Story = { parameters: { authOptionsState: "failure" } };
export const GoogleUnavailable: Story = { parameters: { googleUnavailable: true } };
export const Loading: Story = { parameters: { fixtureState: "loading" } };
export const SessionFailed: Story = { parameters: { fixtureState: "failure" } };
export const SignInFailed: Story = {
  parameters: { fixtureState: "mutation-failure" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Continue with Google" }));
    await canvas.findByText("The request failed. Please try again.");
  },
};
export const SigningIn: Story = {
  parameters: { fixtureState: "saving" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Continue with Google" }));
    await expect(await canvas.findByRole("button", { name: "Connecting…" })).toBeDisabled();
  },
};
export const SignedIn: Story = {
  parameters: { signedIn: true },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", { name: "New Organization" });
  },
};
