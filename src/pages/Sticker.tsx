import { useMemo, useState } from "react";

import { STICKER_SIZE_MM, stickerSvg, type StickerKind } from "../lib/stickerArt";
import { Button, Dialog, Notice, Select } from "../ui";

export type StickerData = { token: string; shortCode: string; plate: string; type?: "shuttle" | "bike" };

const BADGES = { play: "/badges/google-play.svg", apple: "/badges/app-store.svg" };

/**
 * The vehicle's payment sticker: a signed QR (K1.<vehicle>.<version>.<sig>), the 6-character code
 * for typing by hand, the plate so riders can check they're paying the right vehicle, and the store
 * badges. Yellow for buses, ink for bikes (see lib/stickerArt.ts). Printing a new one revokes every
 * older sticker for this vehicle.
 */
export function StickerDialog({ sticker, vehicleId, onClose }: { sticker: StickerData; vehicleId: string; onClose: () => void }) {
  const [kind, setKind] = useState<StickerKind>(sticker.type === "bike" ? "bike" : "bus");
  const svg = useMemo(
    () => stickerSvg({ kind, token: sticker.token, shortCode: sticker.shortCode, plate: sticker.plate, vehicleId, badges: BADGES }),
    [kind, sticker, vehicleId],
  );
  const size = STICKER_SIZE_MM[kind];

  return (
    <Dialog title={`Sticker for ${sticker.plate}`} onClose={onClose} wide>
      <Notice tone="warn">This sticker replaces any older one for this vehicle. Old stickers stop working now, so put this one up before the next ride.</Notice>
      <Select
        label="Sticker for"
        value={kind}
        onChange={setKind}
        options={[
          { value: "bus", label: "Bus (yellow, 100 × 156 mm)" },
          { value: "bike", label: "Bike (dark, 80 × 125 mm)" },
        ]}
      />
      <div className="sticker-wrap">
        <div className={`sticker sticker-${kind}`} id="print-sticker" style={{ ["--sticker-w" as string]: `${size.w}mm` }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <p className="small">
        Print at 100% scale on vinyl. {kind === "bus" ? "Stick it by the sliding door, at hand height." : "Stick it on the rear fender or the back of the seat."} Riders check the plate before they pay.
      </p>
      <div className="row">
        <Button onClick={() => window.print()}>Print sticker</Button>
        <Button kind="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
