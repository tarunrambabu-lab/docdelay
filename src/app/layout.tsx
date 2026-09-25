import type { Metadata } from "next";
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
  title: "DocDelay",
  description: "Front-desk dashboard for doctor delays",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 font-sans text-slate-900">
        {/* Slim notice on every page: this is a demo with made-up data. */}
        <div className="bg-slate-900 px-4 py-1.5 text-center text-xs text-slate-200">
          Live demo · All hospitals, doctors and patients are fictional · Calls and texts are
          simulated
        </div>
        {children}
      </body>
    </html>
  );
}
