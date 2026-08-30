import type { Metadata, Viewport } from "next";
import { CompanionHud } from "./companion-hud";
import "./hud.css";

export const metadata: Metadata = {
  title: "TableRead Companion HUD",
  description: "Fast one-thumb poker player logging for iPhone.",
  alternates: { canonical: "/hud" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07120f",
};

export default function HudPage() {
  return <CompanionHud />;
}
