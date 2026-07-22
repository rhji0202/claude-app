"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";

export default function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name || undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div className="card" style={{ width: 360 }}>
        <h2 style={{ marginBottom: 4 }}>🤖 Claude 관리</h2>
        <p className="page-desc" style={{ marginBottom: 18 }}>
          {mode === "login" ? "로그인" : "회원가입"}
        </p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {mode === "register" && (
            <div className="field" style={{ marginBottom: 12 }}>
              <label>이름 (선택)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field" style={{ marginBottom: 16 }}>
            <label>비밀번호 {mode === "register" && "(8자 이상)"}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "처리 중..." : mode === "login" ? "로그인" : "가입하기"}
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>
        <div style={{ marginTop: 14, textAlign: "center", color: "var(--muted)" }}>
          {mode === "login" ? "계정이 없으신가요? " : "이미 계정이 있으신가요? "}
          <a
            style={{ color: "var(--accent)", cursor: "pointer" }}
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "회원가입" : "로그인"}
          </a>
        </div>
      </div>
    </div>
  );
}
