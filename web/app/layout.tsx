import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AppNav } from "@/components/app-nav";
import { ReactQueryProvider } from "@/components/react-query-provider";

export const metadata: Metadata = {
  title: "NEARena · Blood and Glory",
  description: "On-chain gladiator arena on NEAR.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ReactQueryProvider>
          <header className="site-header">
            <div className="site-header-inner">
              <Link href="/" className="site-brand" aria-label="NEARena home">
                <span className="eyebrow">NEARena</span>
                <span className="site-title">Blood and Glory</span>
              </Link>
              <AppNav />
            </div>
          </header>
          <div className="page-wrap">{children}</div>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
