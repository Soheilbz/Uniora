/**
 * Whether a click is a navigation that would lose unsaved work.
 *
 * Pure and separate from the form, because it is the part with a decision in
 * it and every one of its rules is a case somebody would otherwise find the
 * hard way — a guard that fires on a middle click is worse than no guard,
 * since it breaks the one gesture that was *already* safe.
 *
 * Returns the destination to confirm, or `null` to let the click through.
 */

/** What the rule needs from a link. A DOM `<a>` satisfies it; so does a test. */
export interface ClickedLink {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  target: string;
}

/** What the rule needs from the click itself. */
export interface Click {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function interceptedHref(click: Click, link: ClickedLink | null | undefined): string | null {
  /*
   * Only a plain left click.
   *
   * A middle click, a ctrl-click or a shift-click opens the destination in a
   * second tab or window and leaves this one — with its work — exactly where
   * it was. Nothing is at stake, so asking would be a prompt in front of a safe
   * gesture. Alt-click is a download in most browsers, and the same argument
   * holds.
   */
  if (click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;

  if (!link) return null;
  const href = link.getAttribute("href");
  if (!href) return null;

  /* An anchor on this page is not a navigation away from it. */
  if (href.startsWith("#")) return null;

  /* A new tab leaves this one open, and a download does not navigate at all. */
  if (link.target === "_blank") return null;
  if (link.hasAttribute("download")) return null;

  return href;
}
