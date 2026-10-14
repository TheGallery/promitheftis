import type { PlaceId } from './places';
import type { Crew, Item, Message, Morning, Order, OrderLine, Truck } from './types';

export const ITEMS: readonly Item[] = [
  { id: 'ketchup', name: 'Ketchup, bottle', size: 1 },
  { id: 'chips', name: 'Frozen chips, 10 kg', size: 8 },
  { id: 'peas', name: 'Frozen peas, 10 kg', size: 8 },
  { id: 'pork', name: 'Pork shoulder, kg', size: 2 },
  { id: 'potatoes', name: 'Potatoes, 25 kg box', size: 6 },
  { id: 'eggs', name: 'Eggs, tray', size: 2 },
  { id: 'mozzarella', name: 'Mozzarella, kg', size: 2 },
  { id: 'flour', name: 'Flour, sack', size: 6 },
  { id: 'gravy', name: 'Gravy granules, tub', size: 2 },
  { id: 'tomatoes', name: 'Tomatoes, tin', size: 1 },
  { id: 'oil', name: 'Cooking oil, 5 l', size: 4 },
  { id: 'rice', name: 'Rice, 5 kg bag', size: 4 },
];

interface Client {
  name: string;
  place: PlaceId;
  contact: string;
  note?: string;
  /** "Come before" time as HH:MM, 24-hour. */
  before?: string;
  /** Hand-written lines, used by the small morning; the others are generated. */
  lines?: Array<[string, number]>;
  small?: boolean;
}

/** Every client of the big morning, in the order their messages arrived. */
const CLIENTS: readonly Client[] = [
  { name: 'Café Lumen', place: 'saltmarket', contact: 'Marco', small: true,
    lines: [['pork', 5], ['eggs', 6], ['flour', 2], ['potatoes', 3]] },
  { name: "Rosa's", place: 'fenwick', contact: 'Rosa', small: true,
    note: 'Health inspector at 10. Could you come before 9, please? Grazie!', before: '09:00',
    lines: [['tomatoes', 12], ['mozzarella', 8], ['flour', 3]] },
  { name: 'The Anchor', place: 'millford', contact: 'Dave', small: true,
    note: "Skipper's birthday lunch for forty. Please don't run short.",
    lines: [['chips', 6], ['pork', 12], ['potatoes', 4], ['ketchup', 3], ['gravy', 2]] },
  { name: 'Golden Dragon', place: 'docks', contact: 'Mr Chen', small: true,
    lines: [['rice', 4], ['oil', 3], ['peas', 2]] },
  { name: 'Hotel Bellevue', place: 'saltmarket', contact: 'Mme Laurent', small: true,
    note: 'Wedding breakfast on Saturday. We will want extra, can we talk?',
    lines: [['pork', 10], ['eggs', 8], ['chips', 4], ['peas', 3], ['potatoes', 5], ['flour', 2]] },
  { name: 'Burger Shack', place: 'docks', contact: 'Kev', small: true,
    lines: [['ketchup', 9], ['chips', 8], ['gravy', 3]] },
  { name: 'The Plough', place: 'fenwick', contact: 'Mrs Hale', small: true,
    note: 'Busy Sunday, quiz night.',
    lines: [['ketchup', 4], ['potatoes', 4], ['pork', 10], ['peas', 3], ['eggs', 2], ['gravy', 2]] },
  { name: 'Northgate Diner', place: 'hollin', contact: 'Gus' },
  { name: 'Bella Napoli', place: 'saltmarket', contact: 'Gina', note: 'Same as last week, please.' },
  { name: 'Pho Saigon', place: 'docks', contact: 'Linh' },
  { name: 'Lark & Fig', place: 'oakley', contact: 'Imogen' },
  { name: "St Jude's Hospital", place: 'southgate', contact: 'Catering office',
    note: 'Ward breakfasts are served at 8. Please come before 8.', before: '08:00' },
  { name: 'Rushmere Inn', place: 'rushmere', contact: 'Pat' },
  { name: 'Millford School', place: 'millford', contact: 'Mrs Obi',
    note: 'The kitchen needs it before 10.', before: '10:00' },
  { name: 'Spice Route', place: 'saltmarket', contact: 'Anil' },
  { name: 'Ashby Arms', place: 'ashby', contact: 'Tess' },
  { name: 'Station Café', place: 'southgate', contact: 'Bernie' },
  { name: 'Hollin Tea Rooms', place: 'hollin', contact: 'Miss Pym', note: 'Scones galore this week.' },
  { name: 'Grove Bakery', place: 'saltmarket', contact: 'Hal' },
  { name: 'Lighthouse Inn', place: 'millford', contact: 'Morag' },
  { name: 'Oakley Golf Club', place: 'oakley', contact: 'Clubhouse' },
  { name: "The Dockers' Arms", place: 'docks', contact: 'Sheila' },
  { name: 'Ashby Primary School', place: 'ashby', contact: 'Mr Ward',
    note: 'Dinner ladies start at 9.', before: '09:00' },
  { name: "Marlowe's Brasserie", place: 'saltmarket', contact: 'Chef Marlowe' },
  { name: 'Lakeside Café', place: 'rushmere', contact: 'Jo' },
  { name: 'Fenwick Village Hall', place: 'fenwick', contact: 'Mrs Bell', note: 'Harvest supper on Friday.' },
  { name: 'Southgate Leisure Centre', place: 'southgate', contact: 'Reception' },
  { name: 'The Old Mill', place: 'saltmarket', contact: 'Tom' },
  { name: 'Harbour Fish Bar', place: 'docks', contact: 'Stavros' },
  { name: 'Hollin Farm Shop', place: 'hollin', contact: 'Edna' },
  { name: 'Sea Salt Bistro', place: 'millford', contact: 'Rhys' },
  { name: 'The Copper Kettle', place: 'oakley', contact: 'Dot' },
  { name: 'Plum Tree Kitchen', place: 'southgate', contact: 'Priti' },
  { name: 'Cinema Café', place: 'saltmarket', contact: 'Nell' },
  { name: 'Rushmere Hall Hotel', place: 'rushmere', contact: 'Conference desk',
    note: 'Conference breakfast at 9. Before 9, please.', before: '09:00' },
  { name: 'The Windmill Tea Garden', place: 'ashby', contact: 'Wendy' },
  { name: 'Jade Garden', place: 'saltmarket', contact: 'Mr Lau' },
  { name: 'Corner Deli', place: 'saltmarket', contact: 'Sal' },
];

