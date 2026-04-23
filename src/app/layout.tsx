import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Skybird — real-time airline deal hunter",
    template: "%s · Skybird",
  },
  description:
    "Skybird tracks airline fares, deal feeds, and Twitter every minute to surface significantly discounted flights.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Skybird",
    description: "Real-time airline deal hunter.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} dark`}>
      <body className="relative min-h-screen antialiased">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-grid" />
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 glow" />
        <SiteHeader />
        <main className="relative">{children}</main>
        <footer className="container mt-24 flex flex-col items-start justify-between gap-3 border-t border-border/60 py-8 text-[11px] text-muted-foreground md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <span className="num">Skybird v0.1</span>
            <span className="text-muted-foreground/50">·</span>
            <span>Polling every 60s across Duffel, Amadeus, curated feeds, and X</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/api/health" className="hover:text-foreground">status</a>
            <a href="/api/sources" className="hover:text-foreground">sources</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
