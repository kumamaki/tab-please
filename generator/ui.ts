// ui.ts — shared TTY progress + color helpers for generator CLIs.
//
// Progress and colors both go to stderr. stdout stays for machine-readable
// payloads (JSON models, worth-adding names, issue URLs). Gated so pipes/CI
// never see spinner frames or ANSI.

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export const symbols = {
  ok: "✓",
  fail: "✗",
  native: "◆",
  low: "·",
  arrow: "→",
  warn: "⚠",
  sep: "·",
} as const;

export function isTty(): boolean {
  return !!process.stderr.isTTY && !process.env.TAB_PLEASE_NO_PROGRESS;
}

export function isColor(): boolean {
  return !!process.stderr.isTTY && !process.env.NO_COLOR;
}

type Paint = (s: string) => string;

function paint(open: string): Paint {
  return (s) => (isColor() ? `${open}${s}\x1b[0m` : s);
}

export const bold: Paint = paint("\x1b[1m");
export const dim: Paint = paint("\x1b[2m");
export const red: Paint = paint("\x1b[31m");
export const green: Paint = paint("\x1b[32m");
export const yellow: Paint = paint("\x1b[33m");
export const blue: Paint = paint("\x1b[34m");
export const cyan: Paint = paint("\x1b[36m");
export const bright: Paint = paint("\x1b[97m");

export type Spinner = {
  /** Replace the in-flight label (e.g. current command name). */
  set(label: string): void;
  /** Advance one frame; optional done/total for a counter. */
  tick(done?: number, total?: number): void;
  /** Clear, print a warning line, resume the spinner. */
  warn(msg: string): void;
  /** Clear the spinner line. Optional summary line printed after. */
  done(summary?: string): void;
};

/**
 * Single self-erasing status line on stderr.
 *   ⠋ classifying · agent-browser  (3/35)
 *
 * On a TTY the glyph auto-animates every 80ms so long silent work still looks
 * alive; `tick`/`set` only update the counters/label.
 */
export function makeSpinner(opts: { verb: string; subject?: string }): Spinner {
  const tty = isTty();
  let frame = 0;
  let label = "";
  let done = 0;
  let total: number | undefined;
  let finished = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const clear = () => {
    if (tty) process.stderr.write("\r\x1b[K");
  };

  const render = () => {
    if (!tty || finished) return;
    const subject = opts.subject ? ` ${opts.subject}` : "";
    const where = label ? ` ${dim(symbols.sep)} ${label}` : "";
    const count =
      total != null
        ? `  ${dim(`(${done}/${total})`)}`
        : done > 0
          ? `  ${dim(`(${done})`)}`
          : "";
    process.stderr.write(
      `\r${dim(SPINNER[frame % SPINNER.length])} ${opts.verb}${subject}${where}${count}\x1b[K`,
    );
  };

  const ensureAnimating = () => {
    if (!tty || finished || timer) return;
    timer = setInterval(() => {
      frame++;
      render();
    }, 80);
    // Don't keep the process alive solely for the spinner.
    timer.unref?.();
  };

  const stopAnimating = () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  ensureAnimating();
  render();

  return {
    set(next) {
      label = next;
      ensureAnimating();
      render();
    },
    tick(nextDone, nextTotal) {
      if (nextDone != null) done = nextDone;
      else done++;
      if (nextTotal != null) total = nextTotal;
      frame++;
      ensureAnimating();
      render();
    },
    warn(msg) {
      clear();
      process.stderr.write(`${msg}\n`);
      render();
    },
    done(summary) {
      finished = true;
      stopAnimating();
      clear();
      if (summary) process.stderr.write(`${summary}\n`);
    },
  };
}

/** Format a duration in ms for human display: `4.2s`, `312ms`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
