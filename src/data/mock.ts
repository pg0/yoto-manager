import { DEFAULT_SETTINGS, type Card, type Track } from '../types';

// --- tiny inline SVG helpers so the mock needs no asset files ---
const svg = (s: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(s);

const COVERS = {
  sharky: svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#0a0a0a'/><g fill='#e8b04b'><circle cx='40' cy='30' r='13'/><rect x='30' y='40' width='20' height='30' rx='4'/></g><rect x='34' y='18' width='12' height='6' fill='#c0392b'/></svg>`,
  ),
  bibi: svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#1e3a5f'/><circle cx='40' cy='34' r='14' fill='#f2c14e'/><rect x='24' y='52' width='32' height='16' rx='3' fill='#e74c3c'/></svg>`,
  ),
  benjamin: svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#3b6e3b'/><circle cx='40' cy='40' r='20' fill='#9a9a9a'/><rect x='30' y='20' width='20' height='16' rx='6' fill='#7a7a7a'/></svg>`,
  ),
};

export const ICON_EMOJI = [
  '🎵', '🏴‍☠️', '🦜', '⚓', '🗺️', '🎸', '🥁', '🌊',
  '⭐', '🎤', '🐘', '🐝', '🚓', '🔍', '🦸', '🎺', '🌈', '🔔',
];

export function pixIcon(emoji: string, i: number): string {
  const bg = ['#1c2b4a', '#3a1c2b', '#1c3a2b', '#3a331c', '#2b1c3a'][i % 5];
  return svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' fill='${bg}'/><text x='8' y='13' font-size='12' text-anchor='middle'>${emoji}</text></svg>`,
  );
}

let uid = 1;
function tr(title: string, sec: number, kb: number, emoji: string | null): Track {
  const id = uid++;
  return {
    key: String(id).padStart(2, '0'),
    uid: 'u' + id,
    title,
    duration: sec,
    size: Math.round(kb * 1024),
    icon: emoji ? pixIcon(emoji, id) : null,
    emoji,
  };
}

export function mockCards(): Card[] {
  uid = 1;
  return [
    {
      id: 'sHrk1', title: 'Sharky', slug: 'sharky-piraten', cover: COVERS.sharky, dirty: false,
      settings: { ...DEFAULT_SETTINGS },
      tracks: [
        tr('Eva mit Gitarre - Pipikaka-Automat', 183, 2140, '🎸'),
        tr('Glu-Glu-Lied 2018', 145, 1188, '🎤'),
        tr('robin_hood.mp3', 30, 378, null),
        tr('Der geheimnisvolle Smaragdeisbecher 1', 53, 594, null),
        tr('Der geheimnisvolle Smaragdeisbecher 2', 59, 728, null),
        tr('Der geheimnisvolle Smaragdeisbecher 3', 186, 1485, null),
        tr('Kapitel 20: Einer fuer alle', 91, 1054, '🏴‍☠️'),
        tr('Kapitel 21: Einer fuer alle', 90, 1075, '🏴‍☠️'),
        tr('Kapitel 22: Einer fuer alle', 91, 731, '🏴‍☠️'),
        tr('Outro: Einer fuer alle, alle fuer einen', 71, 472, '⚓'),
        tr('Manchmal (Lied)', 124, 985, '🎵'),
        tr('Sharkys Piratenlied (Lied)', 147, 1140, '🦜'),
      ],
    },
    {
      id: 'bibi2', title: 'Bibi Blocksberg', slug: 'bibi-hexerei', cover: COVERS.bibi, dirty: false,
      settings: { ...DEFAULT_SETTINGS },
      tracks: [
        tr('Folge 1 - Die Zauberlimonade', 1380, 12400, '🧹'),
        tr('Folge 2 - Der Hexengeburtstag', 1420, 12900, '🧹'),
        tr('Titelsong', 92, 890, '🎵'),
      ],
    },
    {
      id: 'benj3', title: 'Benjamin Bluemchen', slug: 'benjamin-zoo', cover: COVERS.benjamin, dirty: false,
      settings: { ...DEFAULT_SETTINGS },
      tracks: [
        tr('Benjamin als Pilot', 1650, 15200, '🐘'),
        tr('Toeroeoe-Lied', 88, 810, '🎺'),
        tr('Benjamin und Otto', 1590, 14800, '🐘'),
      ],
    },
  ];
}
