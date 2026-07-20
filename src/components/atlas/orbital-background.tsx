import { OccasionalComet } from "./occasional-comet";

const BACKGROUNDS = {
  light: {
    desktop: "/assets/atlas/login-desktop-light.png",
    mobile: "/assets/atlas/login-mobile-light.png",
  },
  dark: {
    desktop: "/assets/atlas/login-desktop-dark.png",
    mobile: "/assets/atlas/login-mobile-dark.png",
  },
} as const;

function LandscapeLayer({ theme }: { theme: keyof typeof BACKGROUNDS }) {
  const sources = BACKGROUNDS[theme];

  return (
    <picture className={`atlas-landscape atlas-landscape-${theme}`}>
      <source media="(max-width: 640px)" srcSet={sources.mobile} />
      <img
        src={sources.desktop}
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority="high"
      />
    </picture>
  );
}

export function OrbitalBackground() {
  return (
    <div className="atlas-orbital-background" aria-hidden="true">
      <LandscapeLayer theme="light" />
      <LandscapeLayer theme="dark" />
      <div className="atlas-landscape-scrim" />

      <svg className="atlas-orbits" viewBox="0 0 1440 360" preserveAspectRatio="none">
        <defs>
          <linearGradient id="orbit" x1="100" y1="100" x2="1300" y2="800" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" stopOpacity=".04" />
            <stop offset=".46" stopColor="#DCE5FF" stopOpacity=".32" />
            <stop offset="1" stopColor="#BFD0FF" stopOpacity=".05" />
          </linearGradient>
          <radialGradient id="spark">
            <stop stopColor="white" />
            <stop offset=".2" stopColor="#DDE5FF" />
            <stop offset="1" stopColor="#91AAFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g fill="none" stroke="url(#orbit)" strokeWidth=".7">
          <path d="M-100 298C270 72 690 48 1080 188c175 63 330 96 470 82" />
          <path className="atlas-orbit-detail" d="M-30 345C330 158 742 118 1155 246c145 45 270 64 385 54" />
        </g>

        <circle className="atlas-orbit-dot [--orbit-speed:26s] [offset-path:path('M-100_298C270_72_690_48_1080_188c175_63_330_96_470_82')]" r="5" fill="url(#spark)" />
        <circle className="atlas-orbit-dot atlas-orbit-detail [--orbit-speed:32s] [offset-path:path('M-30_345C330_158_742_118_1155_246c145_45_270_64_385_54')]" r="4.5" fill="url(#spark)" />
      </svg>

      <OccasionalComet />
    </div>
  );
}
