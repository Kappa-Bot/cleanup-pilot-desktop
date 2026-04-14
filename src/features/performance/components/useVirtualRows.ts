import { useCallback, useEffect, useMemo, useState } from "react";
import type { UIEvent } from "react";

interface UseVirtualRowsOptions {
  itemCount: number;
  rowHeight: number;
  overscan?: number;
  defaultViewportHeight?: number;
}

interface UseVirtualRowsResult {
  viewportRef: (node: HTMLDivElement | null) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  startIndex: number;
  endIndex: number;
  padTop: number;
  padBottom: number;
  viewportHeight: number;
}

export function useVirtualRows(options: UseVirtualRowsOptions): UseVirtualRowsResult {
  const {
    itemCount,
    rowHeight,
    overscan = 8,
    defaultViewportHeight = 560
  } = options;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(defaultViewportHeight);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);

  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewportNode(node);
    if (node) {
      setViewportHeight(node.clientHeight || defaultViewportHeight);
    }
  }, [defaultViewportHeight]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop || 0);
  }, []);

  useEffect(() => {
    if (!viewportNode) {
      return;
    }
    const resize = () => {
      setViewportHeight(viewportNode.clientHeight || defaultViewportHeight);
    };
    resize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(() => resize());
    observer.observe(viewportNode);
    return () => observer.disconnect();
  }, [defaultViewportHeight, viewportNode]);

  useEffect(() => {
    const maxScrollTop = Math.max(0, itemCount * rowHeight - viewportHeight);
    if (scrollTop > maxScrollTop) {
      setScrollTop(maxScrollTop);
    }
  }, [itemCount, rowHeight, scrollTop, viewportHeight]);

  return useMemo(() => {
    if (itemCount <= 0 || rowHeight <= 0) {
      return {
        viewportRef,
        onScroll,
        startIndex: 0,
        endIndex: 0,
        padTop: 0,
        padBottom: 0,
        viewportHeight
      };
    }

    const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endIndex = Math.min(itemCount, startIndex + visibleRows + overscan * 2);
    const padTop = startIndex * rowHeight;
    const padBottom = Math.max(0, (itemCount - endIndex) * rowHeight);

    return {
      viewportRef,
      onScroll,
      startIndex,
      endIndex,
      padTop,
      padBottom,
      viewportHeight
    };
  }, [itemCount, onScroll, overscan, rowHeight, scrollTop, viewportHeight, viewportRef]);
}
