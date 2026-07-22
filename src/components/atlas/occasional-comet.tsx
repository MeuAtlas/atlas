"use client";

import { useEffect, useRef } from "react";

const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

type ScheduleReason = "first" | "next" | "resume";
type CometSide = "left" | "right";

type CometTrajectory = {
  side: CometSide;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  curvature: number;
  duration: number;
  opacity: number;
};

const INTERVALS = {
  development: {
    first: { min: 2_000, max: 4_000 },
    next: { min: 6_000, max: 12_000 },
  },
  production: {
    first: { min: 5_000, max: 10_000 },
    next: { min: 20_000, max: 40_000 },
  },
} as const;

function randomBetween(minimum: number, maximum: number) {
  const min = Math.min(minimum, maximum);
  const max = Math.max(minimum, maximum);
  const value = min + Math.random() * (max - min);

  return Math.min(max, Math.max(min, value));
}

function getNextInterval(reason: ScheduleReason) {
  const isInitialWindow = reason === "first" || reason === "resume";

  if (!IS_DEVELOPMENT) {
    const range = isInitialWindow
      ? INTERVALS.production.first
      : INTERVALS.production.next;
    return randomBetween(range.min, range.max);
  }

  if (isInitialWindow) {
    const range = INTERVALS.development.first;
    return randomBetween(range.min, range.max);
  }

  const range = INTERVALS.development.next;
  return randomBetween(range.min, range.max);
}

function createTrajectory(element: HTMLSpanElement): CometTrajectory {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isMobile = viewportWidth <= 640;
  const side: CometSide = Math.random() < 0.5 ? "left" : "right";
  const direction = side === "left" ? 1 : -1;
  const cometWidth = element.offsetWidth;
  const card = document.querySelector<HTMLElement>(".atlas-auth-card");
  const cardRect = card?.getBoundingClientRect();
  const horizontalMargin = isMobile ? 8 : Math.max(20, viewportWidth * 0.02);

  let startCoreX: number;
  let travel: number;
  let useTopCorridor = isMobile;

  if (isMobile) {
    travel = randomBetween(viewportWidth * 0.12, viewportWidth * 0.22);

    if (side === "left") {
      startCoreX = randomBetween(
        cometWidth + horizontalMargin,
        viewportWidth * 0.24,
      );
    } else {
      startCoreX = randomBetween(
        viewportWidth * 0.76,
        viewportWidth - cometWidth - horizontalMargin,
      );
    }
  } else {
    const protectedMargin = 28;
    const leftLimit = cardRect
      ? cardRect.left - protectedMargin
      : viewportWidth * 0.43;
    const rightLimit = cardRect
      ? cardRect.right + protectedMargin
      : viewportWidth * 0.57;
    const outerLeft = cometWidth + horizontalMargin;
    const outerRight = viewportWidth - cometWidth - horizontalMargin;
    const availableTravel = side === "left"
      ? leftLimit - outerLeft
      : outerRight - rightLimit;

    if (availableTravel < 72) {
      useTopCorridor = true;
      travel = randomBetween(viewportWidth * 0.1, viewportWidth * 0.16);
      startCoreX = side === "left"
        ? randomBetween(outerLeft, viewportWidth * 0.24)
        : randomBetween(viewportWidth * 0.76, outerRight);
    } else {
      travel = Math.min(
        randomBetween(viewportWidth * 0.1, viewportWidth * 0.19),
        availableTravel * 0.76,
      );

      if (side === "left") {
        startCoreX = randomBetween(outerLeft, leftLimit - travel);
      } else {
        startCoreX = randomBetween(rightLimit + travel, outerRight);
      }
    }
  }

  const deltaX = travel * direction;
  const maxSkyY = useTopCorridor
    ? Math.max(28, Math.min(viewportHeight * 0.18, (cardRect?.top ?? viewportHeight * 0.2) - 18))
    : viewportHeight * 0.4;
  const deltaY = useTopCorridor
    ? randomBetween(5, Math.min(14, viewportHeight * 0.018))
    : randomBetween(viewportHeight * 0.025, viewportHeight * 0.07);
  const minimumY = useTopCorridor ? 5 : viewportHeight * 0.07;
  const maximumStartY = Math.max(minimumY, maxSkyY - deltaY - 10);
  const startY = randomBetween(minimumY, maximumStartY);
  const curvature = randomBetween(
    isMobile ? 1 : 2.5,
    isMobile ? 3 : 5.5,
  ) * (Math.random() < 0.5 ? -1 : 1);
  const baseOpacity = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--comet-opacity"),
  ) || 0.12;

  return {
    side,
    startX: startCoreX - cometWidth,
    startY,
    deltaX,
    deltaY,
    curvature,
    duration: randomBetween(1_300, 2_100),
    opacity: baseOpacity * randomBetween(0.78, 1),
  };
}

