"use client";
import { AnimatePresence, MotionConfig, motion, useIsPresent } from "framer-motion";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { usePathname } from "next/navigation";
import { useContext, useRef } from "react";
import { consumeHistoryNav, consumeProgrammaticBack } from "@/lib/utils/nav-intent";
import {
  type Direction,
  type NavSource,
  resolveDirection,
} from "@/lib/utils/page-transition";

// Decisive ease-out: arrives and stops. The previous curve (0.16, 1, 0.3, 1)
// spent 57% of its duration covering the last 5% of the distance, which reads
// as the page drifting instead of landing.
const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const DURATION = 0.24;
const SLIDE = { duration: DURATION, ease: EASE };
const INSTANT = { duration: 0 };

// How far the outgoing page slides under the incoming one. iOS moves the
// outgoing view about a third of the screen with a slight dim; that coupling is
// most of what makes a push feel physical rather than like a card being dealt
// on top of a static background.
const PARALLAX = 30;

// Variants are resolved from `custom` at the moment they run. That matters for
// exit: AnimatePresence keeps the *previous* React element mounted while it
// leaves, so a plain `exit={...}` prop would carry the direction of whatever
// navigation brought that page in, not the one taking it away. Passing `custom`
// on AnimatePresence overrides it for exiting children, so the page always
// leaves in the direction of the navigation that replaced it.
const variants = {
  enter: (dir: Direction) => ({
    x: dir === "forward" ? "100%" : dir === "back" ? "-100%" : 0,
    opacity: 1,
  }),
  center: (dir: Direction) => ({
    x: 0,
    opacity: 1,
    transition: dir === "none" ? INSTANT : SLIDE,
  }),
  exit: (dir: Direction) => ({
    x: dir === "forward" ? `-${PARALLAX}%` : dir === "back" ? `${PARALLAX}%` : 0,
    // Tab switches stay instant — the outgoing page is simply covered by the
    // incoming one (every page paints an opaque bg-background).
    opacity: dir === "none" ? 1 : 0.6,
    transition: dir === "none" ? INSTANT : SLIDE,
  }),
};

/**
 * Holds the App Router context still for a page that is on its way out.
 *
 * `children` here is the router's children slot: a single element whose
 * identity is stable across navigations, so the element AnimatePresence keeps
 * mounted for the exit would otherwise re-render with the *new* route's
 * content. The result is a parallax between two copies of the same screen —
 * the outgoing page swaps to the destination before it slides away.
 *
 * While the page is present the live context passes through untouched, so
 * `router.refresh()` and `revalidatePath()` reach it normally. Only once
 * framer-motion marks it absent does it fall back to the last context it saw.
 *
 * `LayoutRouterContext` is a Next internal with no public equivalent; this is
 * the standard workaround for App Router exit animations. Re-check it on a Next
 * major upgrade — if the import goes away, drop the exit animation rather than
 * ship the double-render.
 */
function FrozenRouter({ children }: { children: React.ReactNode }) {
  const context = useContext(LayoutRouterContext);
  const isPresent = useIsPresent();
  /* eslint-disable react-hooks/refs */
  const lastPresentRef = useRef(context);
  if (isPresent) lastPresentRef.current = context;
  const value = isPresent ? context : lastPresentRef.current;

  if (!value) return <>{children}</>;
  return (
    <LayoutRouterContext.Provider value={value}>
      {children}
    </LayoutRouterContext.Provider>
  );
  /* eslint-enable react-hooks/refs */
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);
  const dirRef = useRef<Direction>("none");

  // Compute direction synchronously during render so the animation is
  // correct when the motion.div mounts with the new key. Using refs (not
  // state) here is intentional — state would force an extra render before
  // the new direction can be picked up.
  /* eslint-disable react-hooks/refs */
  if (prevPathRef.current !== pathname) {
    // Set by the pre-hydration listener in the root layout, which is
    // guaranteed to have run before the router's own.
    const popped = consumeHistoryNav();
    // Consume unconditionally so a marked call that never navigated cannot
    // survive to colour the next gesture. (It also self-clears on a timer.)
    const wasProgrammatic = consumeProgrammaticBack();
    const source: NavSource = popped
      ? wasProgrammatic
        ? "programmatic-back"
        : "history"
      : "push";
    dirRef.current = resolveDirection(prevPathRef.current, pathname, source);
    prevPathRef.current = pathname;
  }

  const dir = dirRef.current;
  /* eslint-enable react-hooks/refs */

  return (
    // reducedMotion="user" drops transform animations for users who ask for
    // them app-wide: page pushes here, plus every BottomSheet, since sheets
    // render inside this subtree.
    <MotionConfig reducedMotion="user">
      {/* overflow-hidden clips both pages while they cross;
          relative gives the exiting (absolutely positioned) page a stable
          containing block. */}
      <div className="relative overflow-hidden">
        {/* popLayout takes the outgoing page out of flow so the two do not
            stack vertically during the crossover. */}
        {/* presenceAffectsLayout={false}: the default (true) makes
            framer-motion put `Math.random()` in a useMemo dep array to force
            surrounding components to re-render on a layout shift. Under
            cacheComponents that is a prerender error on every route, since
            this sits in the root layout with no Suspense above it. We use no
            `layout` animations anywhere, so the re-render it buys is worth
            nothing here. */}
        <AnimatePresence
          initial={false}
          mode="popLayout"
          custom={dir}
          presenceAffectsLayout={false}
        >
          <motion.div
            key={pathname}
            custom={dir}
            // `relative` is load-bearing, not cosmetic — do not remove it.
            // popLayout gives the outgoing page `position: absolute`, and a
            // positioned element paints above an in-flow one whatever the DOM
            // order, so without this the old page is drawn *over* the new one
            // for the whole slide. Making both positioned puts them back in
            // DOM order, and the incoming page (rendered second) covers it.
            //
            // This also hides a framer-motion artifact: opacity is driven by
            // the Web Animations API, so when the exit animation ends its
            // effect is released and computed opacity snaps from 0.6 back to
            // the inline 1 for one frame before React unmounts the element.
            // Measured on a prod build, the incoming page covers the full
            // viewport ~60 ms before that happens, so the frame is occluded.
            // Painted on top, it was a visible flash of the old screen.
            //
            // `page-layer` is the hook for the placeholder→content crossfade
            // in globals.css. See the comment there.
            className="page-layer relative"
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            // A page at rest must not carry a transform: a transformed ancestor
            // becomes the containing block for `position: fixed` descendants,
            // which would break every bottom sheet. framer-motion would leave
            // `translateX(0%)` behind, so emit `none` once the page has landed.
            //
            // Derived from the current value rather than cleared imperatively
            // in onAnimationComplete. That callback fires per animation, but
            // both pages render from this one JSX node and so shared a single
            // ref — a navigation interrupted mid-slide could fire the outgoing
            // page's callback and wipe the *incoming* page's transform in
            // flight, snapping it to its final position. Reading the value
            // instead is correct at every frame, interrupted or not.
            transformTemplate={(latest, generated) =>
              latest.x === undefined ||
              latest.x === 0 ||
              latest.x === "0%" ||
              latest.x === "0px"
                ? "none"
                : generated
            }
          >
            <FrozenRouter>{children}</FrozenRouter>
          </motion.div>
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
