import { SOCIAL_LINKS } from "../../shared/constants";
import { tr } from "../lib/i18n";

/** Line icons drawn in the app's own stroke style, so they follow the theme. */
const ICONS = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
    </>
  ),
  tiktok: <path d="M14 3.5v11a3.75 3.75 0 1 1-3.75-3.75M14 3.5c.4 2.6 2.4 4.6 5 4.9" />,
  snapchat: (
    <path d="M12 3.5c-2.9 0-4.8 2.1-4.8 5v2.2l-1.5.6c-.5.2-.4.8.1 1l1.2.4c-.6 1.6-1.8 2.8-3.4 3.3.3.7 1.3 1 2.4 1.1.2.6.3 1.1 1 1.1.8 0 1.5-.3 2.6-.1 1 .3 1.5 1.2 2.4 1.2s1.4-.9 2.4-1.2c1.1-.2 1.8.1 2.6.1.7 0 .8-.5 1-1.1 1.1-.1 2.1-.4 2.4-1.1-1.6-.5-2.8-1.7-3.4-3.3l1.2-.4c.5-.2.6-.8.1-1l-1.5-.6V8.5c0-2.9-1.9-5-4.8-5Z" />
  ),
} as const;

const LABELS = {
  instagram: "Instagram",
  tiktok: "TikTok",
  snapchat: "Snapchat",
} as const;

export function SocialLinks() {
  return (
    <nav className="social" aria-label={tr("حساباتنا", "Follow us")}>
      {(Object.keys(SOCIAL_LINKS) as (keyof typeof SOCIAL_LINKS)[]).map((key) => (
        <a key={key} href={SOCIAL_LINKS[key]} target="_blank" rel="noopener noreferrer" className="social__link" aria-label={LABELS[key]}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[key]}
          </svg>
        </a>
      ))}
    </nav>
  );
}
