import { useState, useEffect } from "react";

const API_BASE = "http://localhost:8000";

export default function App() {
  const [count, setCount]       = useState(0);
  const [greeting, setGreeting] = useState("Connecting to API…");
  const [items, setItems]       = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/`)
      .then(r => r.json())
      .then(d => setGreeting(d.message))
      .catch(() => setGreeting("API offline — start the backend first"));

    fetch(`${API_BASE}/items`)
      .then(r => r.json())
      .then(setItems)
      .catch(() => {});
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "60px auto", padding: "0 24px" }}>
      <header style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: 24, marginBottom: 32 }}>
        <h1 style={{ color: "#7c3aed", margin: 0 }}>🚀 Vesper Demo</h1>
        <p style={{ color: "#6b7280", margin: "4px 0 0" }}>Full-stack AI IDE Starter</p>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, color: "#374151", marginBottom: 8 }}>API Status</h2>
        <code style={{ background: "#f3f4f6", padding: "8px 14px", borderRadius: 8, display: "block", fontSize: 13 }}>
          {greeting}
        </code>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, color: "#374151", marginBottom: 8 }}>Interactive Counter</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={() => setCount(c => c + 1)}
            style={{
              background: "#7c3aed", color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontSize: 15,
            }}
          >
            + Increment
          </button>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#7c3aed" }}>{count}</span>
          <button
            onClick={() => setCount(0)}
            style={{
              background: "transparent", color: "#9ca3af", border: "1px solid #e5e7eb",
              borderRadius: 8, padding: "10px 16px", cursor: "pointer", fontSize: 13,
            }}
          >
            Reset
          </button>
        </div>
      </section>

      {items.length > 0 && (
        <section>
          <h2 style={{ fontSize: 14, color: "#374151", marginBottom: 8 }}>Items from API</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map(item => (
              <li key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#4b5563" }}>
                <strong>#{item.id}</strong> — {item.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
