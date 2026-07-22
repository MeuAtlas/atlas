import Image from "next/image";

export function LoginCardHeader() {
  return (
    <div className="atlas-login-card-header" aria-hidden="true">
      <Image
        src="/login/card-header-light.png"
        alt=""
        fill
        sizes="(max-width: 640px) calc(100vw - 32px), 500px"
        quality={90}
        fetchPriority="high"
        className="atlas-login-card-header-image atlas-login-card-header-image-light"
      />
      <Image
        src="/login/card-header-dark.png"
        alt=""
        fill
        sizes="(max-width: 640px) calc(100vw - 32px), 500px"
        quality={90}
        fetchPriority="high"
        className="atlas-login-card-header-image atlas-login-card-header-image-dark"
      />
      <span className="atlas-login-card-header-blend" />
    </div>
  );
}
