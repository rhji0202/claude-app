import type { Metadata } from "next";
import { Fira_Sans, Fira_Code } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";

const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-fira-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fira-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "더원 에이전트 (TheOne Agent)",
  description: "Agent SDK 기반 더원 에이전트(TheOne Agent) 관리 대시보드",
};

// FOUC 방지: JS 번들 로드 전에 저장된 테마를 <html>에 반영
const themeScript = `(function(){try{var t=localStorage.getItem('claude_theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${firaSans.variable} ${firaCode.variable}`}>
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
