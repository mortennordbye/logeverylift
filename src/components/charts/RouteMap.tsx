"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

/**
 * An activity's route on the dark OpenFreeMap tiles (as GymMapClient), coloured
 * along its length by a value per point (HR zone) with MapLibre's built-in
 * line-gradient, and a dot that follows the stream charts' crosshair.
 * Only the browser fetches map tiles; the route itself never leaves the page.
 */

const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
/** The line-gradient expression gets one stop per kept point. */
const MAX_ROUTE_POINTS = 400;

export function RouteMap({
  lat,
  lng,
  colors,
  cursor,
  height,
}: {
  lat: (number | null)[];
  lng: (number | null)[];
  /** One colour per point (same length as lat), e.g. by HR zone. */
  colors: string[];
  /** Index into lat/lng of the crosshair, or null. */
  cursor: number | null;
  height: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !box.current) return;
      maplibregl.setWorkerUrl(new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

      const valid = lat.map((_, i) => i).filter((i) => lat[i] !== null && lng[i] !== null && (lat[i] !== 0 || lng[i] !== 0));
      if (valid.length < 2) return;
      const step = Math.max(1, Math.ceil(valid.length / MAX_ROUTE_POINTS));
      const kept = valid.filter((_, k) => k % step === 0 || k === valid.length - 1);
      const coords = kept.map((i) => [lng[i] as number, lat[i] as number]);

      // Colour stops at each kept point's share of the route length.
      const dist = [0];
      for (let k = 1; k < coords.length; k++) {
        const [x1, y1] = coords[k - 1];
        const [x2, y2] = coords[k];
        const dx = (x2 - x1) * Math.cos((((y1 + y2) / 2) * Math.PI) / 180);
        dist.push(dist[k - 1] + Math.hypot(dx, y2 - y1));
      }
      const total = dist.at(-1) || 1;
      const stops: (number | string)[] = [];
      let last = -1;
      kept.forEach((i, k) => {
        const p = dist[k] / total;
        if (p > last) {
          stops.push(p, colors[i] ?? "#888");
          last = p;
        }
      });

      const bounds = new maplibregl.LngLatBounds();
      for (const c of coords) bounds.extend(c as [number, number]);
      const map = new maplibregl.Map({
        container: box.current,
        style: MAP_STYLE,
        bounds,
        fitBoundsOptions: { padding: 28 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      // The box can still be settling when the map is made; keep the canvas the box's size.
      const observer = new ResizeObserver(() => map.resize());
      observer.observe(box.current);
      map.once("remove", () => observer.disconnect());
      map.on("load", () => {
        map.addSource("route", { type: "geojson", lineMetrics: true, data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } });
        map.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#000", "line-width": 7, "line-opacity": 0.6 }, layout: { "line-cap": "round", "line-join": "round" } });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: { "line-width": 4, "line-gradient": ["interpolate", ["linear"], ["line-progress"], ...stops] as unknown as import("maplibre-gl").ExpressionSpecification },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addSource("cursor", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "cursor", type: "circle", source: "cursor", paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#000", "circle-stroke-width": 2 } });
      });
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, colors]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("cursor") as import("maplibre-gl").GeoJSONSource | undefined;
    if (!source) return;
    const i = cursor;
    source.setData(
      i !== null && lat[i] !== null && lng[i] !== null
        ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lng[i] as number, lat[i] as number] } }
        : { type: "FeatureCollection", features: [] },
    );
  }, [cursor, lat, lng]);

  return <div ref={box} style={{ height }} className="w-full overflow-hidden rounded-xl" aria-label="Route map" role="img" />;
}
