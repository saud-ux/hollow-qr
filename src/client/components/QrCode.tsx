import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: size * 2, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? (
    <img src={src} width={size} height={size} alt={label} className="qr-img" />
  ) : (
    <div className="qr-img qr-img--loading" style={{ width: size, height: size }} aria-busy="true" />
  );
}
