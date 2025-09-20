/**
 * Root Layout Component
 * 
 * This is the root layout for the CommunityGPT application.
 * Provides the base HTML structure and metadata.
 */

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
  title: "CommunityGPT - AI-Powered Community Analytics",
  description: "Get data-driven insights about your community engagement and marketing ROI with CommunityGPT, powered by TRIBEROI.",
  keywords: ["community analytics", "marketing ROI", "AI assistant", "community engagement", "data insights"],
  authors: [{ name: "TRIBEROI" }],
  viewport: "width=device-width, initial-scale=1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
