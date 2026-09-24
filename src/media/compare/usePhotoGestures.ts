import { useMemo } from 'react';
import { Gesture, type ComposedGesture, type GestureType } from 'react-native-gesture-handler';
import { ReduceMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { duration } from '@/ui/motion';

import { intersectRect, moveRing, resizeRing, scaleRing, SCREEN_MARKER_METRICS, dropRing, hitTestScreenMarkers, screenRing } from '../annotate/markerMath';
import type { EditableItem, MarkerEditing } from '../annotate/useMarkerEditing';
import {
  clampViewState,
  IDENTITY_VIEW,
  normToRect,
  panBy,
  pinchFrom,
  rectToNorm,
  toggleZoomAt,
  type Point,
  type Rect,
  type Ring,
  type Size,
  type ViewState,
} from '../geometry';
import type { MarkerRole } from '../annotate/types';
import { animateView, type SharedViewport } from './useSharedViewport';
import { paneImageRect, ZOOMED_EPSILON } from './viewportMath';

/** Double-tap window; also how long a single tap waits before it drops a pin. */
const DOUBLE_TAP_DELAY = 220;
/** Finger travel before a press on a marker becomes a drag (below it, it is a tap = select). */
const DRAG_SLOP = 6;
const TAP_SLOP = 12;
const HOLD_MS = 260;

export interface PhotoGestureOptions {
  viewport: SharedViewport;
  /** Measured size of the view the gesture is attached to. */
  pane: SharedValue<Size>;
  /** Photo the gestures are measured against (AFTER in overlay/slider: the base frame). */
  image: Size;
  /** Marker selection/drop/drag on this surface; omit for view-only panes. */
  editing?: MarkerEditing | null;
  /** Press and hold animates this value to 0 and back on release (overlay "blink" to BEFORE). */
  holdToPeek?: SharedValue<number> | null;
  /** A gesture that beats everything once it activates (the slider divider). */
  priority?: GestureType | null;
}

interface DragState {
  damageId: string;
  role: MarkerRole;
  resize: boolean;
  start: Ring;
  sx: number;
  sy: number;
  startDist: number;
  rect: Rect;
  active: boolean;
}

interface PinchResize {
  damageId: string;
  role: MarkerRole;
  start: Ring;
}

function itemRing(it: EditableItem, editing: MarkerEditing): Ring {
  'worklet';
  const live = editing.live.get();
  return live !== null && live.damageId === it.damageId && live.role === it.role ? live.ring : it.ring;
}

function hitAt(
  p: Point,
  editing: MarkerEditing,
  view: ViewState,
  image: Size,
  pane: Size,
): { item: EditableItem; ring: Ring; resize: boolean; rect: Rect } | null {
  'worklet';
  const items = editing.items.get();
  if (items.length === 0) return null;
  const rect = paneImageRect(view, image, pane);
  const bounds = intersectRect(rect, { x: 0, y: 0, width: pane.width, height: pane.height });
  const resolved: EditableItem[] = [];
  for (let i = 0; i < items.length; i++) resolved.push({ ...items[i], ring: itemRing(items[i], editing) });
  const hit = hitTestScreenMarkers(p, resolved, rect, bounds, SCREEN_MARKER_METRICS);
  if (!hit) return null;
  return { item: resolved[hit.index], ring: resolved[hit.index].ring, resize: hit.part === 'edge', rect };
}

/**
 * Gesture set for one photo surface (IMAGE_PIPELINE §4 gesture rules), all on the UI thread:
 * - pinch zooms around the fingers (or resizes the selected ring when it starts on it);
 * - one-finger pan only while zoomed, so at fit a horizontal swipe stays with the screen;
 * - double tap toggles 2.5x / fit; single tap selects a marker or drops a new ring;
 * - a press on a badge or ring edge drags/resizes that marker instead of panning;
 * - multi-finger touches cancel taps, so zooming never drops a pin by accident.
 */
export function usePhotoGestures(opts: PhotoGestureOptions): ComposedGesture {
  const { viewport, pane, image, editing = null, holdToPeek = null, priority = null } = opts;
  const pinchStart = useSharedValue<ViewState>(IDENTITY_VIEW);
  const pinchFocal = useSharedValue<Point>({ x: 0, y: 0 });
  const panStart = useSharedValue<ViewState>(IDENTITY_VIEW);
  const pinchResize = useSharedValue<PinchResize | null>(null);
  const dragState = useSharedValue<DragState | null>(null);
  const peekSaved = useSharedValue(1);
  const peeking = useSharedValue(false);

  const imageW = image.width;
  const imageH = image.height;

  return useMemo(() => {
    const img: Size = { width: imageW, height: imageH };
    const view = viewport.view;
    const metrics = SCREEN_MARKER_METRICS;

    const pinch = Gesture.Pinch()
      .onStart((e) => {
        pinchStart.set(view.get());
        pinchFocal.set({ x: e.focalX, y: e.focalY });
        pinchResize.set(null);
        if (!editing || !editing.canEdit.get()) return;
        const sel = editing.selectedId.get();
        if (sel === null) return;
        const items = editing.items.get();
        const rect = paneImageRect(view.get(), img, pane.get());
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].damageId !== sel) continue;
          const ring = itemRing(items[i], editing);
          const px = screenRing(ring, rect, metrics.minRingRadius);
          if (Math.hypot(e.focalX - px.cx, e.focalY - px.cy) <= px.r + metrics.hitSlop / 2) {
            pinchResize.set({ damageId: sel, role: items[i].role, start: ring });
          }
          break;
        }
      })
      .onUpdate((e) => {
        const pr = pinchResize.get();
        if (pr !== null && editing) {
          editing.live.set({ damageId: pr.damageId, role: pr.role, ring: scaleRing(pr.start, e.scale) });
          return;
        }
        view.set(pinchFrom(pinchStart.get(), e.scale, pinchFocal.get(), { x: e.focalX, y: e.focalY }, img, pane.get()));
      })
      .onEnd((_e, success) => {
        const pr = pinchResize.get();
        if (pr === null || !editing) return;
        const live = editing.live.get();
        if (success && live !== null && live.damageId === pr.damageId) {
          scheduleOnRN(editing.onChange, pr.damageId, live.ring, pr.role);
        } else {
          editing.live.set(null);
        }
      })
      .onFinalize(() => {
        pinchResize.set(null);
      });

    const pan = Gesture.Pan()
      .maxPointers(1)
      .onTouchesDown((e, manager) => {
        if (view.get().zoom <= ZOOMED_EPSILON) {
          manager.fail();
          return;
        }
        if (editing && editing.canEdit.get() && e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          if (hitAt({ x: t.x, y: t.y }, editing, view.get(), img, pane.get()) !== null) manager.fail();
        }
      })
      .onStart(() => {
        panStart.set(view.get());
      })
      .onUpdate((e) => {
        view.set(panBy(panStart.get(), e.translationX, e.translationY, img, pane.get()));
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(DOUBLE_TAP_DELAY)
      .maxDistance(TAP_SLOP * 2)
      .onEnd((e, success) => {
        if (!success) return;
        const current = clampViewState(view.get(), img, pane.get());
        view.set(animateView(toggleZoomAt(current, { x: e.x, y: e.y }, img, pane.get())));
      });

    let viewGestures: ComposedGesture = Gesture.Simultaneous(pinch, pan);
    let taps: GestureType | ComposedGesture = doubleTap;

    if (editing) {
      const singleTap = Gesture.Tap()
        .maxDistance(TAP_SLOP)
        .onEnd((e, success) => {
          if (!success) return;
          const p = { x: e.x, y: e.y };
          const hit = hitAt(p, editing, view.get(), img, pane.get());
          if (hit !== null) {
            scheduleOnRN(editing.onSelect, hit.item.damageId);
            return;
          }
          if (!editing.canDrop.get()) return;
          const rect = paneImageRect(view.get(), img, pane.get());
          const ring = dropRing(rectToNorm(p, rect));
          if (ring !== null) scheduleOnRN(editing.onDrop, ring);
        });

      const markerDrag = Gesture.Pan()
        .manualActivation(true)
        .maxPointers(1)
        .onTouchesDown((e, manager) => {
          if (!editing.canEdit.get() || e.numberOfTouches !== 1 || e.changedTouches.length === 0) {
            manager.fail();
            return;
          }
          const t = e.changedTouches[0];
          const hit = hitAt({ x: t.x, y: t.y }, editing, view.get(), img, pane.get());
          if (hit === null) {
            manager.fail();
            return;
          }
          const c = normToRect(hit.ring, hit.rect);
          dragState.set({
            damageId: hit.item.damageId,
            role: hit.item.role,
            resize: hit.resize,
            start: hit.ring,
            sx: t.x,
            sy: t.y,
            startDist: Math.hypot(t.x - c.x, t.y - c.y),
            rect: hit.rect,
            active: false,
          });
        })
        .onTouchesMove((e, manager) => {
          const d = dragState.get();
          if (d === null || e.allTouches.length === 0) {
            manager.fail();
            return;
          }
          const t = e.allTouches[0];
          if (Math.hypot(t.x - d.sx, t.y - d.sy) > DRAG_SLOP) manager.activate();
        })
        .onTouchesUp((_e, manager) => {
          const d = dragState.get();
          if (d === null || !d.active) manager.fail();
        })
        .onStart(() => {
          const d = dragState.get();
          if (d !== null) dragState.set({ ...d, active: true });
        })
        .onUpdate((e) => {
          const d = dragState.get();
          if (d === null) return;
          let ring: Ring;
          if (d.resize) {
            const c = normToRect(d.start, d.rect);
            ring = resizeRing(d.start, d.startDist, Math.hypot(e.x - c.x, e.y - c.y), d.rect);
          } else {
            ring = moveRing(d.start, e.x - d.sx, e.y - d.sy, d.rect);
          }
          editing.live.set({ damageId: d.damageId, role: d.role, ring });
          // Moving: magnify where the ring centre lands; resizing: where the finger is.
          const focus = d.resize ? { x: e.x, y: e.y } : normToRect(ring, d.rect);
          editing.drag.set({ x: e.x, y: e.y, focusX: focus.x, focusY: focus.y });
        })
        .onEnd((_e, success) => {
          const d = dragState.get();
          const live = editing.live.get();
          if (d === null) return;
          if (success && live !== null && live.damageId === d.damageId) {
            scheduleOnRN(editing.onChange, d.damageId, live.ring, d.role);
          } else {
            editing.live.set(null);
          }
        })
        .onFinalize(() => {
          dragState.set(null);
          editing.drag.set(null);
        });

      viewGestures = Gesture.Simultaneous(pinch, Gesture.Race(markerDrag, pan));
      taps = Gesture.Exclusive(doubleTap, singleTap);
    }

    const parts: (GestureType | ComposedGesture)[] = [viewGestures, taps];
    if (holdToPeek) {
      const hold = Gesture.LongPress()
        .minDuration(HOLD_MS)
        .maxDistance(TAP_SLOP)
        .onTouchesDown((e, manager) => {
          // A press on a marker is the start of a drag, not a blink.
          if (!editing || !editing.canEdit.get() || e.changedTouches.length === 0) return;
          const t = e.changedTouches[0];
          if (hitAt({ x: t.x, y: t.y }, editing, view.get(), img, pane.get()) !== null) manager.fail();
        })
        .onStart(() => {
          peeking.set(true);
          peekSaved.set(holdToPeek.get());
          holdToPeek.set(withTiming(0, { duration: duration.fast, reduceMotion: ReduceMotion.System }));
        })
        .onFinalize(() => {
          if (!peeking.get()) return;
          peeking.set(false);
          holdToPeek.set(withTiming(peekSaved.get(), { duration: duration.fast, reduceMotion: ReduceMotion.System }));
        });
      parts.push(hold);
    }
    const all = Gesture.Race(...parts);
    return priority ? Gesture.Race(priority, all) : all;
  }, [
    viewport,
    pane,
    imageW,
    imageH,
    editing,
    holdToPeek,
    priority,
    pinchStart,
    pinchFocal,
    panStart,
    pinchResize,
    dragState,
    peekSaved,
    peeking,
  ]);
}
