import QrScanner from "qr-scanner";
import { useEffect, useRef, useState } from "react";

/**
 * Camera QR scanner tuned for iPhone / iPad Safari.
 *  - qr-scanner (nimiq) uses the native BarcodeDetector where available and a
 *    WebWorker decoder elsewhere (iOS Safari), both proven on iOS.
 *  - Rear camera by default; `playsinline` is set by the library for iOS.
 *  - Camera access requires HTTPS (or localhost).
 */
export function QrScannerView({ onResult, onClose, paused }: { onResult: (text: string) => void; onClose: () => void; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(
      video,
      (result) => {
        setFlash(true);
        setTimeout(() => setFlash(false), 600);
        onResultRef.current(result.data);
      },
      {
        preferredCamera: "environment",
        highlightScanRegion: true,
        highlightCodeOutline: true,
        maxScansPerSecond: 8,
        returnDetailedScanResult: true,
      },
    );
    scannerRef.current = scanner;
    scanner.start().catch((err: unknown) => {
      const name = err instanceof Error ? err.name : String(err);
      setError(
        /NotAllowed|Permission/i.test(name)
          ? "تم رفض إذن الكاميرا. اسمح باستخدام الكاميرا من إعدادات Safari ثم أعد المحاولة."
          : "تعذّر تشغيل الكاميرا. تأكد من فتح الموقع عبر HTTPS أو استخدم الإدخال اليدوي.",
      );
    });
    return () => {
      scanner.destroy();
      scannerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    if (paused) void scanner.pause();
    else void scanner.start().catch(() => undefined);
  }, [paused]);

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="مسح رمز QR">
      <div className={`scanner__viewport ${flash ? "scanner__viewport--ok" : ""}`}>
        <video ref={videoRef} className="scanner__video" muted playsInline />
        {flash && <div className="scanner__ok" aria-live="assertive">✓ تم المسح</div>}
      </div>
      {error && (
        <p className="scanner__error" role="alert">
          {error}
        </p>
      )}
      <p className="scanner__hint">وجّه الكاميرا إلى رمز QR في بطاقة HOLLOW</p>
      <button type="button" className="btn btn--light btn--lg" onClick={onClose}>
        إغلاق
      </button>
    </div>
  );
}
