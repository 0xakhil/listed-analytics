import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LISTED Analytics",
  description: "Protocol analytics for listed.exchange on Robinhood Chain",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-ivory antialiased">{children}</body>
    </html>
  );
}
