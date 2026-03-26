import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope, Space_Grotesk } from "next/font/google";
import { LocaleProvider } from "@/components/locale-provider";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "Antigravity Agent Manager",
  description: "Mobile Agent Manager Gateway for Antigravity",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0d0d10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${manrope.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`}>
        <LocaleProvider>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