/** How much of each item the big morning's stock covers: below 1 means short. */
const BIG_STOCK_COVER: Record<string, number> = {
  ketchup: 0.79,
  chips: 0.89,
  eggs: 0.93,
};
const BIG_STOCK_DEFAULT_COVER = 1.15;

const SMALL_STOCK: Record<string, number> = {
  ketchup: 12, chips: 14, peas: 11, pork: 40, potatoes: 20, eggs: 18,
  mozzarella: 10, flour: 14, gravy: 9, tomatoes: 36, oil: 6, rice: 8,
};

/** [weight when picking lines, lowest quantity, highest quantity] */
const DEMAND: Record<string, [number, number, number]> = {
  ketchup: [3, 2, 8], chips: [2, 1, 4], peas: [1.5, 1, 3], pork: [3, 4, 14],
  potatoes: [2.5, 2, 6], eggs: [2.5, 2, 6], mozzarella: [1.5, 2, 8], flour: [1.5, 1, 3],
  gravy: [1.5, 1, 3], tomatoes: [1.5, 6, 18], oil: [1.5, 1, 3], rice: [1.5, 1, 3],
};

const BIG_TRUCKS: readonly Truck[] = [
  { id: 1, driver: 'Sam', kind: 'white van', capacity: 330 },
  { id: 2, driver: 'Ana', kind: 'old Bedford', capacity: 420 },
  { id: 3, driver: 'Dev', kind: 'box van', capacity: 380 },
  { id: 4, driver: 'Marta', kind: 'Transit', capacity: 480 },
  { id: 5, driver: 'Kofi', kind: 'white van', capacity: 330 },
  { id: 6, driver: 'Priya', kind: 'pick-up', capacity: 200 },
  { id: 7, driver: 'Tom', kind: 'small van', capacity: 220 },
  { id: 8, driver: 'Lena', kind: 'box van', capacity: 380 },
  { id: 9, driver: 'Raj', kind: 'Transit', capacity: 480 },
];

/** Small deterministic random numbers, so the big morning is the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function generateLines(rand: () => number): OrderLine[] {
  const scale = 0.7 + rand() * 0.8;
  const count = 3 + Math.floor(rand() * 3);
  const pool = ITEMS.map((i) => i.id);
  const lines: OrderLine[] = [];
  for (let n = 0; n < count; n++) {
    const total = pool.reduce((sum, id) => sum + (DEMAND[id]?.[0] ?? 1), 0);
    let pick = rand() * total;
    let chosen = pool.length - 1;
    for (let k = 0; k < pool.length; k++) {
      pick -= DEMAND[pool[k] as string]?.[0] ?? 1;
      if (pick <= 0) {
        chosen = k;
        break;
      }
    }
    const id = pool.splice(chosen, 1)[0] as string;
    const [, lo, hi] = DEMAND[id] as [number, number, number];
    const base = lo + Math.floor(rand() * (hi - lo + 1));
    lines.push({ item: id, asked: Math.max(1, Math.round(base * scale)) });
  }
  return lines;
}

/** Overnight messages arrive between 21:30 and 05:10, spread evenly. */
function arrivalTime(index: number, count: number): number {
  const first = 21 * 60 + 30;
  const last = 24 * 60 + 5 * 60 + 10;
  return count <= 1 ? first : first + Math.round((index * (last - first)) / (count - 1));
}

