import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  style: ["normal", "italic"],
  weight: ["500", "600", "700"],
});

const themeScript = `
  try {
    var theme = window.localStorage.getItem("speclens-theme");
    if (theme) {
      document.documentElement.dataset.theme = theme;
    }
  } catch (error) {
    // Ignore storage failures so rendering still succeeds.
  }
`;

export const metadata: Metadata = {
  title: {
    default: "SpecLens",
    template: "%s | SpecLens",
  },
  description: "Hosted spec-driven repository analysis with SaaS plans and dual licensing.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="paper" lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body>
    </html>
  );
}
