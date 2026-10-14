# Promitheftis

A calm, keyboard-only browser game about running a small restaurant-supply business.

**[Play it in your browser](https://thegallery.github.io/promitheftis/)**, no download needed.

You own a small wholesaler that supplies restaurants. Each morning you hand out the overnight orders against the stock on hand and put each order on a truck before the trucks leave at 07:00. There is no failure screen: if stock runs short, some clients simply get less, and if a truck is sent to places that are far apart, it gets back later.

This is a one-morning prototype. It plays one fixed morning in two sizes:

- **the small morning**: 2 trucks and 7 clients (the default);
- **the big morning**: 9 trucks and 38 orders.

It has six screens: the overnight messages, the order desk, the truck sheets, the road, a short result screen (when each truck is back, what share of each order was delivered, who got less) and the supplier order. On the road the clock runs on from 07:00 and a log fills in as each truck leaves, delivers (with a gentle note when a client got less) and comes back, until every truck is home. Now and then a client rings while the trucks are out (two or three calls in the small morning, a few more in the big one): the log waits, a call box shows who it is and what they say, and you pick a friendly answer with **↑ ↓** and **ENTER**: add it to tomorrow's order, sorry not today, or the time the truck really reaches them. The answers are listed on the result screen, with how many were promised for tomorrow (e.g. "added 4 to tomorrow"); they do not change the deliveries. From the result, **ENTER** goes to the 13:00 supplier order: every item, grouped by where it is kept (freezer, fridge, dry store), with what is on hand after today's deliveries, the usual daily amount and the amount to order for tomorrow. Items a client rang about get a short note. Placing the order only shows what was ordered for now.

Left out on purpose: new clients ringing, answers that change anything yet, stock arriving from the supplier, end of day, customer moods over time, money, growth, more than one day, saving.

## What it looks like

![The overnight messages: nine messages waiting at 05:31, mostly orders, with the first one open below](docs/screens/overnight-messages.png)

*The morning starts with the overnight messages: orders from clients, plus a note from a staff member and one from a supplier.*

![The order desk: a list of orders, the lines of the current order with what was asked and what is on hand, two trucks and the nine squares of the island](docs/screens/order-desk.png)

*The order desk: for each line you decide how much to give, and the stock on hand (here, no ketchup left) shows when someone will get less.*

![The truck sheets in office blue, with truck 1 open to show its four orders and its route around the island](docs/screens/truck-sheets-blue.png)

*The truck sheets, here in office blue (F2): each truck's orders, its route and when it is back at the depot.*

## Where it happens

![A storybook map of the island: the walled town of Saltmarket in the middle, with Hollin, Rushmere, Oakley, Fenwick, Docks, Millford, Southgate and Ashby around it](docs/world-map.png)

*The Nine Squares: our depot sits in Saltmarket, and every client lives somewhere on this little island.*

Promitheftis (Greek for "supplier") is set on a small imaginary island: a town called Saltmarket with eight neighbouring places around it. There are woods and a lake to the north, fields in the south, a harbour on the east side and a railway line through Southgate. Some of the places and clients you will meet are on this map.

## Run it

You need Node.js 24 (see `.nvmrc`).

Dependencies are installed through [Socket Firewall](https://socket.dev/blog/introducing-socket-firewall) (`sfw`), here and in CI, so a known-malicious package is blocked before it is installed. Install it once with `npm install --global sfw`, then:

```sh
sfw npm ci
npm run dev
```

Open the URL Vite prints (http://localhost:5173/). The screen is 120 columns wide and fills the page. Use the keyboard only: there is nothing to click.

Other commands:

```sh
npm test            # unit tests for the rules and the screens
npm run typecheck   # TypeScript
npm run build       # production build in dist/
```

## Keys

Keys that work everywhere: **F2** switches between soft green and office blue, **F4** turns the sounds on and off. The bar along the bottom of every screen lists the keys for that screen.

| Screen | Keys |
| --- | --- |
| Overnight messages | **↑ ↓** read through the messages · **SPACE** start the morning · **B** load the big morning · **S** load the small morning |
| Order desk | **TAB** next pane (**Shift+TAB** back) · **↑ ↓** move within a pane · type a number or **← →** (one less / one more) for the amount on a line · **ENTER** accept the line and go to the next · **ENTER** on the highlighted truck in the TRUCKS pane puts the order on it · **F10** truck sheets |
| Truck sheets | **↑ ↓** pick a truck · **ENTER** open or close it · **+** / **−** open or close all · **P** print the sheets (with the printer sound) · **ESC** back to the desk · **F9** send the trucks |
| On the road | **SPACE** or **ENTER** skip ahead (it stops at each call) · when the phone rings, **↑ ↓** pick an answer and **ENTER** gives it · once every truck is back and the calls are answered, **ENTER** goes to the result |
| Result | **↑ ↓** look through the orders · **ENTER** supplier order · **R** play this morning again · **B** / **S** load the other morning |
| Supplier order | **↑ ↓** pick an item · type a number or **← →** (one less / one more) · **ENTER** confirm the row and go to the next · **U** fill the row up to the usual amount · **A** fill every row (both leave a row that already has an amount alone) · **F9** place the order · **ESC** back to the result · once the order is placed, **R** play this morning again · **B** / **S** load a morning |

### How the desk plays

- The **ORDERS** pane lists the orders with each one's place and truck. **LINES** shows the current order: each item, what was asked, what is on hand, and what you give. **TRUCKS** shows each truck's fullness and the places it already goes to, with the nine squares under it.
- On a line, **ENTER** gives as much as was asked, or as much as there is. Type a number or use **← →** to give a different amount. A truck that is full takes no more.
- After the last line, choose a truck: **↑ ↓** to highlight it in the TRUCKS pane, then **ENTER**. The order is finished and the desk moves to the next one.
- The **HEADS UP** line lists items that today's orders ask for more of than there is on hand, so you can hold some back for later clients.
- The clock moves a minute for each truck you pick and each order you finish, not in real time. The trucks leave at 07:00.

### The map

Nine squares, with Saltmarket in the middle:

```
Oakley    Hollin     Rushmere
Fenwick   SALTMARKET Docks
Millford  Southgate  Ashby
```

Orders for the same place should go on the same truck. Places next to each other (squares that touch, corners included) can share a truck. A truck sent to places far apart gets back late; that is the only penalty. Each square shows the numbers of the trucks going there, and the current order's square is lit.

## How it is built

Plain TypeScript with Vite and no UI framework; Vitest for tests.

- `src/game/` holds the rules and has no screen code: the map (`places.ts`), the two mornings (`morning.ts`), the order desk with stock, truck fullness and the clock (`desk.ts`), return times (`routes.ts`), the log of the drive (`road.ts`), the phone calls (`calls.ts`), shortages (`headsup.ts`), the result (`results.ts`) and the supplier order (`supply.ts`).
- `src/ui/` holds the screens. Each screen builds lines of text of exactly 120 columns (`grid.ts`, `screens/`); `app.ts` holds the state and what each key does; `view.ts` and `main.ts` put the text on the page; `audio.ts` plays the sounds, with the Soft keys set in `softkeys.ts`.
- `tests/` has the unit tests, including a full play-through of both mornings that checks that every screen is exactly 120 columns by 30 rows.

## Sounds and fonts

The sounds are made in code with the Web Audio API, so there are no sound files: gentle "soft key" keyboard clicks, a little deeper for ENTER, with a low double knock when an order is finished and a soft double thud for a warning, and the dot-matrix printer on the truck sheets. On the road each step of the clock makes a soft click, and the last one, when every truck is back, is the finishing knock; an incoming call has a soft two-note ring. Each key press makes one sound at most: a key that only shows a message at the bottom plays the warning, and a key that changes nothing at all is silent. The font is [JetBrains Mono](https://www.jetbrains.com/lp/mono/), used under the SIL Open Font License 1.1 (`src/assets/fonts/OFL.txt`).

## License

MIT, see [LICENSE](LICENSE).
