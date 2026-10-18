import { BackgroundArt } from "@/components/BackgroundArt";
import { PageTransition } from "@/components/PageTransition";
import { TopNav } from "@/components/TopNav";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kairos",
  description: "集中と休憩に合わせて生成BGMが変化するポモドーロタイマー。",
  icons: { apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0C",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ServiceWorkerRegistrar />
        {/* ヘッダーとページ本体、どちらの裏側にも回り込む唯一の背景アート。境界を作らない。 */}
        <BackgroundArt />
        <div className="relative z-10 flex min-h-full flex-1 flex-col">
          <TopNav />
          <PageTransition>{children}</PageTransition>
        </div>
      </body>
    </html>
  );
}
