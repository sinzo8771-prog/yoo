"use client";

import { useEffect } from "react";

/**
 * MotionPreference (Task 3).
 * Deliberately minimal: the prefers-reduced-motion contract is enforced in CSS
 * (app/globals.css) so it works without JavaScript. This component only sets a
 * `data-motion` attribute on <html> for any *future* JS-driven animation that
 * needs to branch in script (e.g. pausing a carousel). It renders nothing and
 * adds no dependencies.
 */
export default function MotionPreference() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      document.documentElement.dataset.motion = mq.matches ? "reduced" : "full";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return null;
}