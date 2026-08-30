import type { Metadata, Viewport } from "next";
import { PokerTracker } from "../components/poker-tracker";
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
  return (
    <div className="ios-companion-hud">
      <div className="ios-companion-hud__banner" role="note">
        <strong>Companion HUD</strong>
        <span>Manual tracking only · optimized for fast app switching on iPhone</span>
      </div>
      <PokerTracker />
    </div>
  );
}
