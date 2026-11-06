import type { Metadata } from "next";
import "./globals.css";
import { AppNav } from "@/components/app-nav";
import { ThemeSwitcher } from "@/components/theme-switcher";

export const metadata: Metadata = {
  title: "Gladiator Wallet Register",
  description: "Minimal Near and Solana player registration UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <div>
              <p className="eyebrow">NEARena</p>
              <h1 className="site-title">Blood and Glory</h1>
            </div>
            <ThemeSwitcher />
          </div>
          <AppNav />
        </header>
        <div className="page-wrap">{children}</div>
      </body>
    </html>
  );
}
