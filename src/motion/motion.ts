/** One motion system. Values mirror the CSS tokens in styles/tokens.css. */

export const DURATION = { fast: 120, base: 200, slow: 320, xslow: 480 } as const;
export const EASE = {
  standard: 'cubic-bezier(.2,0,0,1)',
  emphasized: 'cubic-bezier(.3,0,0,1)',
  spring:
    'linear(0, 0.062, 0.207, 0.384, 0.559, 0.713, 0.837, 0.929, 0.992, 1.03, 1.049, 1.054, 1.051, 1.044, 1.034, 1.025, 1.016, 1.009, 1.004, 1.001, 0.999, 0.997, 0.997, 0.997, 0.998, 0.998, 1)',
} as const;

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 5 with ?motion=slow, otherwise 1. */
export const motionScale = () => (document.documentElement.dataset.motion === 'slow' ? 5 : 1);

export interface AnimateOptions {
  duration?: keyof typeof DURATION;
  easing?: keyof typeof EASE;
  delay?: number;
  fill?: FillMode;
}

/**
 * Web Animations helper. Honours ?motion=slow, and under prefers-reduced-motion
 * it drops movement (anything but opacity) and shortens to a quick fade.
 */
export function animate(el: Element, keyframes: Keyframe[], opts: AnimateOptions = {}): Animation {
  const reduced = prefersReducedMotion();
  const frames = reduced
    ? keyframes.map((k) => (k.opacity !== undefined ? { opacity: k.opacity, offset: k.offset } : { offset: k.offset }))
    : keyframes;
  const base = reduced ? DURATION.fast : DURATION[opts.duration ?? 'base'];
  return el.animate(frames, {
    duration: base * motionScale(),
    easing: reduced ? EASE.standard : EASE[opts.easing ?? 'standard'],
    delay: reduced ? 0 : (opts.delay ?? 0) * motionScale(),
    fill: opts.fill ?? 'both',
  });
}
