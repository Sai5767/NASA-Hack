import { useId, useRef, useState } from "react";
import { validateSignIn } from "../../lib/profile.js";
import Logo from "./Logo.jsx";
import Vishwa from "./Vishwa.jsx";

export const DEMO_NOTE = "Demo only — your password is discarded and is never sent.";

/**
 * The demo sign-in card (spec 1.3). Not authentication: the email is checked for shape and the password for being
 * non-empty, entirely in this browser. The password lives only in this component's state while the user types; it is
 * cleared before `onSignIn` is called and is never passed to it, stored, logged or sent anywhere.
 */
export default function SignIn({ onSignIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);
  const passRef = useRef(null);
  const id = useId();

  const submit = (e) => {
    e.preventDefault();
    const found = validateSignIn(email, password);
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passRef.current?.focus();
    // Valid: drop the password immediately. Only the email goes up, and only its masked form is ever stored.
    setPassword("");
    setBusy(true);
    const address = email;
    setTimeout(() => onSignIn(address), 120); // brief "Signing in…" so the change is perceptible; no network call exists
    return undefined;
  };

  return (
    <form className="signin" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <div className="signin-brand">
        <Logo size={28} className="signin-logo" />
        <Vishwa prefix="by" className="signin-by" />
      </div>
      <h2 id={`${id}-title`} className="welcome-title">See how your corner of the Earth is changing.</h2>

      <div className="welcome-field">
        <label className="welcome-label" htmlFor={`${id}-email`}>Email</label>
        <input
          ref={emailRef}
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck="false"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? `${id}-email-err` : undefined}
          placeholder="you@example.com"
        />
        {errors.email && <p id={`${id}-email-err`} className="field-error"><span aria-hidden="true">✕ </span>{errors.email}</p>}
      </div>

      <div className="welcome-field">
        <label className="welcome-label" htmlFor={`${id}-pass`}>Password</label>
        <div className="pass-wrap">
          <input
            ref={passRef}
            id={`${id}-pass`}
            type={show ? "text" : "password"}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? `${id}-pass-err` : undefined}
          />
          <button type="button" className="btn btn-sm btn-ghost pass-toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-controls={`${id}-pass`}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
        {errors.password && <p id={`${id}-pass-err`} className="field-error"><span aria-hidden="true">✕ </span>{errors.password}</p>}
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>

      <p className="demo-note">{DEMO_NOTE}</p>
    </form>
  );
}
