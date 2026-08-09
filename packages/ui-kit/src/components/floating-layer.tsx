/** Internal portal and viewport geometry shared by floating UI Kit surfaces. */

import {
  useLayoutEffect,
  useRef,
  useState,
  type AriaRole,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import styles from "./floating-layer.module.css";

export type FloatingLayerSide = "top" | "bottom" | "left" | "right";

export type FloatingLayerProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  side?: FloatingLayerSide;
  matchAnchorWidth?: boolean;
  offset?: number;
  id?: string;
  role?: AriaRole;
  ariaLabel?: string;
  ariaMultiselectable?: boolean;
  className?: string;
  layerRef?: RefObject<HTMLDivElement | null>;
};

type LayerGeometry = {
  side: FloatingLayerSide;
  style: CSSProperties;
};

const viewportGutter = 8;

function opposite(side: FloatingLayerSide): FloatingLayerSide {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  if (side === "left") return "right";
  return "left";
}

function availableSpace(side: FloatingLayerSide, anchor: DOMRect, width: number, height: number) {
  if (side === "top") return anchor.top - viewportGutter;
  if (side === "bottom") return height - anchor.bottom - viewportGutter;
  if (side === "left") return anchor.left - viewportGutter;
  return width - anchor.right - viewportGutter;
}

function requiredSpace(side: FloatingLayerSide, layer: DOMRect, offset: number) {
  return (side === "top" || side === "bottom" ? layer.height : layer.width) + offset;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}

function geometry(
  preferredSide: FloatingLayerSide,
  anchor: DOMRect,
  layer: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
  offset: number,
  matchAnchorWidth: boolean,
): LayerGeometry {
  const fallbackSide = opposite(preferredSide);
  const preferredRoom = availableSpace(preferredSide, anchor, viewportWidth, viewportHeight);
  const fallbackRoom = availableSpace(fallbackSide, anchor, viewportWidth, viewportHeight);
  const side =
    preferredRoom < requiredSpace(preferredSide, layer, offset) && fallbackRoom > preferredRoom
      ? fallbackSide
      : preferredSide;
  const maxWidth = Math.max(0, viewportWidth - viewportGutter * 2);
  const maxHeight = Math.max(0, viewportHeight - viewportGutter * 2);
  const width = Math.min(Math.max(layer.width, matchAnchorWidth ? anchor.width : 0), maxWidth);
  const height = Math.min(layer.height, maxHeight);
  const rawLeft =
    side === "left"
      ? anchor.left - width - offset
      : side === "right"
        ? anchor.right + offset
        : anchor.left;
  const rawTop =
    side === "top"
      ? anchor.top - height - offset
      : side === "bottom"
        ? anchor.bottom + offset
        : anchor.top;

  return {
    side,
    style: {
      left: `${clamp(rawLeft, viewportGutter, viewportWidth - width - viewportGutter)}px`,
      top: `${clamp(rawTop, viewportGutter, viewportHeight - height - viewportGutter)}px`,
      maxWidth: `${maxWidth}px`,
      maxHeight: `${maxHeight}px`,
      minWidth: matchAnchorWidth ? `${Math.min(anchor.width, maxWidth)}px` : undefined,
    },
  };
}

export function FloatingLayer({
  open,
  anchorRef,
  children,
  side = "bottom",
  matchAnchorWidth = false,
  offset = 4,
  id,
  role,
  ariaLabel,
  ariaMultiselectable,
  className,
  layerRef: externalLayerRef,
}: FloatingLayerProps) {
  const internalLayerRef = useRef<HTMLDivElement | null>(null);
  const layerRef = externalLayerRef ?? internalLayerRef;
  const [resolved, setResolved] = useState<LayerGeometry>();

  useLayoutEffect(() => {
    if (!open) {
      setResolved(undefined);
      return;
    }
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    const ownerWindow = anchor?.ownerDocument.defaultView;
    if (!anchor || !layer || !ownerWindow) return;

    const update = () => {
      setResolved(
        geometry(
          side,
          anchor.getBoundingClientRect(),
          layer.getBoundingClientRect(),
          ownerWindow.innerWidth,
          ownerWindow.innerHeight,
          offset,
          matchAnchorWidth,
        ),
      );
    };

    update();
    ownerWindow.addEventListener("resize", update);
    ownerWindow.addEventListener("scroll", update, true);
    return () => {
      ownerWindow.removeEventListener("resize", update);
      ownerWindow.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, layerRef, matchAnchorWidth, offset, open, side]);

  const body = anchorRef.current?.ownerDocument.body;
  if (!open || !body) return null;

  return createPortal(
    <div
      ref={layerRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-multiselectable={ariaMultiselectable}
      className={`${styles.layer}${className ? ` ${className}` : ""}`}
      data-side={resolved?.side ?? side}
      style={{ ...resolved?.style, visibility: resolved ? undefined : "hidden" }}
    >
      {children}
    </div>,
    body,
  );
}
