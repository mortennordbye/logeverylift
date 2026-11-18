/**
 * Step alerts in the browser (docs/plans/bike-ride-logger.md, 4.7): find out
 * whether this device can get them, turn them on, and forget them on sign-out.
 *
 * The push service worker is public/push-sw.js with the scope "/push/", so it
 * controls no page. On an iPhone, push works only in the app added to the
 * home screen.
 */

import { deletePushSubscription, savePushSubscription } from "@/lib/actions/push";
import { callAction } from "@/lib/utils/stale-bundle";

export const PUSH_SW_URL = "/push-sw.js";
export const PUSH_SCOPE = "/push/";

/**
 * - `server_off`: no VAPID keys on the server, so nothing to turn on.
 * - `home_screen`: an iPhone or iPad outside the home-screen app.
 * - `unsupported`: a browser with no web push.
 * - `blocked`: the user said no to notifications.
 * - `off`: can be turned on. `on`: this device gets alerts.
 */
export type StepAlertsState = "checking" | "server_off" | "home_screen" | "unsupported" | "blocked" | "off" | "on";

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function pushRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration(PUSH_SCOPE).catch(() => undefined);
}

/** This device's state, read without asking the user anything. */
export async function detectStepAlerts(publicKey: string | null): Promise<StepAlertsState> {
  if (!publicKey) return "server_off";
  if (isIos() && !isStandalone()) return "home_screen";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await pushRegistration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

function activated(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const worker = reg.installing ?? reg.waiting;
  return new Promise((resolve, reject) => {
    worker?.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve();
      else if (worker.state === "redundant") reject(new Error("service worker not installed"));
    });
  });
}

/**
 * Ask for notifications, register the push worker, subscribe and save the
 * subscription for the signed-in user. Call it inside the tap: iOS asks for
 * permission only in a user gesture.
 */
export async function turnOnStepAlerts(publicKey: string): Promise<{ state: StepAlertsState; error?: string }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { state: permission === "denied" ? "blocked" : "off" };
  try {
    const reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SCOPE });
    await activated(reg);
    const key = keyBytes(publicKey);
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with an older server key cannot take this server's pushes.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const saved = await callAction(savePushSubscription(sub.toJSON()));
    if (!saved.success) return { state: "off", error: saved.error };
    return { state: "on" };
  } catch {
    return { state: "off", error: "Step alerts could not be turned on" };
  }
}

/** Before sign-out: the server forgets this device for the user, and the browser drops the subscription. */
export async function forgetStepAlerts(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const sub = await (await pushRegistration())?.pushManager.getSubscription();
    if (!sub) return;
    await callAction(deletePushSubscription({ endpoint: sub.endpoint })).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // Offline or blocked: the push service answers 410 later and the server deletes the row then.
  }
}
