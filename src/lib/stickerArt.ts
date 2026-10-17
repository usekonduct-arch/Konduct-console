import QRCode from "qrcode";

/**
 * The vehicle payment sticker, drawn as one SVG so it prints sharp at any size.
 * Bus: yellow, 100 × 156 mm, goes by the sliding door. Bike: ink, 80 × 125 mm, goes on the rear
 * fender or the back of the rider's seat. Both use the same 1000-unit-wide drawing, so 10 units = 1 mm
 * on the bus and 8 units = 1 mm on the bike.
 *
 * The QR stays plain (no logo over it) so it scans from a step away in bad light.
 */
export type StickerKind = "bus" | "bike";

export type StickerArtInput = {
  kind: StickerKind;
  token: string;
  shortCode: string;
  plate: string;
  vehicleId: string;
  /** Where the official store badges live (a URL or a data: URI). */
  badges: { play: string; apple: string };
};

export const STICKER_SIZE_MM: Record<StickerKind, { w: number; h: number }> = {
  bus: { w: 100, h: 156 },
  bike: { w: 80, h: 124.8 },
};

const C = { ink: "#0e1115", ink2: "#161b22", ink3: "#222934", paper: "#f4f3ec", yellow: "#ffc700", yellow2: "#e3ab00", blue: "#1e56c8", mute: "#5d636b", white: "#ffffff" };
const DISPLAY = `'Bricolage Grotesque', 'Arial Black', sans-serif`;
const BODY = `Figtree, 'Segoe UI', Arial, sans-serif`;
const MONO = `'JetBrains Mono', Consolas, monospace`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The QR as one path of unit squares, scaled into a box of side `size` at (x, y). */
function qrPath(token: string, x: number, y: number, size: number, fill: string) {
  const qr = QRCode.create(token, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const m = size / n;
  let d = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) d += `M${(x + c * m).toFixed(2)} ${(y + r * m).toFixed(2)}h${m.toFixed(2)}v${m.toFixed(2)}h-${m.toFixed(2)}z`;
  // A hair of overlap so adjacent squares never show seams when printed.
  return `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="0.6" shape-rendering="crispEdges"/>`;
}

const mark = (x: number, y: number, s: number, bg: string, fg: string) =>
  `<g transform="translate(${x} ${y}) scale(${s / 64})"><rect width="64" height="64" rx="16" fill="${bg}"/><path d="M17 13h10v17l15-17h12L37 32l18 21H42L27 35v18H17z" fill="${fg}"/></g>`;

/** A side-on Korope, about 120 × 64. */
const busIcon = (x: number, y: number, s: number, body: string, glass: string) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <path d="M8 8h86c8 0 13 4 17 12l7 16v16c0 3-2 5-5 5H8c-3 0-5-2-5-5V13c0-3 2-5 5-5z" fill="${body}"/>
    <rect x="12" y="15" width="18" height="15" rx="3" fill="${glass}"/><rect x="35" y="15" width="18" height="15" rx="3" fill="${glass}"/><rect x="58" y="15" width="18" height="15" rx="3" fill="${glass}"/>
    <path d="M82 15h14c3 0 5 2 6 4l6 11H82z" fill="${glass}"/>
    <circle cx="28" cy="57" r="9" fill="${body}" stroke="${glass}" stroke-width="5"/><circle cx="92" cy="57" r="9" fill="${body}" stroke="${glass}" stroke-width="5"/>
  </g>`;

/** An okada, about 120 × 70. */
const bikeIcon = (x: number, y: number, s: number, col: string) => `
  <g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="22" cy="50" r="16"/><circle cx="98" cy="50" r="16"/>
    <path d="M22 50l22-26h30l24 26M44 24l8-12h-14M74 24l10-16h12"/>
    <path d="M42 30h38" stroke-width="12"/>
  </g>`;

/** Three tiny steps (open the app, scan, ride) in one centred run with chevrons between. */
function steps(cx: number, y: number, fg: string, accent: string, onAccent: string) {
  const items = ["Open Konduct", "Tap Scan", "Ride"];
  const widths = items.map((t) => 48 + 12 + t.length * 15); // dot, gap, Figtree 800 at 27 is about 15 units a character
  const gap = 64; // room for the chevron
  let left = cx - (widths.reduce((a, b) => a + b) + gap * (items.length - 1)) / 2;
  return items
    .map((t, i) => {
      const at = left;
      left += widths[i] + gap;
      const ax = at + widths[i] + gap / 2;
      const chevron = i < items.length - 1 ? `<path d="M${ax - 5} ${y - 9}l9 9l-9 9" fill="none" stroke="${fg}" stroke-opacity="0.45" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : "";
      return `<circle cx="${at + 24}" cy="${y}" r="24" fill="${accent}"/><text x="${at + 24}" y="${y + 10}" text-anchor="middle" font-family="${DISPLAY}" font-weight="800" font-size="29" fill="${onAccent}">${i + 1}</text>
        <text x="${at + 60}" y="${y + 10}" font-family="${BODY}" font-weight="800" font-size="27" fill="${fg}">${t}</text>${chevron}`;
    })
    .join("");
}

