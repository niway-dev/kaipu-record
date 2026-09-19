import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { listUsers } from "../server-functions/users";
import { authClient } from "../lib/auth-client";

const searchSchema = z.object({
  search: z.string().max(200).catch(""),
  page: z.coerce.number().int().min(1).max(10000).catch(1),
});
export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listUsers({ data: deps }),
  staleTime: 0,
  component: Console,
});
function bytes(value: number) {
  return value >= 1e9 ? `${(value / 1e9).toFixed(2)} GB` : `${(value / 1e6).toFixed(1)} MB`;
}
function date(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(value),
  );
}
function Console() {
  const result = Route.useLoaderData();
  const { search, page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const response = await authClient.signOut();
      if (response.error) throw new Error();
      await router.invalidate();
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (result.status === "unauthorized" || result.status === "forbidden")
    return (
      <main className="login">
        <div className="wordmark">
          K<span> / CONSOLE</span>
        </div>
        <p className="eyebrow">NIWAY · OPERATIONS</p>
        <h1>
          Your workspace.
          <br />
          Behind the scenes.
        </h1>
        <p className="muted">Sign in with your authorized Kaipu account.</p>
        {result.status === "forbidden" && (
          <p role="status" className="notice">
            Access is restricted to configured operators. If you are already signed in, switch to an
            authorized account.
          </p>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            try {
              const response = await authClient.signIn.email({
                email: String(form.get("email")),
                password: String(form.get("password")),
              });
              if (response.error) {
                setError("Sign-in failed. Check your credentials and try again.");
                return;
              }
              await router.invalidate();
            } catch {
              setError("Could not reach the server. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button disabled={busy}>{busy ? "Please wait…" : "Sign in →"}</button>
        </form>
        <button className="quiet" disabled={busy} onClick={signOut}>
          Sign out of this account
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    );
  const data = result.data;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="shell">
      <aside>
        <div className="wordmark">
          K<span> / CONSOLE</span>
        </div>
        <p className="eyebrow">WORKSPACE</p>
        <a className="nav-active" href="/" aria-current="page">
          Users <span>↗</span>
        </a>
        <div className="aside-bottom">
          <span className="environment">{result.environment}</span>
          <p>{result.name}</p>
          <button className="quiet" disabled={busy} onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <header>
          <div>
            <p className="eyebrow">PEOPLE & ACCESS</p>
            <h1>
              Users<span className="dot">.</span>
            </h1>
            <p className="muted">Accounts, plans and Cloud storage in one place.</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await router.invalidate();
              } finally {
                setBusy(false);
              }
            }}
          >
            Refresh ↻
          </button>
        </header>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <section className="summary" aria-label="Account summary">
          <div>
            <span>Matching accounts</span>
            <strong>{data.total}</strong>
          </div>
          <div>
            <span>Cloud uploads</span>
            <strong className={data.uploadsEnabled ? "green" : ""}>
              {data.uploadsEnabled ? "Enabled" : "Paused"}
            </strong>
          </div>
          <div>
            <span>Access mode</span>
            <strong>Read only</strong>
          </div>
        </section>
        <form
          className="toolbar"
          key={search}
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("search");
            void navigate({ search: { search: String(value ?? "").trim(), page: 1 } });
          }}
        >
          <label className="search-label">
            Find an account
            <input
              name="search"
              defaultValue={search}
              maxLength={200}
              placeholder="Search by name or email"
              type="search"
            />
          </label>
          <button type="submit" className="secondary">
            Search
          </button>
          {search && (
            <button
              type="button"
              className="quiet"
              onClick={() => void navigate({ search: { search: "", page: 1 } })}
            >
              Clear
            </button>
          )}
          <span className="muted">Newest first · dates in UTC</span>
        </form>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">
              Kaipu accounts and their current server entitlements
            </caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Email</th>
                <th scope="col">Plan</th>
                <th scope="col">Storage</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name || "Unnamed account"}</strong>
                    <span>{user.email}</span>
                    <details>
                      <summary>User ID</summary>
                      <code>{user.id}</code>
                    </details>
                  </td>
                  <td>
                    <span className={`badge ${user.emailVerified ? "verified" : ""}`}>
                      {user.emailVerified ? "Verified" : "Unverified"}
                    </span>
                  </td>
                  <td>
                    <strong className="capitalize">{user.plan}</strong>
                    <span>
                      {user.provider ?? "Default"} · {user.status}
                    </span>
                    {user.expiresAt && <span>Ends {date(user.expiresAt)}</span>}
                  </td>
                  <td>
                    <strong>
                      {bytes(user.usedBytes)} <small>/ {bytes(user.capacityBytes)}</small>
                    </strong>
                    <meter
                      min={0}
                      max={user.capacityBytes}
                      value={Math.min(user.usedBytes + user.reservedBytes, user.capacityBytes)}
                      aria-label={`Storage used and reserved for ${user.email}`}
                    />
                    <span>
                      {bytes(user.reservedBytes)} reserved · {user.pendingUploads} pending
                    </span>
                  </td>
                  <td>{date(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.users.length === 0 && (
            <div className="empty">
              <h2>No accounts found</h2>
              <p>Try another search or refresh after a new signup.</p>
            </div>
          )}
        </div>
        <footer>
          <span className="muted">
            Page {page} · {data.total} matching accounts
          </span>
          <div>
            <button
              className="secondary"
              disabled={page <= 1}
              onClick={() => void navigate({ search: { search, page: page - 1 } })}
            >
              ← Previous
            </button>
            <button
              className="secondary"
              disabled={page >= pages}
              onClick={() => void navigate({ search: { search, page: page + 1 } })}
            >
              Next →
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
