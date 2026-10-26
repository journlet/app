// Quick task entry, "add in place" (26 October 2026, quick capture option A).
// A tap on the "+ add a task" row under a section's own entries opens a line
// right there, cursor in it and the phone keyboard up, with Cancel / more /
// Log beneath. Presentational: App owns the line's state (which page it is open
// on, and its text) and what Log, Cancel and more do.
//
// Both halves are always mounted and only one is shown at a time. That is the
// whole trick of this component, see `reveal` below.

import { useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { isTap } from "./quickTap";
import type { TapSample } from "./quickTap";
import { S } from "./styles";

interface QuickLineProps {
  /** which section this is ("day", "week", …): names the tap area's test id */
  sectionKey: string;
  /** what the page reads as on screen ("Today", "Tue 27 Oct", …), for the
   *  button's and the text box's accessible names (NFR5) */
  pageLabel: string;
  open: boolean;
  text: string;
  /** what the filter is hiding ("nothing matching — 2 entries hidden by the
   *  filter"), when that is why the section shows nothing: said as plain text
   *  above the "add a task" row, which an empty page shows instead of
   *  "nothing logged" (27 October 2026) */
  emptyText?: string | null;
  /** another line is open with words in it, here or on another page, so a
   *  tap here opens nothing and that line stays as it is (FR5.2) */
  blocked?: boolean;
  /** told when a tap is refused because of `blocked`, so App can say why */
  onBlocked?: () => void;
  onOpen: () => void;
  onChangeText: (text: string) => void;
  onLog: () => void;
  onCancel: () => void;
  onMore: () => void;
}

export default function QuickLine({
  sectionKey,
  pageLabel,
  open,
  text,
  emptyText = null,
  blocked = false,
  onBlocked,
  onOpen,
  onChangeText,
  onLog,
  onCancel,
  onMore,
}: QuickLineProps) {
  const tapWrapRef = useRef<HTMLDivElement>(null);
  const tapRef = useRef<HTMLButtonElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where and when the current press began, or null between presses
  const press = useRef<TapSample | null>(null);
  // Set once pointerup has made the call on a press, so the click that
  // follows it does not open the line a second time (or open it after a
  // scroll the tap check turned down)
  const pointerDecided = useRef(false);
  // Set by Log and Cancel, which close the line from inside it: focus then
  // goes back to the tap area rather than falling to the page (NFR5)
  const returnFocus = useRef(false);

  /**
   * Open the line, synchronously, inside the event that asked for it (FR1.7).
   *
   * Phone browsers raise the keyboard only for a focus() made while handling
   * the person's own tap; a focus from a later render — React state set here,
   * the line drawn after — puts the cursor in the box with no keyboard, most
   * reliably so in an installed home-screen app. So the line is never created
   * on open: it is already in the page, hidden, and this unhides it by hand and
   * focuses it before returning. App's state then catches up and draws exactly
   * what is already showing, so React and the page never disagree.
   */
  const reveal = () => {
    if (blocked) {
      onBlocked?.();
      return;
    }
    if (tapWrapRef.current) tapWrapRef.current.hidden = true;
    if (lineRef.current) lineRef.current.hidden = false;
    inputRef.current?.focus();
    onOpen();
  };

  const close = (then: () => void) => {
    returnFocus.current = true;
    then();
  };
  // Log with nothing typed saves nothing and still closes the line (FR3.2),
  // which is a Cancel by another name. App checks again, so a blank task
  // cannot reach the journal whichever way it is asked.
  const log = () => close(text.trim() ? onLog : onCancel);

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    tapRef.current?.focus();
  }, [open]);

  // Keep the line and its buttons in view above the keyboard (NFR4). The
  // focus() in reveal scrolls the text box into view, but the keyboard
  // arrives after it and shrinks the visual viewport, which can leave the
  // button row (or, low on a long page, the line itself) underneath it.
  // jsdom has neither visualViewport nor scrollIntoView, hence the guards.
  useEffect(() => {
    if (!open) return;
    const keepInView = () =>
      lineRef.current?.scrollIntoView?.({ block: "nearest" });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", keepInView);
    return () => vv?.removeEventListener("resize", keepInView);
  }, [open]);

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>) => {
    // Enter that confirms an IME composition belongs to the composition
    if (ev.nativeEvent.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      log();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close(onCancel);
    }
  };

  // A press on the line anywhere but the text box (the bullet, the gaps, the
  // buttons) must not take focus out of it: that would drop the keyboard
  // mid-entry. This also catches the mouse events a phone sends after the
  // opening tap's pointerup, which land on the line now showing where the
  // tap area was. Clicks still go through; only the focus move is stopped.
  const keepFocus = (ev: MouseEvent<HTMLDivElement>) => {
    if (ev.target !== inputRef.current) ev.preventDefault();
  };

  return (
    <>
      <div ref={tapWrapRef} hidden={open}>
        {emptyText && <div style={S.sectionEmpty}>{emptyText}</div>}
        {/* Drawn as the journal's next line, "+" in the bullet column and the
            words where an entry's text goes, so it can be seen without being
            pointed at (27 October 2026: blank space alone was found by no one).
            The "+" is a child of the button and so takes the button font, as
            the entries' bullets do. */}
        <button
          ref={tapRef}
          type="button"
          className="quickTap"
          style={S.quickTap}
          data-testid={`quick-tap-${sectionKey}`}
          aria-label={`Add a task to ${pageLabel}`}
          onPointerDown={(ev) => {
            if (ev.pointerType === "mouse" && ev.button !== 0) return;
            pointerDecided.current = false;
            press.current = { x: ev.clientX, y: ev.clientY, t: Date.now() };
          }}
          onPointerUp={(ev) => {
            const start = press.current;
            press.current = null;
            if (!start) return;
            pointerDecided.current = true;
            // FR1.4: a drag or a long press never opens the line
            if (isTap(start, { x: ev.clientX, y: ev.clientY, t: Date.now() }))
              reveal();
          }}
          // The browser took the press over for a scroll
          onPointerCancel={() => {
            press.current = null;
          }}
          // Enter or Space: the click that follows has no pointer behind it
          onKeyDown={() => {
            pointerDecided.current = false;
          }}
          onClick={() => {
            if (pointerDecided.current) {
              pointerDecided.current = false;
              // Still inside the tap's activation, so a focus here can raise
              // the keyboard too: a second chance if anything between the
              // pointerup and this click moved focus off the text box
              if (lineRef.current && !lineRef.current.hidden)
                inputRef.current?.focus();
              return;
            }
            // Keyboard, or assistive technology activating the button
            // directly: a deliberate choice, with no travel to measure
            reveal();
          }}
        >
          <span className="bullet" style={S.quickHintMark} aria-hidden="true">
            +
          </span>
          <span style={S.quickHintText}>add a task</span>
        </button>
      </div>
      <div ref={lineRef} hidden={!open} onMouseDown={keepFocus}>
        <div style={S.quickLine}>
          {/* A button, like the entries' bullets, for no reason but its font:
              a span took the page font and drew a smaller "•" that sat off the
              column (27 October 2026). Out of the tab order and the
              accessibility tree; keepFocus stops a press on it moving focus. */}
          <button
            type="button"
            className="bullet"
            tabIndex={-1}
            aria-hidden="true"
          >
            •
          </button>
          <input
            ref={inputRef}
            type="text"
            style={S.quickInput}
            data-testid="quick-input"
            aria-label={`New task, ${pageLabel}`}
            enterKeyHint="done"
            autoComplete="off"
            value={text}
            onChange={(ev) => onChangeText(ev.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div style={S.quickRow}>
          <button
            type="button"
            className="miniBtn"
            style={S.quickCancel}
            data-testid="quick-cancel"
            onClick={() => close(onCancel)}
          >
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="miniBtn"
            style={S.quickMore}
            data-testid="quick-more"
            onClick={onMore}
          >
            more
          </button>
          <button
            type="button"
            className="addBtn"
            style={S.quickLog}
            data-testid="quick-log"
            onClick={log}
          >
            Log
          </button>
        </div>
      </div>
    </>
  );
}