export function stickerSvg({ kind, token, shortCode, plate, vehicleId, badges }: StickerArtInput) {
  const bus = kind === "bus";
  const W = 1000;
  const H = 1560;
  const F = 1380; // footer top
  const R = 1236; // code + plate row
  const bg = bus ? C.yellow : C.ink;
  const fg = bus ? C.ink : C.paper;
  const accent = bus ? C.ink : C.yellow;
  const onAccent = bus ? C.yellow : C.ink;
  const qrCard = { x: 180, y: 462, s: 640 };
  const qrPad = 46;

  // Corner brackets around the QR card: the "point here" frame.
  const b = 26;
  const L = 96;
  const { x: qx, y: qy, s: qs } = qrCard;
  const brackets = [
    [qx - b, qy - b, 1, 1],
    [qx + qs + b, qy - b, -1, 1],
    [qx - b, qy + qs + b, 1, -1],
    [qx + qs + b, qy + qs + b, -1, -1],
  ]
    .map(([x, y, sx, sy]) => `<path d="M${x} ${y + sy * L}V${y + sy * 18}q0 ${-sy * 18} ${sx * 18} ${-sy * 18}H${x + sx * L}" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round"/>`)
    .join("");

  // Diagonal stripes in the header, after the yellow band on the Korope livery.
  const stripes = Array.from({ length: 14 }, (_, i) => `<path d="M${520 + i * 46} 0l-120 230h22l120-230z" fill="${C.yellow}" opacity="${bus ? 0.1 : 0.12}"/>`).join("");

  const codeSpaced = esc(shortCode.toUpperCase());
  const plateText = esc((plate || "—").toUpperCase());
  const headline = bus ? "Pay your fare here" : "Pay your okada here";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${STICKER_SIZE_MM[kind].w}mm" height="${STICKER_SIZE_MM[kind].h}mm" role="img" aria-label="Konduct payment sticker for ${plateText}">
  <defs>
    <clipPath id="k-card"><rect width="${W}" height="${H}" rx="64"/></clipPath>
    <pattern id="k-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="2.6" fill="${fg}" opacity="${bus ? 0.09 : 0.08}"/></pattern>
  </defs>
  <g clip-path="url(#k-card)">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    <rect y="230" width="${W}" height="${F - 230}" fill="url(#k-dots)"/>

    <!-- header -->
    <rect width="${W}" height="230" fill="${bus ? C.ink : C.ink3}"/>
    ${stripes}
    ${mark(64, 62, 106, C.yellow, C.ink)}
    <text x="192" y="146" font-family="${DISPLAY}" font-weight="800" font-size="92" letter-spacing="-3.5" fill="${C.paper}">konduct</text>
    <rect x="${W - 64 - 236}" y="69" width="236" height="92" rx="46" fill="${C.yellow}"/>
    ${bus ? busIcon(W - 64 - 210, 86, 0.5, C.ink, C.yellow) : bikeIcon(W - 64 - 210, 93, 0.5, C.ink)}
    <text x="${W - 64 - 34}" y="128" text-anchor="end" font-family="${MONO}" font-weight="700" font-size="30" letter-spacing="3" fill="${C.ink}">${bus ? "BUS" : "BIKE"}</text>
    <rect y="230" width="${W}" height="12" fill="${bus ? C.blue : C.yellow}"/>

    <!-- headline -->
    <text x="${W / 2}" y="346" text-anchor="middle" font-family="${DISPLAY}" font-weight="800" font-size="84" letter-spacing="-3" fill="${fg}">${headline}</text>
    <text x="${W / 2}" y="404" text-anchor="middle" font-family="${BODY}" font-weight="700" font-size="34" fill="${fg}" opacity="0.78">Scan in the Konduct app · No change, no wahala</text>

    <!-- QR -->
    ${brackets}
    <rect x="${qx}" y="${qy}" width="${qs}" height="${qs}" rx="40" fill="${C.white}"/>
    ${bus ? "" : `<rect x="${qx + 7}" y="${qy + 7}" width="${qs - 14}" height="${qs - 14}" rx="34" fill="none" stroke="${C.yellow}" stroke-width="8"/>`}
    ${qrPath(token, qx + qrPad, qy + qrPad, qs - qrPad * 2, C.ink)}

    <!-- steps -->
    ${steps(W / 2, 1178, fg, accent, onAccent)}

    <!-- code + plate -->
    <rect x="70" y="${R}" width="520" height="110" rx="26" fill="${accent}"/>
    <text x="104" y="${R + 44}" font-family="${MONO}" font-weight="700" font-size="22" letter-spacing="2.5" fill="${onAccent}" opacity="0.75">NO CAMERA? TYPE</text>
    <text x="104" y="${R + 90}" font-family="${MONO}" font-weight="700" font-size="46" letter-spacing="9" fill="${onAccent}">${codeSpaced}</text>
    <rect x="610" y="${R}" width="320" height="110" rx="26" fill="${C.white}" stroke="${C.ink}" stroke-width="5"/>
    <text x="770" y="${R + 38}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="20" letter-spacing="2.5" fill="${C.mute}">CHECK THE PLATE</text>
    <text x="770" y="${R + 88}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="${plateText.length > 9 ? 36 : 42}" letter-spacing="3" fill="${C.ink}">${plateText}</text>

    <!-- footer: get the app -->
    <rect y="${F}" width="${W}" height="${H - F}" fill="${C.ink}"/>
    <text x="70" y="${F + 66}" font-family="${DISPLAY}" font-weight="800" font-size="40" letter-spacing="-1" fill="${C.paper}">Get the app</text>
    <text x="70" y="${F + 106}" font-family="${MONO}" font-weight="700" font-size="24" letter-spacing="1.5" fill="${C.yellow}">konduct.com.ng</text>
    <text x="70" y="${F + 152}" font-family="${MONO}" font-weight="500" font-size="17" letter-spacing="1" fill="${C.paper}" opacity="0.45">${esc(vehicleId)}</text>
    <image href="${badges.play}" xlink:href="${badges.play}" x="430" y="${F + 34}" width="243" height="72"/>
    <image href="${badges.apple}" xlink:href="${badges.apple}" x="${430 + 243 + 18}" y="${F + 34}" width="243" height="72"/>
    <text x="${W - 70}" y="${F + 152}" text-anchor="end" font-family="${BODY}" font-weight="800" font-size="24" fill="${C.paper}" opacity="0.8">Tap. Pay. Ride.</text>
  </g>
</svg>`;
}
