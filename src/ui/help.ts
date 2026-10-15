import type { Screen } from './app';

/** One part of a how-to-play page: an optional heading and a paragraph. Keys are written {LIKE-THIS}; they are set apart on screen. */
export interface HelpBlock {
  head?: string;
  text: string;
}

export interface HelpPage {
  /** The short name shown along the top of every page. */
  name: string;
  blocks: HelpBlock[];
}

/** The how-to-play pages, in the order they are turned. Each one has to fit the room under the page names. */
export const HELP_PAGES: readonly HelpPage[] = [
  {
    name: 'THE MORNING',
    blocks: [
      {
        text:
          'You run a small restaurant wholesaler. Each morning you hand out overnight orders from your stock and put each on a truck ' +
          'before 07:00. Short stock means less for some clients, and far-apart stops mean a late truck.',
      },
      {
        head: 'THE KEYS',
        text:
          '{SPACE} goes on. {ENTER} picks. {ESC} goes back. Hold {SPACE} when you cannot take the step back.',
      },
      {
        head: 'OVERNIGHT MESSAGES',
        text:
          'Orders and notes came in overnight. Read through them with {↑↓}, then {SPACE} starts the morning. A {!} or {!!} beside a client means ' +
          'they went short lately, or two days running; the lines below the list say what was short.',
      },
      {
        head: 'THE ORDER DESK',
        text:
          'Three panes: ORDERS, LINES and TRUCKS; {TAB} moves between them. On a line, {ENTER} gives what was asked, or as much as there is; ' +
          'type a number or use {←→} for a different amount. After the last line pick a truck with {↑↓} and {ENTER}. HEADS UP names the ' +
          'items that today\'s orders ask more of than you have, so you can hold some back.',
      },
      {
        head: 'TRUCKS AND THE MAP',
        text:
          'Orders for the same place belong on the same truck, and places that touch on the map, corners included, can share one. A truck sent ' +
          'to places far apart gets back late and costs more to run. The clock moves a minute for each truck you pick and order you finish. ' +
          'A client who asked for a time pays half if late; ✗ marks them.',
      },
      {
        head: 'TRUCK SHEETS',
        text:
          '{SPACE} on the desk shows each truck\'s orders and route: {ENTER} opens one, {P} prints the sheets and {ESC} goes back to the desk. ' +
          'Hold {SPACE} to send the trucks out; the box warns of any order still to hand out.',
      },
    ],
  },
  {
    name: 'ROAD AND RESULT',
    blocks: [
      {
        head: 'ON THE ROAD',
        text:
          'The clock runs on from 07:00 and a log fills in as each truck leaves, delivers (with a gentle note when a client got less) and comes ' +
          'back. {SPACE} skips ahead; it stops at each call, and once every truck is home it goes on to the result.',
      },
      {
        head: 'PHONE CALLS',
        text:
          'Now and then a client rings while the trucks are out. A call about an item shows what is in stock. Pick an answer with {↑↓} and {ENTER}: ' +
          'promise it for tomorrow, sorry not today, or the time the truck reaches them. A promise is on that client\'s order in the morning ' +
          'and is checked: broken, it lets them down more than a sorry.',
      },
      {
        head: 'RUSH ORDERS',
        text:
          'Some mornings an overnight note warns that a client may ring for extra of one item by a time; HEADS UP repeats it. Keep that much back, ' +
          'and a truck free if you can. The call lists a truck that is home or still out: when it gets there, what it pays (a rush pays double) and what ' +
          'the trip costs. Late pays half, and late or a no lets the client down. With nothing spare, you can only say no.',
      },
      {
        head: 'THE RESULT',
        text:
          'Once every truck is home and every call is answered, {SPACE} shows how it went: when each truck got back, how much of each order ' +
          'was delivered, who got less, and your answers on the phone. Hold {R} to play the day again from its overnight messages; {SPACE} goes on to the supplier order.',
      },
    ],
  },
  {
    name: 'SUPPLIER ORDER',
    blocks: [
      {
        head: 'THE SUPPLIER ORDER',
        text:
          'At 13:00 you order stock for tomorrow. Every item is grouped by where it is kept (freezer, fridge, dry store), with what is on hand, ' +
          'the usual daily amount, what clients asked for today and what you order. Type a number or use {←→}; {ENTER} confirms a row and moves on; {U} fills a row up to the ' +
          'usual amount and {A} fills every row, which can take a room a little over full, so check the bars and the spoil warning first. Hold {SPACE} to place the order and end the day; {ESC} goes back to the result.',
      },
      {
        head: 'DEMAND SWINGS',
        text:
          'Clients ask for about the usual amount, so {A} is a good start and not the whole answer. Sunday and Monday are quiet, Friday and Saturday are busy, ' +
          'as the line under the list says. A note on an order or an overnight message is a hint too: a wedding, a quiz night or a ' +
          'match day means clients ask for more of some items; "keep it simple", or a client who rang to say it is closed, means less (the hospital ' +
          'and the schools never close). An arrow beside what was asked says tomorrow is busier (↑) or quieter (↓) for that item; select the row to see who said so.',
      },
      {
        head: 'THE STORE ROOMS',
        text:
          'Each room has a bar showing how full it will be tomorrow: █ the stock now, ▓ what is ordered and ░ the space left. A room holds only ' +
          'so much. What does not fit spoils overnight, and is paid for all the same: the bar turns amber and says how many units will spoil, ' +
          'and the store room tells you in the morning.',
      },
      {
        head: 'WHEN THE SUPPLIER COMES UP SHORT',
        text:
          'Now and then an item you ordered arrives only in part. An overnight note says how much came and that the rest is not charged for; ' +
          'when today\'s orders need more than is on hand, HEADS UP names it. Decide who gets it: a client you promised it to, one let down yesterday, or the most clients in full.',
      },
    ],
  },
  {
    name: 'END OF THE DAY AND MONEY',
    blocks: [
      {
        head: 'THE END OF THE DAY',
        text:
          'At 18:00 everything is on one screen. On the left, each client with how much of the order arrived, when the truck reached them and ' +
          'how they feel; the story of the highlighted client shows below. On the right, the trucks, the phone calls, the money and ' +
          'tomorrow\'s order. Look through the clients with {↑↓}.',
      },
      {
        text:
          'A client is pleased when everything came on time. They are a bit let down, or let down, when less arrived, the truck was late, or ' +
          'they were told nothing more today; a promise of the rest tomorrow softens that. How a client felt goes with them into the next ' +
          'morning, where a let-down client orders a little less.',
      },
      {
        head: 'MONEY',
        text:
          'One number: the cash in the bank, £1,000 to start, at the top of every screen and amber below zero; nothing stops play when ' +
          'it is. Restaurants pay for what arrives, item by item; one that asked for a time and is reached after it pays half for that order. Each item has its own supplier price, and ' +
          'the supplier order shows what the order costs and the cash left after it. A truck costs a driver plus the squares it drives, so putting orders for the same place on the same truck saves money. ' +
          'The end of the day breaks it all down; what a client paid shows under their name.',
      },
      {
        head: 'WHAT TO GROW',
        text:
          '{SPACE} on the end of the day opens one last choice: another truck, a bigger room (the tightest one tomorrow) or a new client. Pick ' +
          'with {↑↓} or {1}-{3}, and {ENTER} chooses it. A truck or a room costs money; a client is free. The screen shows how full the ' +
          'trucks were: one more only helps once they are nearly full, and each costs more than the last. A new client is big or small, ' +
          'near or far, always early, or heavy on one room. {U} takes the choice back. Hold {SPACE} for the next morning; then it is final.',
      },
    ],
  },
  {
    name: 'NEXT MORNING',
    blocks: [
      {
        text:
          'The game is a run of days. After the growth choice, holding {SPACE} goes on to the next morning, at the overnight messages again, a day on. ' +
          'What carries over: the stock in each room, the trucks, how big each room is, the clients and how each one felt, and what you ' +
          'promised on the phone.',
      },
      {
        head: 'WHAT YOU FIND',
        text:
          'The supplier order is in the store rooms, on top of what was left, as much as each room holds; an item you did not order is as low as you left it. The first ' +
          'day is a fixed morning; from day 2 on the orders, notes and calls are made up, different every day. A promise on the phone is on the ' +
          'client\'s order ("As promised: 4 frozen peas"). The growth choice is at work: the new truck, the bigger room, the new client. ' +
          'Now and then a staff note says a truck is at the garage for the day: it cannot be loaded and costs nothing, so spread its orders over the others.',
      },
      {
        head: 'SHORT DELIVERIES ARE REMEMBERED',
        text:
          'A client who went short in the last two days gets a marker on the order desk and in the overnight messages: {!} for one short ' +
          'day, {!!} for two days running. Select the order and the lines below say which day, how much came and what was short. A client ' +
          'who is short again is a little more let down. A full delivery on time pleases them whatever came before, and the marker goes ' +
          'once two days have passed.',
      },
      {
        head: 'PLAYING A DAY AGAIN',
        text:
          'Holding {R} plays the current day again from its overnight messages, with the same orders, the same stock, and the same new client ' +
          'and next morning to come. It leaves the saved run alone. It drops what you did since the trucks left, so on the result, the end of the ' +
          'day and the growth choice you hold {R} down like the other steps that cannot be taken back.',
      },
    ],
  },
  {
    name: 'SAVING',
    blocks: [
      {
        head: 'SAVING',
        text:
          'The run saves itself in this browser; there is no save key. It is saved when a day begins, so closing the page loses only the day ' +
          'in play. Open the page again and carry on from the start of the saved day, with the same orders. The colours and the sound are ' +
          'saved too. There is no account and no cloud: one slot, in this browser only. If the browser will not keep anything, the game ' +
          'plays as ever, just without saving.',
      },
      {
        head: 'CARRYING ON',
        text:
          'When a run from day 2 or later is saved, the first screen (WELCOME BACK) offers {SPACE} to continue, or a new run ({↑↓} or {1}-{3} pick a line, {ENTER} chooses it). A saved run still on ' +
          'day 1 has nothing to lose, so the page opens straight at its overnight messages.',
      },
      {
        head: 'STARTING OVER',
        text:
          '{B} starts a new run with the big morning (9 trucks, 38 orders) and {S} with the small one (2 trucks, 7 orders). On the overnight ' +
          'messages of day 1 one press is enough. Everywhere else a new run drops the day you are playing or replaces your saved day, so a box asks ' +
          'and you hold the key down for about a second and a half until its bar fills. Let go early and the bar empties; press {ESC} to cancel, ' +
          'and nothing happens.',
      },
      {
        head: 'KEYS THAT WORK EVERYWHERE',
        text:
          '{H} opens this screen, and {H} or {ESC} closes it and puts you back exactly where you were. {F2} switches between soft green and ' +
          'office blue, {F4} turns the sounds on and off. The bar along the bottom of every screen lists the keys for that screen.',
      },
    ],
  },
];

/** The how-to-play page that belongs with a screen: the one the player most likely wants when asking from there. */
export function helpPageFor(screen: Screen): number {
  switch (screen) {
    case 'start':
      return 5;
    case 'messages':
    case 'desk':
    case 'sheets':
      return 0;
    case 'road':
    case 'result':
      return 1;
    case 'supply':
      return 2;
    case 'day':
      return 3;
  }
}