function getTransform(trajectory: CometTrajectory, progress: number, scale: number) {
  const distance = Math.hypot(trajectory.deltaX, trajectory.deltaY);
  const curveOffset = trajectory.curvature * Math.sin(Math.PI * progress);
  const curveVelocity = trajectory.curvature * Math.PI * Math.cos(Math.PI * progress);
  const perpendicularX = -trajectory.deltaY / distance;
  const perpendicularY = trajectory.deltaX / distance;
  const x = trajectory.deltaX * progress + perpendicularX * curveOffset;
  const y = trajectory.deltaY * progress + perpendicularY * curveOffset;
  const velocityX = trajectory.deltaX + perpendicularX * curveVelocity;
  const velocityY = trajectory.deltaY + perpendicularY * curveVelocity;
  const baseAngle = Math.atan2(trajectory.deltaY, trajectory.deltaX) * (180 / Math.PI);
  let angle = Math.atan2(velocityY, velocityX) * (180 / Math.PI);

  while (angle - baseAngle > 180) angle -= 360;
  while (angle - baseAngle < -180) angle += 360;

  return `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})`;
}

export function OccasionalComet() {
  const cometRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const visualAnimationsRef = useRef<Animation[]>([]);
  const activeRef = useRef(false);

  useEffect(() => {
    const element = cometRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;

    if (!element || typeof element.animate !== "function") return;

    const clearScheduledComet = () => {
      if (timeoutRef.current === null) return;
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };

    const cancelActiveComet = () => {
      const animation = animationRef.current;
      animationRef.current = null;
      activeRef.current = false;

      for (const visualAnimation of visualAnimationsRef.current) {
        visualAnimation.cancel();
      }
      visualAnimationsRef.current = [];

      if (animation) {
        animation.onfinish = null;
        animation.cancel();
      }
    };

    const scheduleComet = (reason: ScheduleReason) => {
      clearScheduledComet();

      if (
        disposed ||
        reducedMotion.matches ||
        document.visibilityState === "hidden" ||
        activeRef.current
      ) {
        return;
      }

      const delay = getNextInterval(reason);

      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;

        if (
          disposed ||
          reducedMotion.matches ||
          document.visibilityState === "hidden" ||
          activeRef.current
        ) {
          return;
        }

        const trajectory = createTrajectory(element);
        element.style.left = `${trajectory.startX}px`;
        element.style.top = `${trajectory.startY}px`;
        element.dataset.quadrant = trajectory.side;
        activeRef.current = true;

        const animation = element.animate(
          [
            {
              offset: 0,
              opacity: 0,
              transform: getTransform(trajectory, 0, 0.88),
            },
            {
              offset: 0.08,
              opacity: trajectory.opacity,
              transform: getTransform(trajectory, 0.08, 1),
            },
            {
              offset: 0.3,
              opacity: trajectory.opacity,
              transform: getTransform(trajectory, 0.3, 1),
            },
            {
              offset: 0.55,
              opacity: trajectory.opacity,
              transform: getTransform(trajectory, 0.55, 1),
            },
            {
              offset: 0.78,
              opacity: trajectory.opacity,
              transform: getTransform(trajectory, 0.78, 1),
            },
            {
              offset: 0.9,
              opacity: trajectory.opacity,
              transform: getTransform(trajectory, 0.9, 0.98),
            },
            {
              offset: 1,
              opacity: 0,
              transform: getTransform(trajectory, 1, 0.92),
            },
          ],
          {
            duration: trajectory.duration,
            easing: "linear",
            fill: "both",
          },
        );

        const core = element.querySelector<HTMLElement>(".atlas-comet-core");
        const tail = element.querySelector<HTMLElement>(".atlas-comet-tail");
        const residual = element.querySelector<HTMLElement>(".atlas-comet-residual");
        const sharedTiming: KeyframeAnimationOptions = {
          duration: trajectory.duration,
          easing: "linear",
          fill: "both",
        };
        const visualAnimations: Animation[] = [];

        if (core) {
          visualAnimations.push(core.animate(
            [
              { offset: 0, opacity: 0, transform: "translateY(-50%) scale(.82)" },
              { offset: 0.08, opacity: 1, transform: "translateY(-50%) scale(1)" },
              { offset: 0.78, opacity: 1, transform: "translateY(-50%) scale(1)" },
              { offset: 0.88, opacity: 0.56, transform: "translateY(-50%) scale(.94)" },
              { offset: 1, opacity: 0, transform: "translateY(-50%) scale(.72)" },
            ],
            sharedTiming,
          ));
        }

        if (tail) {
          visualAnimations.push(tail.animate(
            [
              { offset: 0, opacity: 0, clipPath: "inset(0 0% 0 0)" },
              { offset: 0.08, opacity: 1, clipPath: "inset(0 0% 0 0)" },
              { offset: 0.82, opacity: 1, clipPath: "inset(0 0% 0 0)" },
              { offset: 0.88, opacity: 0.78, clipPath: "inset(0 24% 0 0)" },
              { offset: 0.94, opacity: 0.38, clipPath: "inset(0 62% 0 0)" },
              { offset: 1, opacity: 0, clipPath: "inset(0 100% 0 0)" },
            ],
            sharedTiming,
          ));
        }

        if (residual) {
          visualAnimations.push(residual.animate(
            [
              { offset: 0, opacity: 0, clipPath: "inset(0 0% 0 0)" },
              { offset: 0.12, opacity: 0.2, clipPath: "inset(0 0% 0 0)" },
              { offset: 0.86, opacity: 0.2, clipPath: "inset(0 0% 0 0)" },
              { offset: 0.92, opacity: 0.16, clipPath: "inset(0 18% 0 0)" },
              { offset: 0.97, opacity: 0.08, clipPath: "inset(0 58% 0 0)" },
              { offset: 1, opacity: 0, clipPath: "inset(0 100% 0 0)" },
            ],
            sharedTiming,
          ));
        }

        animationRef.current = animation;
        visualAnimationsRef.current = visualAnimations;
        animation.onfinish = () => {
          if (disposed || animationRef.current !== animation) return;

          animation.onfinish = null;
          animation.cancel();
          for (const visualAnimation of visualAnimationsRef.current) {
            visualAnimation.cancel();
          }
          visualAnimationsRef.current = [];
          animationRef.current = null;
          activeRef.current = false;
          scheduleComet("next");
        };
      }, delay);
    };

    const stopComets = () => {
      clearScheduledComet();
      cancelActiveComet();
    };

    const handleMotionPreference = () => {
      if (reducedMotion.matches) {
        stopComets();
      } else if (document.visibilityState === "visible") {
        scheduleComet("resume");
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopComets();
      } else if (!reducedMotion.matches) {
        scheduleComet("resume");
      }
    };

    reducedMotion.addEventListener("change", handleMotionPreference);
    document.addEventListener("visibilitychange", handleVisibility);
    scheduleComet("first");

    return () => {
      disposed = true;
      stopComets();
      reducedMotion.removeEventListener("change", handleMotionPreference);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <span ref={cometRef} className="atlas-comet">
      <span className="atlas-comet-residual" />
      <span className="atlas-comet-tail" />
      <span className="atlas-comet-core" />
    </span>
  );
}
