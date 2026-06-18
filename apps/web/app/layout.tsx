import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "pokt-mcp",
  description: "AI agents × Pocket Network × natural language RPC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
