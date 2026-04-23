import { useState } from "react";

export function Home() {
  const [input, setInput] = useState("");

  return (
    <div className="flex flex-col h-full">
      {/* Command Bar area */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 max-w-2xl mx-auto w-full">
        <h2 className="text-2xl font-semibold mb-2">What can I help you with?</h2>
        <p className="text-[var(--color-text-tertiary)] mb-6 text-sm">
          Describe a task, or pick a folder to get started.
        </p>
        <div className="w-full relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell me what you want to do..."
            className="w-full px-4 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)] text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                // TODO: trigger agent
                console.log("Execute:", input);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
