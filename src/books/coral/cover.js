/** Coral Dev Board Micro book cover, drawn upright (the 3D cover and the library thumbnail both use it). */
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const GOLD = '#d8b25a';

export function paintCoralCover(ctx, W = 1100, H = 1400) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#3a1f2a');
  bg.addColorStop(1, '#140b14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // fixed pseudo-random speckle so the cover looks the same on every load
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`;
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
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
  ctx.font = `bold 118px ${SERIF}`;
  ctx.fillStyle = '#f6e7b8';
  ctx.fillText('Coral', W / 2, 330);
  ctx.font = `bold 62px ${SERIF}`;
  ctx.fillText('Dev Board Micro', W / 2, 410);
  ctx.letterSpacing = '0px';
  ctx.font = `italic 38px ${SERIF}`;
  ctx.fillStyle = '#e6cfd6';
  ctx.fillText('Machines that look', W / 2, 478);

  // illustration: the board standing (USB down), its camera's field of view, and a person in it
  const bx = 250, by = 560, bw = 210, bh = 455;
  ctx.fillStyle = '#0e7a3e';
  ctx.strokeStyle = '#0a5a2e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 26);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8e2d0';
  for (const [x, y] of [[bx + 30, by + 30], [bx + bw - 30, by + 30], [bx + 30, by + bh - 30], [bx + bw - 30, by + bh - 30]]) {
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = GOLD;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc(bx + 14, by + 95 + i * 17, 5, 0, Math.PI * 2);
    ctx.arc(bx + bw - 14, by + 95 + i * 17, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const lx = bx + bw / 2, ly = by + 105;
  ctx.fillStyle = '#16181d';
  ctx.fillRect(lx - 34, ly - 34, 68, 68);
  ctx.fillStyle = '#2b3240';
  ctx.beginPath();
  ctx.arc(lx, ly, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0c0d10';
  ctx.beginPath();
  ctx.arc(lx, ly, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9ccd1'; // metal shield
  ctx.fillRect(lx - 55, by + 175, 125, 85);
  ctx.fillStyle = '#16181d'; // MCU
  ctx.fillRect(bx + 35, by + 330, 105, 105);
  ctx.fillStyle = '#9aa0a8'; // USB-C
  ctx.fillRect(lx - 38, by + bh - 8, 76, 40);
  const led = (x, y, on) => {
    if (on) {
      const g = ctx.createRadialGradient(x, y, 2, x, y, 46);
      g.addColorStop(0, 'rgba(120,255,150,0.95)');
      g.addColorStop(1, 'rgba(80,255,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 50, y - 50, 100, 100);
    }
    ctx.fillStyle = on ? '#b9ffc8' : '#dfe4dc';
    ctx.fillRect(x - 8, y - 5, 16, 10);
  };
  led(lx, by + 52, true); // camera LED above the camera
  led(lx + 26, by + 292, true); // user LED near the centre
  // field of view
  ctx.fillStyle = 'rgba(122,211,255,0.12)';
  ctx.strokeStyle = 'rgba(122,211,255,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(lx + 30, ly);
  ctx.lineTo(W - 140, ly - 230);
  ctx.lineTo(W - 140, ly + 330);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // person
  const px = 760, pf = 1010;
  ctx.fillStyle = '#2f8f8a';
  ctx.beginPath();
  ctx.roundRect(px - 52, pf - 330, 104, 170, 40);
  ctx.fill();
  ctx.fillStyle = '#2d3550';
  ctx.fillRect(px - 44, pf - 175, 36, 175);
  ctx.fillRect(px + 8, pf - 175, 36, 175);
  ctx.fillStyle = '#e0b28c';
  ctx.beginPath();
  ctx.arc(px, pf - 380, 44, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(216,178,90,0.8)';
  ctx.font = `600 24px ${SANS}`;
  ctx.letterSpacing = '5px';
  ctx.fillText('GOOGLE CORAL · DEV BOARD MICRO', W / 2, 1110);
  ctx.letterSpacing = '6px';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('VOLUME III', W / 2, 1220);
  ctx.letterSpacing = '0px';
  ctx.font = `italic 34px ${SERIF}`;
  ctx.fillStyle = '#f6e7b8';
  ctx.fillText('Lesson 1: How does Coral know someone is there?', W / 2, 1275);
}
