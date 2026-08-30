import type { Metadata } from "next";
import "./globals.css";
import "./ux-optimizations.css";
import "./a-c-hybrid.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://table-read-poker-tracker.xac30x.chatgpt.site"),
  title: "TableRead Poker Tracker",
  description: "Fast, durable player reads for live poker tables.",
  openGraph: {
    title: "TableRead Poker Tracker",
    description: "Fast player reads. One tap at a time.",
    type: "website",
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "TableRead Poker Tracker on a dark green poker table",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TableRead Poker Tracker",
    description: "Fast player reads. One tap at a time.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
