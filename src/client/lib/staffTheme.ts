/**
 * Light / dark for the staff and admin pages (website). Follows the device
 * until someone taps the switch; the choice is kept on this device.
 */
type Resolved = "light" | "dark";

const KEY = "hollow.staffTheme";
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function stored(): Resolved | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function staffTheme(): Resolved {
  return stored() ?? (media?.matches ? "dark" : "light");
}

function paint(theme: Resolved) {
  const root = document.documentElement;
  root.classList.add("staff-ui");
  root.dataset.theme = theme;
}

/** Called while a staff page is showing; returns the cleanup for when it leaves. */
export function enterStaffTheme(onChange: (theme: Resolved) => void): () => void {
  paint(staffTheme());
  const follow = () => {
    if (stored()) return;
    paint(staffTheme());
    onChange(staffTheme());
  };
  media?.addEventListener("change", follow);
  return () => {
    media?.removeEventListener("change", follow);
    document.documentElement.classList.remove("staff-ui");
    delete document.documentElement.dataset.theme;
  };
}

export function toggleStaffTheme(): Resolved {
  const next: Resolved = staffTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // storage blocked: lasts for this visit
  }
  paint(next);
  return next;
}
