import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Modal, Button } from "@/components/ui";

interface AvatarCropDialogProps {
  open: boolean;
  /** Source data URL of the just-picked image. */
  src: string;
  onCancel: () => void;
  /** Resolves to a 512px-square jpeg data URL — what we ship to the server. */
  onConfirm: (croppedDataUrl: string) => Promise<void> | void;
}

const OUTPUT_SIZE = 512;

/**
 * AvatarCropDialog — square crop with a circular preview mask.
 * Drag to reposition, scroll/pinch to zoom. Output is a 512×512 jpeg
 * data URL written through a canvas — small enough for our 2 MB cap,
 * sharp enough at any rendered size.
 */
export default function AvatarCropDialog({
  open,
  src,
  onCancel,
  onConfirm,
}: AvatarCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!pixels) return;
    setBusy(true);
    try {
      const dataUrl = await renderCrop(src, pixels);
      await onConfirm(dataUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="Crop your photo" className="avatar-crop-modal">
      <div className="avatar-crop-stage">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          objectFit="contain"
        />
      </div>
      <label className="avatar-crop-zoom">
        <span className="avatar-crop-zoom-label">Zoom</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          aria-label="Zoom"
        />
      </label>
      <div className="avatar-crop-actions">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleConfirm}
          loading={busy}
          disabled={busy || !pixels}
        >
          Save photo
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Render the selected crop area through a canvas at OUTPUT_SIZE square.
 * Returns a jpeg data URL (smaller than png for photos, fine for an
 * avatar). The Image element is loaded fresh — react-easy-crop has
 * already validated decoding.
 */
async function renderCrop(src: string, area: Area): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't decode the image."));
    img.src = src;
  });
}
