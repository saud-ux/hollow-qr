/** Business constants shared by the Worker and the web app. */

export const SHOP_NAME = "HOLLOW";
export const SHOP_LABEL = "HOLLOW Al Zulfi";
export const PROGRAM_NAME = "HOLLOW Rewards";

/** Paid cups needed for one free drink. Mirrors the CHECK constraints in SQL. */
export const MAX_STAMPS = 5;

/** Business-facing dates are shown in Riyadh time; storage is always UTC. */
export const BUSINESS_TIME_ZONE = "Asia/Riyadh";

/** Default accidental-duplicate window (seconds). */
export const DEFAULT_DUPLICATE_WINDOW_SECONDS = 60;

/** Alphabet used by member IDs (no 0/1/O/I). Must match generate_member_id(). */
export const MEMBER_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const MEMBER_ID_PATTERN = /^HLW-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/** QR token: "<22 char random id>.<22 char HMAC>" (base64url). */
export const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/;

export const QR_CAPTION = "SCAN AT CHECKOUT";

export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 80;
