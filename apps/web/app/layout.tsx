import type { Metadata } from "next";
import "./globals.css";
import { ThemeScript } from "../components/ThemeInit";

export const metadata: Metadata = {
  title: "POKT MCP",
  description: "AI Agents × Pocket Network × MCP — agent-native RPC chat",
  icons: {
    icon: [{ url: "/brand/agent-mark.svg", type: "image/svg+xml" }],
    apple: "/brand/agent-mark.svg",
    shortcut: "/brand/agent-mark.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
