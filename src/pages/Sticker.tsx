import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { Button, Dialog, Mark, Notice } from "../ui";

export type StickerData = { token: string; shortCode: string; plate: string };

/**
 * The vehicle's payment sticker: a signed QR (K1.<vehicle>.<version>.<sig>), the 6-character code
 * for typing by hand, and the plate so riders can check they're paying the right vehicle.
 * Printing a new one revokes every older sticker for this vehicle.
 */
export function StickerDialog({ sticker, vehicleId, onClose }: { sticker: StickerData; vehicleId: string; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(sticker.token, { errorCorrectionLevel: "M", margin: 0, width: 640, color: { dark: "#0e1115", light: "#ffffff" } }).then(setQr);
  }, [sticker.token]);

  return (
    <Dialog title={`Sticker for ${sticker.plate}`} onClose={onClose} wide>
      <Notice tone="warn">This sticker replaces any older one for this vehicle. Old stickers stop working now, so put this one up before the next ride.</Notice>
      <div className="sticker-wrap">
        <div className="sticker" id="print-sticker">
          <div className="sticker-top">
            <Mark size={44} />
            <div>
              <b>Pay with Konduct</b>
              <span>Scan in the Konduct app</span>
            </div>
          </div>
          {qr ? <img src={qr} alt={`Payment QR code for ${sticker.plate}`} className="sticker-qr" /> : <div className="sticker-qr" />}
          <div className="sticker-code">
            <span>No camera? Type</span>
            <b className="mono">{sticker.shortCode}</b>
          </div>
          <div className="sticker-plate mono">{sticker.plate}</div>
          <p className="sticker-note">Check this plate matches the vehicle before you pay.</p>
          <p className="sticker-id mono">{vehicleId}</p>
        </div>
      </div>
      <div className="row">
        <Button onClick={() => window.print()}>Print sticker</Button>
        <Button kind="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