function buildOrders(clients: readonly Client[], rand: () => number): Order[] {
  return clients.map((c, index) => {
    // Generate even for hand-written clients so each one's numbers do not shift when another changes.
    const generated = generateLines(rand);
    const lines: OrderLine[] = c.lines ? c.lines.map(([item, asked]) => ({ item, asked })) : generated;
    const order: Order = {
      id: index + 1,
      client: c.name,
      place: c.place,
      contact: c.contact,
      leftAt: arrivalTime(index, clients.length),
      lines,
    };
    if (c.note) order.note = c.note;
    if (c.before) order.before = parseClock(c.before);
    return order;
  });
}

const SUPPLIER_STAFF_NOTES: ReadonlyArray<Extract<Message, { kind: 'supplier' | 'staff' }>> = [
  { kind: 'staff', from: 'Ines', text: 'In at 10 today, dentist. Max has the keys to the store room.', at: 24 * 60 + 3 * 60 + 30 },
  { kind: 'supplier', from: 'Grange Farm', text: 'Eggs and potatoes delivered at 04:00, all counted in.', at: 24 * 60 + 4 * 60 + 10 },
  { kind: 'supplier', from: 'Hartley', text: 'Dry goods are in. The ketchup order came up short again, sorry.', at: 24 * 60 + 4 * 60 + 40 },
  { kind: 'supplier', from: 'Northfrost', text: 'Frozen delivery counted in at 05:00. Chips and peas are on the freezer shelves.', at: 24 * 60 + 5 * 60 },
  { kind: 'staff', from: 'Joe', text: 'Loading crew starts at 6 sharp. Kettle is on.', at: 24 * 60 + 5 * 60 + 15 },
];

function buildMessages(orders: readonly Order[], noteCount: number): Message[] {
  const notes = noteCount >= SUPPLIER_STAFF_NOTES.length
    ? [...SUPPLIER_STAFF_NOTES]
    : [SUPPLIER_STAFF_NOTES[0], SUPPLIER_STAFF_NOTES[3]].filter((n): n is NonNullable<typeof n> => !!n);
  const all: Message[] = [
    ...orders.map((o): Message => ({ kind: 'order', orderId: o.id, at: o.leftAt })),
    ...notes,
  ];
  return all.sort((a, b) => a.at - b.at);
}

const ITEM_LIST: Item[] = ITEMS.map((i) => ({ ...i }));

export function smallMorning(): Morning {
  const rand = mulberry32(1987);
  const clients = CLIENTS.filter((c) => c.small);
  const orders = buildOrders(clients, rand);
  const crews: Crew[] = [{ names: ['Joe', 'Bea'], trucks: [1, 2] }];
  return {
    id: 'small',
    title: 'A small morning',
    items: ITEM_LIST,
    stock: { ...SMALL_STOCK },
    trucks: BIG_TRUCKS.slice(0, 2).map((t) => ({ ...t })),
    orders,
    messages: buildMessages(orders, 2),
    crews,
    storeRoom: ['Max'],
  };
}

export function bigMorning(): Morning {
  const rand = mulberry32(1987);
  const orders = buildOrders(CLIENTS, rand);
  const asked: Record<string, number> = {};
  for (const o of orders) for (const l of o.lines) asked[l.item] = (asked[l.item] ?? 0) + l.asked;
  const stock: Record<string, number> = {};
  for (const item of ITEMS) {
    const cover = BIG_STOCK_COVER[item.id] ?? BIG_STOCK_DEFAULT_COVER;
    stock[item.id] = Math.round((asked[item.id] ?? 0) * cover);
  }
  const crews: Crew[] = [
    { names: ['Joe', 'Bea'], trucks: [1, 2, 3] },
    { names: ['Kit', 'Ola'], trucks: [4, 5, 6] },
    { names: ['Sid'], trucks: [7, 8, 9] },
  ];
  return {
    id: 'big',
    title: 'The big morning',
    items: ITEM_LIST,
    stock,
    trucks: BIG_TRUCKS.map((t) => ({ ...t })),
    orders,
    messages: buildMessages(orders, SUPPLIER_STAFF_NOTES.length),
    crews,
    storeRoom: ['Max'],
  };
}

export function loadMorning(id: 'small' | 'big'): Morning {
  return id === 'big' ? bigMorning() : smallMorning();
}
