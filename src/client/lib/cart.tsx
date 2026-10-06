import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "../../shared/ordering";

export interface CartLine {
  menuItemId: string;
  quantity: number;
  note: string;
}

interface CartState {
  lines: CartLine[];
  count: number;
  quantityOf: (menuItemId: string) => number;
  add: (menuItemId: string) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  setNote: (menuItemId: string, note: string) => void;
  remove: (menuItemId: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "hollow.cart.v1";
const CartContext = createContext<CartState | null>(null);

function load(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l): l is CartLine => typeof l === "object" && l !== null && typeof (l as CartLine).menuItemId === "string")
      .map((l) => ({
        menuItemId: l.menuItemId,
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

  const setQuantity = useCallback((menuItemId: string, quantity: number) => {
    setLines((prev) => {
      const q = Math.min(Math.max(Math.trunc(quantity), 0), MAX_LINE_QUANTITY);
      if (q === 0) return prev.filter((l) => l.menuItemId !== menuItemId);
      if (prev.some((l) => l.menuItemId === menuItemId)) {
        return prev.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: q } : l));
      }
      if (prev.length >= MAX_ORDER_LINES) return prev;
      return [...prev, { menuItemId, quantity: q, note: "" }];
    });
  }, []);

  const value = useMemo<CartState>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      quantityOf: (id) => lines.find((l) => l.menuItemId === id)?.quantity ?? 0,
      add: (id) => setQuantity(id, (lines.find((l) => l.menuItemId === id)?.quantity ?? 0) + 1),
      setQuantity,
      setNote: (id, note) => setLines((prev) => prev.map((l) => (l.menuItemId === id ? { ...l, note: note.slice(0, 120) } : l))),
      remove: (id) => setLines((prev) => prev.filter((l) => l.menuItemId !== id)),
      clear: () => setLines([]),
    }),
    [lines, setQuantity],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("CartProvider missing");
  return cart;
}
