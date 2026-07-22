import { OrbitalBackground } from "@/components/atlas/orbital-background";

/** Fixed visual layer shared by every authenticated shell. */
export function AtlasAppBackground() {
  return (
    <div className="atlas-app-background" aria-hidden="true">
      <OrbitalBackground />
      <div className="atlas-app-background-readability" />
    </div>
  );
}
