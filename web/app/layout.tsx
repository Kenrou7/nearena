import type { Metadata } from "next";
import "./globals.css";
import { AppNav } from "@/components/app-nav";
import { ReactQueryProvider } from "@/components/react-query-provider";
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
        <ReactQueryProvider>
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
        </ReactQueryProvider>
      </body>
    </html>
  );
}
