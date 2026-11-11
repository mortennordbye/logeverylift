"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One ECharts instance. The library loads on first mount (its own chunk),
 * the chart resizes with its box, and it is disposed on unmount (iOS limits
 * canvas memory).
 *
 * The crosshair: charts use tooltip { trigger: "axis", showContent: false },
 * so ECharts draws only the axis pointer, and onIndex reports the category
 * index under the finger. The caller shows the values in a readout row above
 * the chart, which a finger can't cover.
 */

type Option = Record<string, unknown>;
type EChartsInstance = {
  setOption: (o: Option, opts?: { notMerge?: boolean }) => void;
  resize: () => void;
  dispose: () => void;
  on: (event: string, handler: (e: unknown) => void) => void;
  getZr: () => { on: (event: string, handler: () => void) => void };
};

export function EChart({
  option,
  height,
  ariaLabel,
  onIndex,
  onItemClick,
}: {
  option: Option;
  height: number;
  ariaLabel: string;
  onIndex?: (index: number | null) => void;
  /** A tap on a data item: the item's data value. */
  onItemClick?: (value: unknown) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsInstance | null>(null);
  const onIndexRef = useRef(onIndex);
  const onClickRef = useRef(onItemClick);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onIndexRef.current = onIndex;
    onClickRef.current = onItemClick;
  }, [onIndex, onItemClick]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void import("./echarts-core").then(({ echarts }) => {
      if (disposed || !box.current) return;
      const instance = echarts.init(box.current, null, { renderer: "canvas" }) as unknown as EChartsInstance;
      chart.current = instance;
      instance.on("updateAxisPointer", (e) => {
        const info = (e as { axesInfo?: { value?: number }[] }).axesInfo?.[0];
        onIndexRef.current?.(typeof info?.value === "number" ? info.value : null);
      });
      instance.getZr().on("globalout", () => onIndexRef.current?.(null));
      instance.on("click", (e) => onClickRef.current?.((e as { value?: unknown }).value));
      observer = new ResizeObserver(() => instance.resize());
      observer.observe(box.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready) chart.current?.setOption(option, { notMerge: true });
  }, [option, ready]);

  return (
    <div
      ref={box}
      role="img"
      aria-label={ariaLabel}
      style={{ height, touchAction: "pan-y" }}
      className={`w-full transition-opacity ${ready ? "opacity-100" : "opacity-0"}`}
    />
  );
}
