type AtlasMarkProps = {
  className?: string;
  decorative?: boolean;
};

export function AtlasMark({ className = "", decorative = false }: AtlasMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "Símbolo Atlas"}
    >
      <path
        d="M10.3 31.2c7.7 7.5 20 8 27.7 1.1 5.1-4.5 5.9-11 1.9-14.6-4.8-4.3-14.7-2.8-22.2 3.4-6 5-8.6 11-5.8 13.8 3.7 3.8 13.8.5 22.4-7.3"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M14.4 37.5c-4.8-7.4-3.8-17.1 2.5-23.4 6.2-6.2 15.7-7.3 23-2.8"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="15.4" cy="35.8" r="2.8" fill="currentColor" />
      <circle cx="39.7" cy="12.8" r="1.8" fill="currentColor" opacity=".55" />
    </svg>
  );
}
