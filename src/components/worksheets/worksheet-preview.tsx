"use client";

import type { CSSProperties, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

const INITIAL_SCALE = 0.5;

/**
 * Shows the real 210×297mm sheet at the largest scale that fits its column.
 * The paper is never reflowed to fit the dashboard: only its preview scale
 * changes, and the preview itself owns the vertical scroll.
 */
export function WorksheetPreview({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(INITIAL_SCALE);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const measure = () => {
      const paper = document.createElement("div");
      paper.style.position = "absolute";
      paper.style.width = "210mm";
      paper.style.height = "1px";
      paper.style.visibility = "hidden";
      document.body.appendChild(paper);
      const paperWidth = paper.getBoundingClientRect().width;
      paper.remove();

      const available = Math.max(frame.clientWidth - 32, 1);
      setScale(Math.min(1, available / paperWidth));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="ws-frame worksheet-preview-scroll"
      style={{ "--ws-scale": scale } as CSSProperties}
    >
      <div className="ws-slot">{children}</div>
    </div>
  );
}
