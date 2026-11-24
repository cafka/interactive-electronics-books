/** ESP32 book cover, drawn upright (the 3D cover and the library thumbnail both use it). */
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const GOLD = '#d8b25a';

export function paintEsp32Cover(ctx, W = 1100, H = 1400) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#17332f');
  bg.addColorStop(1, '#08181a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  ctx.strokeRect(60, 60, W - 120, H - 120);
  ctx.lineWidth = 2;
  ctx.strokeRect(80, 80, W - 160, H - 160);

  ctx.textAlign = 'center';
  ctx.fillStyle = GOLD;
  ctx.font = `600 28px ${SANS}`;
  ctx.letterSpacing = '8px';
  ctx.fillText('AN INTERACTIVE SCIENCE BOOK', W / 2, 190);

  ctx.letterSpacing = '2px';
  ctx.font = `bold 150px ${SERIF}`;
  ctx.fillStyle = '#f6e7b8';
  ctx.fillText('ESP32', W / 2, 365);
  ctx.letterSpacing = '0px';
  ctx.font = `italic 40px ${SERIF}`;
  ctx.fillStyle = '#cfd8ee';
  ctx.fillText('Electronics you can touch', W / 2, 450);

  // illustration: a DevKit seen from above (antenna up, USB at the bottom), a glowing LED and a magnet-and-reed sensor
  const bx = W / 2 - 150, by = 520, bw = 300, bh = 520;
  ctx.fillStyle = '#10161a';
  ctx.strokeStyle = '#3a4a50';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 16);
  ctx.fill();
  ctx.stroke();
  // WROOM module with the antenna meander on top
  ctx.fillStyle = '#b9bdc4';
  ctx.fillRect(bx + 40, by + 120, bw - 80, 200);
  ctx.fillStyle = '#d9dce2';
  ctx.fillRect(bx + 48, by + 128, bw - 96, 184);
  ctx.fillStyle = '#3b4048';
  ctx.font = `600 24px ${SANS}`;
  ctx.fillText('ESP32-WROOM-32E', W / 2, by + 230);
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(bx + 55, by + 112);
  let up = true;
  for (let x = bx + 55; x < bx + bw - 55; x += 24) {
    ctx.lineTo(x, up ? by + 30 : by + 100);
    ctx.lineTo(x + 12, up ? by + 30 : by + 100);
    up = !up;
  }
  ctx.stroke();
  // USB connector
  ctx.fillStyle = '#9aa0a8';
  ctx.fillRect(W / 2 - 42, by + bh - 6, 84, 52);
  // pin rows
  ctx.fillStyle = GOLD;
  for (let i = 0; i < 19; i++) {
    const y = by + 30 + i * 25;
    ctx.beginPath();
    ctx.arc(bx + 18, y, 7, 0, Math.PI * 2);
    ctx.arc(bx + bw - 18, y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  // glowing red LED beside the board
  const lx = W / 2 + 330, ly = by + 160;
  const glow = ctx.createRadialGradient(lx, ly, 8, lx, ly, 170);
  glow.addColorStop(0, 'rgba(255,120,90,0.95)');
  glow.addColorStop(0.4, 'rgba(255,70,60,0.3)');
  glow.addColorStop(1, 'rgba(255,60,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(lx - 180, ly - 180, 360, 360);
  ctx.fillStyle = '#ff5a4a';
  ctx.beginPath();
  ctx.arc(lx, ly, 34, Math.PI, 0);
  ctx.lineTo(lx + 34, ly + 46);
  ctx.lineTo(lx - 34, ly + 46);
  ctx.closePath();
  ctx.fill();
  // fridge with an open door on the left
  const fx = 200, fy = by + 120;
  ctx.fillStyle = '#e9eef2';
  ctx.fillRect(fx, fy, 130, 270);
  ctx.strokeStyle = '#8b98a3';
  ctx.lineWidth = 4;
  ctx.strokeRect(fx, fy, 130, 270);
  ctx.fillStyle = '#c6d0d8';
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx - 70, fy + 24);
  ctx.lineTo(fx - 70, fy + 250);
  ctx.lineTo(fx, fy + 270);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d8453a';
  ctx.fillRect(fx + 118, fy + 40, 8, 40);

  ctx.fillStyle = 'rgba(216,178,90,0.8)';
  ctx.font = `600 24px ${SANS}`;
  ctx.letterSpacing = '5px';
  ctx.fillText('ESP32-DEVKITC · WROOM-32E', W / 2, 1110);
  ctx.letterSpacing = '6px';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('VOLUME II', W / 2, 1220);
  ctx.letterSpacing = '0px';
  ctx.font = `italic 34px ${SERIF}`;
  ctx.fillStyle = '#f6e7b8';
  ctx.fillText('Lesson 1: Open Door Alarm', W / 2, 1275);
}
