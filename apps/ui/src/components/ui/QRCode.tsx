import { useEffect, useState } from "react";
import QRCodeLib from "qrcode";

interface Props {
  /** The data to encode (e.g. an `otpauth://` URI). */
  value: string;
  /** Pixel size of the rendered SVG. Defaults to 200. */
  size?: number;
  /** Quiet-zone margin in modules. Defaults to 1 (tight). */
  margin?: number;
  /** Error-correction level. Defaults to "M" (15%). */
  level?: "L" | "M" | "Q" | "H";
}

/**
 * Renders a QR code locally as inline SVG via the `qrcode` library.
 *
 * Crucially, the encoded value never leaves the browser — earlier
 * versions of the TOTP setup flow rendered the `otpauth://` URI by
 * calling api.qrserver.com, which leaked the shared secret to a
 * third-party. This component closes that hole.
 */
export function QRCode({ value, size = 200, margin = 1, level = "M" }: Props) {
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    QRCodeLib.toString(value, {
      type: "svg",
      margin,
      errorCorrectionLevel: level,
      color: {
        dark: "#0a0a0b",
        light: "#fcfcfd",
      },
    })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, margin, level]);

  return (
    <div
      role="img"
      aria-label="QR code"
      style={{ width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

QRCode.displayName = "QRCode";
