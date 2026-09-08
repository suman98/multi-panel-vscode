import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addAccount, adoptShellAccount, discoverShellAccounts, removeAccount } from "../api";
import type { Account } from "../types";

interface Props {
  accounts: Account[];
  onChange: (accounts: Account[]) => void;
  onClose: () => void;
}

/** Manage the registered Claude accounts. Tokens go straight to the login
    keychain — this dialog only ever sees the masked hint that comes back. */
export function AccountsDialog({ accounts, onChange, onClose }: Props) {
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [found, setFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    discoverShellAccounts()
      .then(setFound)
      .catch(() => setFound([]));
  }, [accounts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function run(work: () => Promise<Account[]>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await work());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    await run(() => addAccount(label, token));
    setLabel("");
    setToken("");
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Claude accounts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Claude accounts</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <p className="modal-note">
          Each project runs its own VS Code, so each one can use a different
          account. A project left on <strong>Default</strong> uses whatever
          Claude Code is already logged in as.
        </p>

        {accounts.length > 0 && (
          <ul className="acct-list">
            {accounts.map((a) => (
              <li key={a.id} className="acct-row">
                <div className="acct-info">
                  <div className="acct-label">{a.label}</div>
                  <div className="acct-hint">{a.hint}</div>
                </div>
                <button
                  className="acct-remove"
                  disabled={busy}
                  title="Forget this account and its keychain token"
                  onClick={() => run(() => removeAccount(a.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {found.length > 0 && (
          <div className="acct-found">
            <div className="modal-section-label">Found in your shell profile</div>
            {found.map((f) => (
              <div key={f} className="acct-row">
                <div className="acct-info">
                  <div className="acct-label">{f}</div>
                </div>
                <button
                  className="acct-adopt"
                  disabled={busy}
                  onClick={() => run(() => adoptShellAccount(f, ""))}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        )}

        <form className="acct-add" onSubmit={submit}>
          <div className="modal-section-label">Add a token</div>
          <input
            className="acct-input"
            placeholder="Name (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className="acct-input"
            type="password"
            placeholder="CLAUDE_CODE_OAUTH_TOKEN (sk-ant-…)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="acct-save" type="submit" disabled={busy || !token.trim()}>
            Save to keychain
          </button>
        </form>

        {error && <p className="modal-error">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
