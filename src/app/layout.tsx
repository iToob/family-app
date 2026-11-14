import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/sw-register";
import { Toaster } from "@/components/forms";

export const metadata: Metadata = {
  title: "Family Economy",
  description: "Our family's private economy: earn, spend, save and convert Points.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Family Economy", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0e3b36",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
        <ServiceWorker />
      </body>
    </html>
  );
}
