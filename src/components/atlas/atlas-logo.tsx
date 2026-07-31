import Image from "next/image";
import type { CSSProperties } from "react";

export type AtlasLogoVariant = "auto" | "light" | "dark";

type AtlasLogoProps = {
  className?: string;
  priority?: boolean;
  showWordmark?: boolean;
  size?: number;
  variant?: AtlasLogoVariant;
};

export function AtlasLogo({
  className = "",
  priority = false,
  showWordmark = true,
  size = 40,
  variant = "auto",
}: AtlasLogoProps) {
  const style = { "--atlas-logo-size": `${size}px` } as CSSProperties;

  return (
    <span
      className={`atlas-logo atlas-logo-${variant} ${className}`.trim()}
      style={style}
      role={showWordmark ? undefined : "img"}
      aria-label={showWordmark ? undefined : "Atlas"}
    >
      <span className="atlas-logo-symbol" aria-hidden="true">
        <Image
          className="atlas-logo-image atlas-logo-image-light"
          src="/icons/atlas-app-icon-light.png"
          alt=""
          width={1024}
          height={1024}
          loading={priority ? "eager" : undefined}
          fetchPriority={priority ? "high" : undefined}
          sizes={`${size}px`}
        />
        <Image
          className="atlas-logo-image atlas-logo-image-dark"
          src="/icons/atlas-app-icon-dark.png"
          alt=""
          width={1024}
          height={1024}
          loading={priority ? "eager" : undefined}
          fetchPriority={priority ? "high" : undefined}
          sizes={`${size}px`}
        />
      </span>
      {showWordmark ? <span className="atlas-logo-wordmark">Atlas</span> : null}
    </span>
  );
}
