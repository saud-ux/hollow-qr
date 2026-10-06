import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "../../shared/ordering";
import { tapFeedback } from "./native";

/** One cart line: an item, plus its option (e.g. the coffee origin) when it has one. */
export interface CartLine {
  menuItemId: string;
  optionId: string | null;
  quantity: number;
  note: string;
}

interface CartState {
  lines: CartLine[];
  count: number;
  /** Quantity of one exact line (item + option). */
  quantityOf: (menuItemId: string, optionId?: string | null) => number;
  /** Quantity of an item across all its options. */
  totalOf: (menuItemId: string) => number;
  add: (menuItemId: string, optionId?: string | null, quantity?: number) => void;
  setQuantity: (menuItemId: string, quantity: number, optionId?: string | null) => void;
  setNote: (menuItemId: string, note: string, optionId?: string | null) => void;
  /** Moves a line to another option, merging with an existing line for it. */
  setOption: (menuItemId: string, from: string | null, to: string) => void;
  remove: (menuItemId: string, optionId?: string | null) => void;
  clear: () => void;
}

const STORAGE_KEY = "hollow.cart.v1";
const CartContext = createContext<CartState | null>(null);

const same = (l: CartLine, menuItemId: string, optionId: string | null) => l.menuItemId === menuItemId && l.optionId === optionId;

function load(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l): l is CartLine => typeof l === "object" && l !== null && typeof (l as CartLine).menuItemId === "string")
      .map((l) => ({
        menuItemId: l.menuItemId,
        optionId: typeof l.optionId === "string" ? l.optionId : null,
        quantity: Math.min(Math.max(Math.trunc(Number(l.quantity)) || 1, 1), MAX_LINE_QUANTITY),
        note: typeof l.note === "string" ? l.note.slice(0, 120) : "",
      }))
      .slice(0, MAX_ORDER_LINES);
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Private mode / storage blocked: the cart still works for this visit.
    }
  }, [lines]);

  const setQuantity = useCallback((menuItemId: string, quantity: number, optionId: string | null = null) => {
    setLines((prev) => {
      const q = Math.min(Math.max(Math.trunc(quantity), 0), MAX_LINE_QUANTITY);
      if (q === 0) return prev.filter((l) => !same(l, menuItemId, optionId));
      if (prev.some((l) => same(l, menuItemId, optionId))) {
        return prev.map((l) => (same(l, menuItemId, optionId) ? { ...l, quantity: q } : l));
      }
      if (prev.length >= MAX_ORDER_LINES) return prev;
      return [...prev, { menuItemId, optionId, quantity: q, note: "" }];
    });
  }, []);

  const value = useMemo<CartState>(() => {
    const quantityOf = (id: string, optionId: string | null = null) => lines.find((l) => same(l, id, optionId))?.quantity ?? 0;
    return {
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      quantityOf,
      totalOf: (id) => lines.filter((l) => l.menuItemId === id).reduce((n, l) => n + l.quantity, 0),
      add: (id, optionId = null, quantity = 1) => {
        tapFeedback();
        setQuantity(id, quantityOf(id, optionId) + quantity, optionId);
      },
      setQuantity,
      setNote: (id, note, optionId = null) =>
        setLines((prev) => prev.map((l) => (same(l, id, optionId) ? { ...l, note: note.slice(0, 120) } : l))),
      setOption: (id, from, to) =>
        setLines((prev) => {
          const moving = prev.find((l) => same(l, id, from));
          if (!moving || from === to) return prev;
          const target = prev.find((l) => same(l, id, to));
          if (!target) return prev.map((l) => (l === moving ? { ...l, optionId: to } : l));
          return prev
            .filter((l) => l !== moving)
            .map((l) => (l === target ? { ...l, quantity: Math.min(l.quantity + moving.quantity, MAX_LINE_QUANTITY) } : l));
        }),
      remove: (id, optionId = null) => setLines((prev) => prev.filter((l) => !same(l, id, optionId))),
      clear: () => setLines([]),
    };
  }, [lines, setQuantity]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("CartProvider missing");
  return ctx;
}
